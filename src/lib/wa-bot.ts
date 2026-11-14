// Logika bisnis & pemrosesan pesan masuk Bot WhatsApp (Phase 6A).
// Melayani webhook WAHA secara reaktif tanpa n8n, dengan perlindungan Zero Trust,
// rate limiting atomik HMAC, deduplikasi pesan, serta kepatuhan privasi (NFR-04, NFR-05, NFR-06).

import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import {
  apakahWaGatewayNonaktif,
  ekstrakKodeGalatAman,
} from "./env-produksi.ts";
import { daftarLayananAktif } from "./katalog.ts";
import { ambilWaGateway } from "./wa-gateway.ts";
import {
  parsePesanPemesananWa,
  adalahPesanStop,
  adalahPesanMulai,
  adalahPesanMenu,
  adalahPesanKatalog,
  adalahPesanFormatPemesanan,
  adalahPesanCekProgress,
  adalahUpayaPemesanan,
  diagnosaUpayaPemesanan,
  ekstrakKodeTiketCek,
} from "./wa-parser.ts";
import { normalisasiNomorWa } from "./nomor-wa.ts";
import { formatRupiah, formatTanggal } from "./format.ts";
import {
  AWALAN_KODE_TIKET,
  BATAS_TOTAL_TIKET,
  hitungEstimasiSelesaiDefault,
} from "../config/tiket.ts";
import {
  MAKS_USIA_WEBHOOK_DETIK,
  MAKS_SIMPAN_ISI_PESANAN_WA,
  BATAS_PESAN_PER_MENIT,
  BATAS_TIKET_BARU_PER_JAM,
  BATAS_GLOBAL_TIKET_WA_PER_JAM,
  MAKS_TIKET_BELUM_DICUCI_PER_NOMOR,
  PESAN_BOT,
  buatTeksFormatPemesanan,
  type SerahTerima,
} from "../config/wa-bot.ts";

export type ItemRingkasanCekWa = {
  layanan: string;
  jumlah: number;
  deskripsi_barang: string;
};

const SQL_LATERAL_RINGKASAN_ITEM = `LEFT JOIN LATERAL (
  SELECT
    STRING_AGG(DISTINCT s.nama, ', ' ORDER BY s.nama) AS ringkasan_layanan,
    COALESCE(
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'layanan', s.nama,
          'jumlah', oi.jumlah,
          'deskripsi_barang', oi.deskripsi_barang
        )
        ORDER BY oi.id
      ),
      '[]'::json
    ) AS daftar_item
  FROM order_items oi
  JOIN services s ON s.id = oi.service_id
  WHERE oi.order_id = o.id
) agg ON true`;

function bersihkanTeksSatuBaris(teks: string): string {
  return teks.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * Susun baris `Deskripsi Barang` untuk balasan cek progress WhatsApp.
 * Satu item langsung menampilkan deskripsi (+ awalan jumlah bila > 1);
 * multi-item menampilkan daftar berpoin `Nx Layanan — deskripsi` agar jelas tiap barang.
 */
export function formatBarisDeskripsiBarangWa(
  daftarItem: unknown,
  indentasi: string = ""
): string {
  const items: ItemRingkasanCekWa[] = Array.isArray(daftarItem)
    ? daftarItem.filter(
        (it): it is ItemRingkasanCekWa =>
          typeof it === "object" &&
          it !== null &&
          typeof (it as ItemRingkasanCekWa).deskripsi_barang === "string"
      )
    : [];

  if (items.length === 0) {
    return `${indentasi}Deskripsi Barang: -`;
  }

  if (items.length === 1) {
    const it = items[0];
    const deskripsi = bersihkanTeksSatuBaris(it.deskripsi_barang) || "-";
    const awalanJumlah = it.jumlah > 1 ? `${it.jumlah}x ` : "";
    return `${indentasi}Deskripsi Barang: ${awalanJumlah}${deskripsi}`;
  }

  const rincian = items.map((it) => {
    const layanan = bersihkanTeksSatuBaris(it.layanan ?? "") || "-";
    const deskripsi = bersihkanTeksSatuBaris(it.deskripsi_barang) || "-";
    return `${indentasi}- ${it.jumlah}x ${layanan} — ${deskripsi}`;
  });
  return `${indentasi}Deskripsi Barang:\n${rincian.join("\n")}`;
}

export type HasilVerifikasiWebhook =
  | { ok: true }
  | { ok: false; kode: 401 | 503; galat: string };

export type HasilProsesWebhook = {
  ok: boolean;
  kode?: 401 | 503;
  duplikat?: boolean;
  diabaikan?: boolean;
  alasan?: string;
  balasanTerkirim?: boolean;
  kodeTiket?: string;
  galat?: string;
};

const DAFTAR_PLACEHOLDER_HMAC = new Set([
  "isi_dengan_kunci_rahasia_hmac_sha512_minimal_32_karakter",
  "ganti_dengan_kunci_acak_minimal_32_karakter",
  "change_me_to_a_random_32_character_secret",
  "change_me",
  "your_secret_here",
  "your_webhook_hmac_key",
  "placeholder",
  "secret",
  "default",
]);

/**
 * Memverifikasi tanda tangan HMAC-SHA512 pada header X-Webhook-Hmac (Refinement 4).
 * Gagal tertutup (503) jika WAHA_WEBHOOK_HMAC_KEY kosong, < 32 karakter, atau teks placeholder.
 */
export function verifikasiTandaTanganWebhookWa(
  rawBody: string,
  hmacHeader: string | null | undefined
): HasilVerifikasiWebhook {
  const secret = process.env.WAHA_WEBHOOK_HMAC_KEY;
  if (!secret || secret.trim().length === 0) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: WAHA_WEBHOOK_HMAC_KEY belum dikonfigurasi di lingkungan server."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan webhook WhatsApp belum siap: kunci autentikasi server belum dikonfigurasi.",
    };
  }

  const trimmedSecret = secret.trim();
  if (trimmedSecret.length < 32) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: WAHA_WEBHOOK_HMAC_KEY kurang dari 32 karakter (tidak aman)."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan webhook WhatsApp belum siap: panjang kunci HMAC minimal 32 karakter.",
    };
  }

  if (DAFTAR_PLACEHOLDER_HMAC.has(trimmedSecret.toLowerCase())) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: WAHA_WEBHOOK_HMAC_KEY masih menggunakan teks placeholder contoh."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan webhook WhatsApp belum siap: kunci autentikasi server masih menggunakan teks contoh/placeholder.",
    };
  }

  if (!hmacHeader || hmacHeader.trim().length === 0) {
    return {
      ok: false,
      kode: 401,
      galat: "Header X-Webhook-Hmac tidak ditemukan pada permintaan webhook.",
    };
  }

  const hitungHmac = crypto
    .createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const bufHitung = Buffer.from(hitungHmac.toLowerCase(), "utf8");
  const bufHeader = Buffer.from(hmacHeader.trim().toLowerCase(), "utf8");

  if (bufHitung.length !== bufHeader.length) {
    return {
      ok: false,
      kode: 401,
      galat: "Tanda tangan HMAC webhook tidak valid.",
    };
  }

  const cocok = crypto.timingSafeEqual(bufHitung, bufHeader);
  if (!cocok) {
    return {
      ok: false,
      kode: 401,
      galat: "Tanda tangan HMAC webhook tidak valid.",
    };
  }

  return { ok: true };
}

/**
 * Memeriksa usia timestamp payload webhook (Refinement 3 & 7).
 * Mencegah serangan replay dan selisih jam melayang. Menolak payload jika timestamp tidak ada.
 */
export function periksaUsiaPayload(timestamp: unknown): {
  valid: boolean;
  galat?: string;
} {
  if (timestamp === undefined || timestamp === null) {
    return { valid: false, galat: "Timestamp payload wajib ada." };
  }

  const tsNum = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (isNaN(tsNum)) {
    return { valid: false, galat: "Timestamp payload tidak valid." };
  }

  const tsMs = tsNum < 10_000_000_000 ? tsNum * 1000 : tsNum;
  const sekarang = Date.now();
  const selisihDetik = Math.abs(sekarang - tsMs) / 1000;

  if (selisihDetik > MAKS_USIA_WEBHOOK_DETIK) {
    return {
      valid: false,
      galat: `Payload webhook kedaluwarsa (selisih ${Math.round(selisihDetik)} detik melebihi batas ${MAKS_USIA_WEBHOOK_DETIK} detik).`,
    };
  }

  return { valid: true };
}

/**
 * Memvalidasi SESSION_SECRET untuk derivasi kunci bot WhatsApp (Refinement 5).
 * Gagal tertutup (503) jika SESSION_SECRET kosong, < 32 karakter, atau bernilai placeholder.
 */
export function validasiSessionSecret():
  | { ok: true; secret: string }
  | { ok: false; kode: 503; galat: string } {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim().length === 0) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: SESSION_SECRET belum dikonfigurasi di lingkungan server."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan WhatsApp belum siap: SESSION_SECRET belum dikonfigurasi.",
    };
  }

  const trimmedSecret = secret.trim();
  if (trimmedSecret.length < 32) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: SESSION_SECRET kurang dari 32 karakter (tidak aman)."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan WhatsApp belum siap: SESSION_SECRET kurang dari 32 karakter (minimal 32 karakter).",
    };
  }

  if (DAFTAR_PLACEHOLDER_HMAC.has(trimmedSecret.toLowerCase())) {
    console.warn(
      "[WA_BOT] Peringatan keamanan: SESSION_SECRET masih menggunakan teks placeholder contoh."
    );
    return {
      ok: false,
      kode: 503,
      galat: "Layanan WhatsApp belum siap: SESSION_SECRET masih menggunakan teks contoh/placeholder.",
    };
  }

  return { ok: true, secret: trimmedSecret };
}

/**
 * Menghasilkan kunci turunan berlabel 'wa-rate-limit' dari SESSION_SECRET (Refinement 2 & 5).
 * Mencegah pemakaian SESSION_SECRET secara langsung untuk derivasi kunci tabel.
 */
function ambilKunciTurunanRateLimit(): Buffer {
  const val = validasiSessionSecret();
  if (!val.ok) {
    throw new Error(val.galat);
  }
  return crypto.createHmac("sha256", val.secret).update("wa-rate-limit").digest();
}

/**
 * Menghasilkan hash pengenal pengirim untuk kunci pembatas laju.
 * Menghindari penyimpanan nomor WhatsApp / JID mentah secara langsung di tabel wa_rate_limit.
 */
export function buatKunciRateLimit(pengenal: string, kategori: string): string {
  if (kategori === "tiket_global_jam") {
    return "global";
  }
  const derivedKey = ambilKunciTurunanRateLimit();
  return crypto.createHmac("sha256", derivedKey).update(pengenal).digest("hex");
}

/**
 * Menghasilkan hash identitas chat pengirim dengan HMAC dan kunci turunan berlabel 'wa-chat-hash' (Phase 6A.1 & Refinement 5).
 * Mengamankan identitas pengirim @lid tanpa menyimpan nomor mentah atau menggunakan SHA-256 polos.
 */
export function buatChatHash(senderFrom: string): string {
  const val = validasiSessionSecret();
  if (!val.ok) {
    throw new Error(val.galat);
  }
  const derivedKey = crypto
    .createHmac("sha256", val.secret)
    .update("wa-chat-hash")
    .digest();
  return crypto.createHmac("sha256", derivedKey).update(senderFrom).digest("hex");
}

/**
 * Pengecekan dan pencatatan laju atomik (Refinement 7 & 8) via PostgreSQL ON CONFLICT DO UPDATE.
 */
export async function periksaRateLimitAtomik(
  pool: Pool | PoolClient,
  pengenal: string,
  kategori: string,
  intervalSql: string,
  batasMaksimal: number
): Promise<{ dibolehkan: boolean; hitungan: number }> {
  const kunci = buatKunciRateLimit(pengenal, kategori);

  const res = await pool.query(
    `INSERT INTO wa_rate_limit (kunci, kategori, hitungan, window_mulai)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (kunci, kategori)
     DO UPDATE SET
       hitungan = CASE
         WHEN wa_rate_limit.window_mulai < now() - $3::interval THEN 1
         ELSE wa_rate_limit.hitungan + 1
       END,
       window_mulai = CASE
         WHEN wa_rate_limit.window_mulai < now() - $3::interval THEN now()
         ELSE wa_rate_limit.window_mulai
       END
     RETURNING hitungan`,
    [kunci, kategori, intervalSql]
  );

  const hitungan = (res.rows[0]?.hitungan as number) ?? 1;
  return {
    dibolehkan: hitungan <= batasMaksimal,
    hitungan,
  };
}

/**
 * Pembersihan berkala data usang pada tabel wa_rate_limit (> 24 jam) dan wa_messages (> 30 hari).
 * Dijadwalkan melalui after() saat webhook masuk membuat tiket baru, atau dipanggil oleh rutinitas cron.
 */
export async function bersihkanCatatanWaUsang(
  poolOrClient?: Pool | PoolClient
): Promise<{ rateLimitTerhapus: number; pesanTerhapus: number }> {
  const p = poolOrClient ?? getPool();
  try {
    const [resRate, resPesan] = await Promise.all([
      p.query(`DELETE FROM wa_rate_limit WHERE window_mulai < now() - interval '24 hours'`),
      p.query(`DELETE FROM wa_messages WHERE waktu < now() - interval '30 days'`),
    ]);

    return {
      rateLimitTerhapus: resRate.rowCount ?? 0,
      pesanTerhapus: resPesan.rowCount ?? 0,
    };
  } catch (err) {
    console.warn(
      "[WA_BOT] Gagal membersihkan catatan WA lama:",
      ekstrakKodeGalatAman(err, "DB_ERROR")
    );
    return {
      rateLimitTerhapus: 0,
      pesanTerhapus: 0,
    };
  }
}

/**
 * Mengklaim provider_message_id pesan masuk non-tiket di wa_messages secara atomik (Poin 4).
 * Mengembalikan true jika klaim berhasil (pesan baru), false jika duplikat (sudah ada).
 */
export async function klaimPesanMasukNonTiket(
  poolOrClient: Pool | PoolClient,
  msgId: string,
  isi: string
): Promise<boolean> {
  const potongIsi = isi.slice(0, MAKS_SIMPAN_ISI_PESANAN_WA);
  const r = await poolOrClient.query(
    `INSERT INTO wa_messages (customer_id, arah, isi, provider_message_id, order_id)
     VALUES (NULL, 'masuk', $1, $2, NULL)
     ON CONFLICT (provider_message_id) DO NOTHING
     RETURNING id`,
    [potongIsi, msgId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Menjalankan transaksi database atomik untuk membuat tiket dari WhatsApp (Refinements 2, 3, 5, 6, 7, 9).
 */
async function buatTiketDariWa(params: {
  chatId: string;
  senderJid: string;
  nomorWaPelanggan: string;
  namaPelanggan: string;
  apakahLidManual: boolean;
  nomorTerverifikasi: boolean;
  chatHash?: string | null;
  serahTerima: SerahTerima;
  items: Array<{
    service_id: number;
    nama_layanan: string;
    jumlah: number;
    deskripsi_barang: string;
    harga_saat_transaksi: number;
    estimasi_hari: number;
  }>;
  pesanRaw: string;
  providerMsgId: string;
}): Promise<{
  kodeTiket: string;
  estimasiSelesai: Date;
  total: number;
  namaFinal: string;
}> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Klaim provider_message_id atomik di wa_messages (Poin 3)
    const potongIsi = params.pesanRaw.slice(0, MAKS_SIMPAN_ISI_PESANAN_WA);
    const klaimRes = await client.query(
      `INSERT INTO wa_messages (customer_id, arah, isi, provider_message_id, order_id)
       VALUES (NULL, 'masuk', $1, $2, NULL)
       ON CONFLICT (provider_message_id) DO NOTHING
       RETURNING id`,
      [potongIsi, params.providerMsgId]
    );

    if ((klaimRes.rowCount ?? 0) === 0) {
      throw new Error("DUPLICATE_MESSAGE_CLAIM");
    }
    const waMessageId = klaimRes.rows[0].id as number;

    // 2. Tangani Pelanggan: Nama pelanggan yang sudah ada di customers TIDAK boleh ditimpa (Refinement 9).
    const cekCust = await client.query(
      `SELECT id, nama, nomor_wa FROM customers WHERE nomor_wa = $1 FOR UPDATE`,
      [params.nomorWaPelanggan]
    );

    let customerId: number;
    let customerNama: string;

    if ((cekCust.rowCount ?? 0) > 0) {
      customerId = cekCust.rows[0].id;
      customerNama = cekCust.rows[0].nama;
    } else {
      const insCust = await client.query(
        `INSERT INTO customers (nama, nomor_wa)
         VALUES ($1, $2)
         RETURNING id, nama`,
        [params.namaPelanggan, params.nomorWaPelanggan]
      );
      customerId = insCust.rows[0].id;
      customerNama = insCust.rows[0].nama;
    }

    // 3. Kode tiket atomik dari ticket_counters (zona Asia/Jakarta)
    const ctrRes = await client.query(
      `INSERT INTO ticket_counters (tanggal, terakhir)
       VALUES ((now() AT TIME ZONE 'Asia/Jakarta')::date, 1)
       ON CONFLICT (tanggal)
       DO UPDATE SET terakhir = ticket_counters.terakhir + 1
       RETURNING to_char(tanggal, 'YYYYMMDD') AS tgl_teks, terakhir`
    );
    const tglTeks: string = ctrRes.rows[0].tgl_teks;
    const urut: number = ctrRes.rows[0].terakhir;
    const kodeTiket = `${AWALAN_KODE_TIKET}-${tglTeks}-${String(urut).padStart(3, "0")}`;

    // 4. Hitung estimasi selesai default dan total
    const sekarang = new Date();
    const estimasiSelesai = hitungEstimasiSelesaiDefault(
      sekarang,
      params.items.map((it) => it.estimasi_hari)
    );

    let total = 0;
    let totalPasang = 0;
    for (const it of params.items) {
      total += it.harga_saat_transaksi * it.jumlah;
      totalPasang += it.jumlah;
    }

    if (total > BATAS_TOTAL_TIKET) {
      throw new Error("Total tagihan pesanan melebihi batas maksimal Rp 1.000.000.000.");
    }

    // 5. Simpan orders (sumber = 'wa', serah_terima, status_pesanan = 'Belum dicuci', status_bayar = 'Belum bayar')
    const ordRes = await client.query(
      `INSERT INTO orders (
         kode_tiket, customer_id, sumber, dibuat_oleh,
         tanggal_masuk, estimasi_selesai,
         status_pesanan, status_bayar, metode_bayar, tanggal_bayar,
         total, alasan_batal, serah_terima,
         chat_hash, nomor_terverifikasi
       )
       VALUES ($1, $2, 'wa', NULL, $3, $4, 'Belum dicuci', 'Belum bayar', NULL, NULL, $5, NULL, $6, $7, $8)
       RETURNING id`,
      [
        kodeTiket,
        customerId,
        sekarang,
        estimasiSelesai,
        total,
        params.serahTerima,
        params.chatHash ?? null,
        params.nomorTerverifikasi,
      ]
    );
    const orderId = ordRes.rows[0].id as number;

    // 6. Simpan order_items
    for (const it of params.items) {
      await client.query(
        `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, it.service_id, it.deskripsi_barang, it.jumlah, it.harga_saat_transaksi]
      );
    }

    // 7. Simpan audit_logs (TAMBAH_TIKET tanpa mencantumkan nomor WA di log — NFR-06)
    const auditBaru: Record<string, unknown> = {
      kode_tiket: kodeTiket,
      customer_id: customerId,
      sumber: "wa",
      serah_terima: params.serahTerima,
      total,
      jumlah_item: params.items.length,
      jumlah_pasang: totalPasang,
    };
    if (!params.nomorTerverifikasi) {
      auditBaru.nomor_belum_diverifikasi = true;
    }

    await client.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
       VALUES ('orders', $1, 'TAMBAH_TIKET', NULL, $2::jsonb, NULL)`,
      [orderId, JSON.stringify(auditBaru)]
    );

    // 8. Tautkan catatan wa_messages yang telah diklaim di langkah 1 ke customer_id dan order_id
    await client.query(
      `UPDATE wa_messages SET customer_id = $1, order_id = $2 WHERE id = $3`,
      [customerId, orderId, waMessageId]
    );

    await client.query("COMMIT");

    return {
      kodeTiket,
      estimasiSelesai,
      total,
      namaFinal: customerNama,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pemroses utama webhook masuk WhatsApp (Phase 6A).
 */
export async function prosesWebhookMasukWa(
  payloadObj: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined> = process.env
): Promise<HasilProsesWebhook> {
  if (apakahWaGatewayNonaktif(env)) {
    return {
      ok: false,
      kode: 503,
      galat: "Layanan WhatsApp sedang dinonaktifkan (WA_GATEWAY_MODE=nonaktif).",
    };
  }

  if (!payloadObj || typeof payloadObj !== "object" || Array.isArray(payloadObj)) {
    return {
      ok: true,
      diabaikan: true,
      alasan: "Payload webhook bukan object yang valid.",
    };
  }

  // Validasi SESSION_SECRET di awal (Poin 5)
  const valSecret = validasiSessionSecret();
  if (!valSecret.ok) {
    return {
      ok: false,
      kode: 503,
      galat: valSecret.galat,
    };
  }

  const pool = getPool();
  const gateway = ambilWaGateway(env);

  // Ekstrak pesan: mendukung struktur payload bersarang (WAHA standar) maupun datar
  const event = typeof payloadObj.event === "string" ? payloadObj.event : "";
  const subPayload =
    payloadObj.payload && typeof payloadObj.payload === "object" && !Array.isArray(payloadObj.payload)
      ? (payloadObj.payload as Record<string, unknown>)
      : payloadObj;

  // Hanya proses event 'message'
  if (event && event !== "message" && event !== "message.any") {
    return { ok: true, diabaikan: true, alasan: `Event ${event} diabaikan.` };
  }

  const fromMe = Boolean(subPayload.fromMe);
  if (fromMe) {
    return { ok: true, diabaikan: true, alasan: "Pesan dari bot sendiri (fromMe: true)." };
  }

  if (typeof subPayload.from !== "string" || !subPayload.from.trim()) {
    return { ok: true, diabaikan: true, alasan: "Field 'from' tidak ditemukan atau tidak valid." };
  }
  const from = subPayload.from.trim();

  // Abaikan grup WhatsApp (@g.us) dan status broadcast (@broadcast)
  if (from.endsWith("@g.us") || from.includes("status@broadcast")) {
    return { ok: true, diabaikan: true, alasan: "Pesan grup atau status diabaikan." };
  }

  // Refinement 2: Balasan reaktif dikirim ke chatId persis seperti di payload
  const chatId = from;

  // Identifikasi pengirim: JID @c.us atau pemetaan @lid via gateway
  let nomorWaTerverifikasi: string | null = null;
  const senderChatHash = buatChatHash(from);

  if (from.endsWith("@c.us")) {
    const norm = normalisasiNomorWa(from.split("@")[0]);
    if (norm.ok) {
      nomorWaTerverifikasi = norm.nomor;
    }
  } else if (from.endsWith("@lid")) {
    const nomorDariLid = await gateway.petakanLidKeNomor(from);
    if (nomorDariLid) {
      const norm = normalisasiNomorWa(nomorDariLid);
      if (norm.ok) {
        nomorWaTerverifikasi = norm.nomor;
      }
    }
  }

  // Provider Message ID untuk deduplikasi wajib ada (Poin 7)
  const rawId = (subPayload.id as unknown) ?? (payloadObj.id as unknown);
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    return { ok: true, diabaikan: true, alasan: "Pesan tanpa provider message id diabaikan." };
  }
  const msgId = rawId.trim();

  // 1. Cek Deduplikasi awal pesan masuk di tabel wa_messages
  const duplikatCek = await pool.query(
    `SELECT 1 FROM wa_messages WHERE provider_message_id = $1 LIMIT 1`,
    [msgId]
  );
  if ((duplikatCek.rowCount ?? 0) > 0) {
    return { ok: true, duplikat: true, alasan: "Pesan sudah pernah diproses sebelumnya." };
  }

  // 2. Deteksi pesan media (gambar, dokumen, audio, stiker)
  const hasMedia = Boolean(
    subPayload.hasMedia ||
      subPayload.media ||
      subPayload.type === "image" ||
      subPayload.type === "document" ||
      subPayload.type === "video" ||
      subPayload.type === "audio" ||
      subPayload.type === "sticker"
  );

  if (hasMedia) {
    // Klaim ID terlebih dahulu (Poin 4)
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, "[Media Diterima]");
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan media duplikat." };
    }

    // Rate limit untuk panduan media (1 kali per 5 menit per pengirim)
    const rlMedia = await periksaRateLimitAtomik(
      pool,
      from,
      "media_hint",
      "5 minutes",
      1
    );

    if (rlMedia.dibolehkan) {
      await gateway.kirimTeks({
        chatId,
        teks: PESAN_BOT.MEDIA_DITERIMA,
      });
      return { ok: true, balasanTerkirim: true };
    }
    return { ok: true, diabaikan: true, alasan: "Media hint terkena batas jeda." };
  }

  // 3. Tangani Pesan Teks (Validasi tipe data - Poin 8)
  if (subPayload.body !== undefined && typeof subPayload.body !== "string") {
    return { ok: true, diabaikan: true, alasan: "Field 'body' bukan string." };
  }
  const bodyRaw = (subPayload.body as string) ?? "";
  const body = bodyRaw.trim();
  if (body.length === 0) {
    return { ok: true, diabaikan: true, alasan: "Pesan teks kosong." };
  }

  // 4. Rate Limiting Pesan Masuk (12 pesan/menit per pengirim)
  const rlPesan = await periksaRateLimitAtomik(
    pool,
    from,
    "pesan_menit",
    "1 minute",
    BATAS_PESAN_PER_MENIT
  );
  if (!rlPesan.dibolehkan) {
    if (rlPesan.hitungan === BATAS_PESAN_PER_MENIT + 1) {
      await gateway.kirimTeks({
        chatId,
        teks: PESAN_BOT.RATE_LIMIT_PESAN,
      });
    }
    return { ok: true, diabaikan: true, alasan: "Rate limit pesan per menit terlampaui." };
  }

  // 5. Penentuan jenis pesan & perintah
  // 5-STOP. Perintah STOP (Opt-out notifikasi - Phase 6B, FR-24)
  if (adalahPesanStop(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan stop duplikat." };
    }
    if (!nomorWaTerverifikasi) {
      await gateway.kirimTeks({ chatId, teks: PESAN_BOT.NOTIFIKASI_LID_PETUNJUK });
      return { ok: true, balasanTerkirim: true };
    }
    await pool.query(
      `UPDATE customers SET notifikasi_wa_aktif = false WHERE nomor_wa = $1`,
      [nomorWaTerverifikasi]
    );
    await gateway.kirimTeks({ chatId, teks: PESAN_BOT.NOTIFIKASI_DINONAKTIFKAN });
    return { ok: true, balasanTerkirim: true };
  }

  // 5-MULAI. Perintah MULAI (Opt-in notifikasi - Phase 6B, FR-24)
  if (adalahPesanMulai(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan mulai duplikat." };
    }
    if (!nomorWaTerverifikasi) {
      await gateway.kirimTeks({ chatId, teks: PESAN_BOT.NOTIFIKASI_LID_PETUNJUK });
      return { ok: true, balasanTerkirim: true };
    }
    await pool.query(
      `UPDATE customers SET notifikasi_wa_aktif = true WHERE nomor_wa = $1`,
      [nomorWaTerverifikasi]
    );
    await gateway.kirimTeks({ chatId, teks: PESAN_BOT.NOTIFIKASI_DIAKTIFKAN });
    return { ok: true, balasanTerkirim: true };
  }

  // 5A. Perintah MENU / Sapaan
  if (adalahPesanMenu(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan menu duplikat." };
    }
    await gateway.kirimTeks({ chatId, teks: PESAN_BOT.MENU_UTAMA });
    return { ok: true, balasanTerkirim: true };
  }

  // 5B. Perintah 1 / DAFTAR LAYANAN
  if (adalahPesanKatalog(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan katalog duplikat." };
    }
    const layananAktif = await daftarLayananAktif();
    let teksKatalog = "✨ *Daftar Layanan & Harga Solemate Shoes Clean* 👟\n\n";

    if (layananAktif.length === 0) {
      teksKatalog += "Saat ini belum ada layanan yang tersedia.";
    } else {
      layananAktif.forEach((l, idx) => {
        teksKatalog += `${idx + 1}. *${l.nama}*\n`;
        teksKatalog += `   Harga: ${formatRupiah(l.harga)}\n`;
        teksKatalog += `   Estimasi: ${l.estimasi_hari} hari kerja\n\n`;
      });
      teksKatalog += "Ketik *2* untuk panduan format pemesanan cuci sepatu.";
    }

    await gateway.kirimTeks({ chatId, teks: teksKatalog.trim() });
    return { ok: true, balasanTerkirim: true };
  }

  // 5C. Perintah 2 / FORMAT PEMESANAN
  if (adalahPesanFormatPemesanan(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan format duplikat." };
    }
    const teksFormat = buatTeksFormatPemesanan(!nomorWaTerverifikasi);
    await gateway.kirimTeks({ chatId, teks: teksFormat });
    return { ok: true, balasanTerkirim: true };
  }

  // 5D. Perintah 3 / CEK PROGRESS TIKET
  // Menggunakan satu kondisi: nomor terverifikasi ATAU chat_hash milik pengirim (Phase 6A.1)
  if (adalahPesanCekProgress(body)) {
    const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
    if (!klaim) {
      return { ok: true, duplikat: true, alasan: "Pesan cek progress duplikat." };
    }

    const kodeCari = ekstrakKodeTiketCek(body);
    if (kodeCari) {
      // Cek tiket spesifik dengan kondisi: nomor terverifikasi ATAU chat_hash (Poin 2: Tanpa nama pelanggan)
      const r = await pool.query(
        `SELECT
           o.id,
           o.kode_tiket,
           o.status_pesanan,
           o.status_bayar,
           o.total,
           o.estimasi_selesai,
           o.nomor_terverifikasi,
           COALESCE(agg.ringkasan_layanan, '') AS ringkasan_layanan,
           agg.daftar_item
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         ${SQL_LATERAL_RINGKASAN_ITEM}
         WHERE UPPER(o.kode_tiket) = $1
           AND (
             ($2::varchar IS NOT NULL AND c.nomor_wa = $2 AND o.nomor_terverifikasi = true)
             OR
             (o.chat_hash IS NOT NULL AND o.chat_hash = $3)
           )
         LIMIT 1`,
        [kodeCari, nomorWaTerverifikasi, senderChatHash]
      );

      if ((r.rowCount ?? 0) === 0) {
        await gateway.kirimTeks({
          chatId,
          teks: PESAN_BOT.TIKET_TIDAK_DITEMUKAN,
        });
      } else {
        const t = r.rows[0];
        const barisDeskripsi = formatBarisDeskripsiBarangWa(t.daftar_item);
        const pesanRes = `🔍 *Status Pesanan ${t.kode_tiket}*

Layanan: ${t.ringkasan_layanan || "-"}
${barisDeskripsi}
Status Pesanan: *${t.status_pesanan}*
Status Pembayaran: *${t.status_bayar}* (${formatRupiah(t.total)})
Estimasi Selesai: *${t.estimasi_selesai ? formatTanggal(t.estimasi_selesai, { denganWaktu: true }) : "-"}*`;

        await gateway.kirimTeks({ chatId, teks: pesanRes });
      }
    } else {
      // Daftar semua tiket aktif dengan kondisi: nomor terverifikasi ATAU chat_hash
      // ORDER BY id DESC sesuai instruksi (orders tidak memiliki created_at)
      const r = await pool.query(
        `SELECT
           o.id,
           o.kode_tiket,
           o.status_pesanan,
           o.status_bayar,
           o.total,
           COALESCE(agg.ringkasan_layanan, '') AS ringkasan_layanan,
           agg.daftar_item
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         ${SQL_LATERAL_RINGKASAN_ITEM}
         WHERE (
           ($1::varchar IS NOT NULL AND c.nomor_wa = $1 AND o.nomor_terverifikasi = true)
           OR
           (o.chat_hash IS NOT NULL AND o.chat_hash = $2)
         )
           AND o.status_pesanan NOT IN ('Sudah diambil', 'Dibatalkan')
         ORDER BY o.id DESC
         LIMIT 5`,
        [nomorWaTerverifikasi, senderChatHash]
      );

      if ((r.rowCount ?? 0) === 0) {
        await gateway.kirimTeks({
          chatId,
          teks: PESAN_BOT.TIDAK_ADA_TIKET_AKTIF,
        });
      } else {
        let teksDaftar = `👟 *Pesanan Aktif Anda (${r.rows.length})*\n\n`;
        r.rows.forEach((t, i) => {
          const barisDeskripsi = formatBarisDeskripsiBarangWa(t.daftar_item, "   ");
          teksDaftar += `${i + 1}. *${t.kode_tiket}*\n`;
          teksDaftar += `   Layanan: ${t.ringkasan_layanan || "-"}\n`;
          teksDaftar += `${barisDeskripsi}\n`;
          teksDaftar += `   Status: *${t.status_pesanan}*\n`;
          teksDaftar += `   Pembayaran: ${t.status_bayar} (${formatRupiah(t.total)})\n\n`;
        });
        teksDaftar += `Ketik *cek <KODE_TIKET>* untuk rincian (contoh: *cek ${r.rows[0].kode_tiket}*).`;

        await gateway.kirimTeks({ chatId, teks: teksDaftar.trim() });
      }
    }

    return { ok: true, balasanTerkirim: true };
  }

  // 5E. Perintah atau Upaya PEMESANAN CUCI SEPATU
  if (adalahUpayaPemesanan(body)) {
    // Ambil katalog aktif untuk parser & diagnosa
    const layananAktif = await daftarLayananAktif();
    const parse = parsePesanPemesananWa(body, layananAktif);

    if (!parse.ok) {
      // Upaya pemesanan belum sesuai format: klaim id pesan dulu sebelum kirim balasan (Poin 4)
      const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
      if (!klaim) {
        return { ok: true, duplikat: true, alasan: "Upaya pemesanan tidak valid duplikat." };
      }
      const pesanPetunjuk = diagnosaUpayaPemesanan(body, layananAktif, parse.galat);
      await gateway.kirimTeks({ chatId, teks: pesanPetunjuk });
      return { ok: true, balasanTerkirim: true };
    }

    // Pengecekan limit per jam pengirim (hanya untuk pesanan yang valid)
    const rlTiketUser = await periksaRateLimitAtomik(
      pool,
      from,
      "tiket_user_jam",
      "1 hour",
      BATAS_TIKET_BARU_PER_JAM
    );
    if (!rlTiketUser.dibolehkan) {
      const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
      if (!klaim) {
        return { ok: true, duplikat: true, alasan: "Pesanan terkena batas per jam duplikat." };
      }
      await gateway.kirimTeks({
        chatId,
        teks: PESAN_BOT.RATE_LIMIT_TIKET_PENGGUNA,
      });
      return { ok: true, balasanTerkirim: true };
    }

    // Refinement 7: Limit global tiket WhatsApp per jam
    const rlTiketGlobal = await periksaRateLimitAtomik(
      pool,
      "global",
      "tiket_global_jam",
      "1 hour",
      BATAS_GLOBAL_TIKET_WA_PER_JAM
    );
    if (!rlTiketGlobal.dibolehkan) {
      const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
      if (!klaim) {
        return { ok: true, duplikat: true, alasan: "Pesanan terkena batas global duplikat." };
      }
      await gateway.kirimTeks({
        chatId,
        teks: PESAN_BOT.RATE_LIMIT_GLOBAL_PENUH,
      });
      // Catat event audit untuk kasir/owner
      await pool.query(
        `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
         VALUES ('orders', 0, 'BATAS_GLOBAL_TIKET_WA_TERCAPAI', NULL, $1::jsonb, NULL)`,
        [
          JSON.stringify({
            keterangan: "Batas 30 tiket WA per jam tercapai",
            waktu: new Date().toISOString(),
          }),
        ]
      );
      return { ok: true, balasanTerkirim: true };
    }

    // Tentukan nomor WhatsApp pelanggan & status verifikasi nomor (Phase 6A.1 & Poin 1)
    let nomorWaFinal: string;
    let nomorTerverifikasi: boolean;
    let apakahLidManual = false;

    if (nomorWaTerverifikasi) {
      // Pengirim terverifikasi (baik @c.us maupun @lid yang berhasil dipetakan)
      // SELALU memakai nomor terverifikasi dari webhook. Baris "Nomor WA:" diabaikan untuknya (Poin 1).
      nomorWaFinal = nomorWaTerverifikasi;
      nomorTerverifikasi = true;
    } else {
      // Pengirim @lid yang tidak terpetakan: wajib menyertakan nomor WA yang diketik
      if (!parse.nomor_wa_manual) {
        const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
        if (!klaim) {
          return { ok: true, duplikat: true, alasan: "Pesan LID tanpa nomor manual duplikat." };
        }
        await gateway.kirimTeks({
          chatId,
          teks: PESAN_BOT.LID_ORDER_BUTUH_NOMOR,
        });
        return { ok: true, balasanTerkirim: true };
      }
      nomorWaFinal = parse.nomor_wa_manual;
      nomorTerverifikasi = false;
      apakahLidManual = true;
    }

    // Cek batas tiket aktif yang belum dicuci untuk nomor ini (maks 5)
    const hitungBelumDicuci = await pool.query(
      `SELECT COUNT(*)::int AS jumlah
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE c.nomor_wa = $1 AND o.status_pesanan = 'Belum dicuci'`,
      [nomorWaFinal]
    );
    const jmlBelumDicuci = (hitungBelumDicuci.rows[0]?.jumlah as number) ?? 0;
    if (jmlBelumDicuci >= MAKS_TIKET_BELUM_DICUCI_PER_NOMOR) {
      const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
      if (!klaim) {
        return { ok: true, duplikat: true, alasan: "Pesanan melampaui batas aktif duplikat." };
      }
      await gateway.kirimTeks({
        chatId,
        teks: PESAN_BOT.MAKS_TIKET_AKTIF_TERCAPAI(jmlBelumDicuci),
      });
      return { ok: true, balasanTerkirim: true };
    }

    // Buat tiket dalam transaksi atomik (Poin 3)
    let hasilTiket: {
      kodeTiket: string;
      estimasiSelesai: Date;
      total: number;
      namaFinal: string;
    };

    try {
      hasilTiket = await buatTiketDariWa({
        chatId,
        senderJid: from,
        nomorWaPelanggan: nomorWaFinal,
        namaPelanggan: parse.nama,
        apakahLidManual,
        nomorTerverifikasi,
        chatHash: senderChatHash,
        serahTerima: parse.serah_terima,
        items: parse.items,
        pesanRaw: body,
        providerMsgId: msgId,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "DUPLICATE_MESSAGE_CLAIM") {
        return {
          ok: true,
          duplikat: true,
          alasan: "Pesan tiket duplikat terdeteksi pada transaksi klaim pesan.",
        };
      }
      throw err;
    }

    // Susun balasan konfirmasi sukses pemesanan
    const labelSerahTerima =
      parse.serah_terima === "jemput" ? "Jemput oleh Tim Solemate" : "Antar Sendiri ke Toko";

    // Balasan sukses memakai nama yang diketik pengirim (parse.nama), tidak pernah nama tersimpan di customers, untuk SEMUA jenis pengirim (Poin 1)
    const namaBalasan = parse.nama;

    // Petunjuk cek progress dinamis sesuai kemampuan pengirim (Phase 6A.1)
    let teksPetunjukCek: string;
    if (nomorTerverifikasi) {
      teksPetunjukCek = `_Ketik *cek ${hasilTiket.kodeTiket}* kapan saja untuk memeriksa perkembangan pesanan Anda._`;
    } else if (senderChatHash) {
      teksPetunjukCek = `_Ketik *cek ${hasilTiket.kodeTiket}* dari chat ini kapan saja untuk memeriksa perkembangan pesanan Anda._`;
    } else {
      teksPetunjukCek = `_Simpan kode tiket Anda. Untuk informasi status pesanan, silakan hubungi kasir toko._`;
    }

    let teksSukses = `✅ *Pesanan Berhasil Dicatat!* 👟

Kode Tiket: *${hasilTiket.kodeTiket}*
Nama: *${namaBalasan}*
Metode: *${labelSerahTerima}*
Total Tagihan: *${formatRupiah(hasilTiket.total)}* (Belum bayar)
Estimasi Selesai: *${formatTanggal(hasilTiket.estimasiSelesai, { denganWaktu: true })}*

Rincian Barang:
`;
    parse.items.forEach((it, idx) => {
      teksSukses += `${idx + 1}. ${it.jumlah}x ${it.nama_layanan} — ${it.deskripsi_barang}\n`;
    });

    teksSukses += `
_Status pesanan: *Belum dicuci*._
${teksPetunjukCek}
_Terima kasih telah mencuci sepatu di Solemate!_`;

    await gateway.kirimTeks({ chatId, teks: teksSukses.trim() });

    return {
      ok: true,
      kodeTiket: hasilTiket.kodeTiket,
      balasanTerkirim: true,
    };
  }

  // 5F. Perintah tidak dikenal: tawarkan panduan menu
  const klaim = await klaimPesanMasukNonTiket(pool, msgId, body);
  if (!klaim) {
    return { ok: true, duplikat: true, alasan: "Pesan tidak dikenal duplikat." };
  }

  const teksBantuan = `Halo! Perintah tidak dikenali 🤔

Ketik *MENU* untuk melihat pilihan menu, atau ketik *2* untuk melihat panduan format pemesanan cuci sepatu.`;

  await gateway.kirimTeks({ chatId, teks: teksBantuan });

  return { ok: true, balasanTerkirim: true };
}
