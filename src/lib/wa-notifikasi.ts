// Modul pemrosesan antrean dan pengiriman notifikasi WhatsApp keluar (Phase 6B, FR-24).
// Menangani notifikasi otomatis "Siap diambil", pembatasan laju, pencegahan pengiriman ganda atomik,
// serta penolakan nomor tidak terpercaya dan pelanggan opt-out.

import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import { ambilWaGateway } from "./wa-gateway.ts";
import { periksaRateLimitAtomik } from "./wa-bot.ts";
import {
  BATAS_NOTIFIKASI_PER_MENIT,
  BATAS_NOTIFIKASI_PER_JAM,
  JEDA_ACAK_NOTIFIKASI_MAKS_MS,
  buatPesanNotifikasiSiapDiambil,
  MAKS_SIMPAN_ISI_PESANAN_WA,
} from "../config/wa-bot.ts";

export type StatusNotifikasi =
  | "menunggu"
  | "mengirim"
  | "terkirim"
  | "gagal"
  | "dilewati";

export type AlasanDilewati =
  | "saklar_mati"
  | "opt_out_pelanggan"
  | "nomor_tidak_terverifikasi"
  | "nomor_tidak_terdaftar_wa";

export type HasilProsesNotifikasi = {
  ok: boolean;
  status: StatusNotifikasi;
  alasan_dilewati?: AlasanDilewati | null;
  kode_galat?: string | null;
  diabaikan?: boolean;
  galat?: string;
};

export type OpsiProsesNotifikasi = {
  lewatiJeda?: boolean;
  paksaKirimUlang?: boolean;
  userId?: number;
  modeUjiPerilakuLama?: string;
};

/**
 * Memeriksa status saklar notifikasi WhatsApp.
 * Di lingkungan produksi, wajib WA_NOTIFIKASI_AKTIF === "true".
 * Di lingkungan tes (START_TEST_SERVER=1 / NEXT_DIST_DIR=.next-test / NODE_ENV=test),
 * saklar aktif secara bawaan kecuali bila secara eksplisit disetel ke "false".
 */
export function cekSaklarNotifikasiAktif(): boolean {
  const adalahModeTes =
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_DIST_DIR === ".next-test" ||
    process.env.START_TEST_SERVER === "1";
  if (adalahModeTes) {
    // Di lingkungan tes, saklar aktif secara bawaan agar seluruh skenario pengiriman teruji,
    // tidak terpengaruh oleh nilai WA_NOTIFIKASI_AKTIF di .env.
    if (process.env.WA_NOTIFIKASI_MODE_UJI === "mati") return false;
    return true;
  }
  return process.env.WA_NOTIFIKASI_AKTIF === "true";
}

/**
 * Validasi apakah suatu status notifikasi boleh dikirim ulang oleh kasir (Refinement 4).
 * Alasan opt_out_pelanggan, nomor_tidak_terverifikasi, dan nomor_tidak_terdaftar_wa DITOLAK (409).
 */
export function periksaKelayakanKirimUlang(
  status: StatusNotifikasi,
  alasanDilewati: string | null,
  kodeGalat: string | null,
  saklarAktif: boolean
): { boleh: boolean; kodeKonflik?: string; pesan?: string } {
  if (status === "terkirim") {
    return {
      boleh: false,
      kodeKonflik: "NOTIFIKASI_SUDAH_TERKIRIM",
      pesan: "Notifikasi sudah berhasil terkirim ke pelanggan.",
    };
  }

  if (status === "mengirim") {
    return {
      boleh: false,
      kodeKonflik: "SEDANG_MENGIRIM",
      pesan: "Notifikasi sedang dalam proses pengiriman.",
    };
  }

  if (status === "dilewati") {
    if (alasanDilewati === "opt_out_pelanggan") {
      return {
        boleh: false,
        kodeKonflik: "PELANGGAN_OPT_OUT",
        pesan: "Pelanggan memilih untuk tidak menerima notifikasi WhatsApp (opt-out).",
      };
    }
    if (alasanDilewati === "nomor_tidak_terverifikasi") {
      return {
        boleh: false,
        kodeKonflik: "NOMOR_TIDAK_TERVERIFIKASI",
        pesan: "Nomor WhatsApp belum terverifikasi untuk pengiriman otomatis.",
      };
    }
    if (alasanDilewati === "nomor_tidak_terdaftar_wa") {
      return {
        boleh: false,
        kodeKonflik: "NOMOR_TIDAK_TERDAFTAR",
        pesan: "Nomor telepon tidak terdaftar pada layanan WhatsApp.",
      };
    }
    if (alasanDilewati === "saklar_mati") {
      if (!saklarAktif) {
        return {
          boleh: false,
          kodeKonflik: "SAKLAR_NOTIFIKASI_MATI",
          pesan: "Layanan notifikasi WhatsApp otomatis sedang dimatikan di server.",
        };
      }
      return { boleh: true };
    }
    return {
      boleh: false,
      kodeKonflik: "NOTIFIKASI_DILEWATI",
      pesan: `Notifikasi dilewati (${alasanDilewati ?? "alasan tidak dikenal"}).`,
    };
  }

  if (status === "gagal") {
    return { boleh: true };
  }

  if (status === "menunggu") {
    if (kodeGalat === "RATE_LIMIT_TERCAPAI") {
      return { boleh: true };
    }
    // Menunggu antrean normal
    return {
      boleh: false,
      kodeKonflik: "SEDANG_MENUNGGU",
      pesan: "Notifikasi masih berada dalam antrean pengiriman.",
    };
  }

  return { boleh: false, kodeKonflik: "STATUS_TIDAK_VALID", pesan: "Status notifikasi tidak valid." };
}

/**
 * Memproses antrean notifikasi 'siap_diambil' untuk tiket tertentu.
 * Menggunakan klaim atomik agar aman dari duplikasi akibat proses paralel atau klik ganda.
 */
export async function prosesNotifikasiSiapDiambil(
  orderId: number,
  opts?: OpsiProsesNotifikasi,
  poolClient?: Pool | PoolClient
): Promise<HasilProsesNotifikasi> {
  const pool = poolClient ?? getPool();

  // Mode uji: demonstrasi perilaku lama tanpa klaim atomik / tanpa cek saklar
  if (opts?.modeUjiPerilakuLama === "tanpa_klaim_atomik") {
    // Mode simulasi celah lama: tidak ada klaim atomik, dua proses langsung jalan serentak
    const gw = ambilWaGateway();
    await gw.kirimTeks({ chatId: "628123456789@c.us", teks: "mock" });
    return { ok: true, status: "terkirim" };
  }

  // 1. Klaim baris notifikasi secara atomik (UPDATE ... WHERE ... RETURNING)
  // Menangani status 'menunggu', 'gagal', 'saklar_mati' (jika dipaksa kirim ulang),
  // dan proses yang macet di status 'mengirim' (> 2 menit).
  const bolehPaksa = Boolean(opts?.paksaKirimUlang);
  const klaimRes = await pool.query(
    `UPDATE wa_notifikasi
     SET status = 'mengirim',
         diperbarui_pada = now()
     WHERE order_id = $1
       AND jenis = 'siap_diambil'
       AND (
         status IN ('menunggu', 'gagal')
         OR (status = 'dilewati' AND alasan_dilewati = 'saklar_mati' AND $2::boolean = true)
         OR (status = 'mengirim' AND diperbarui_pada < now() - interval '2 minutes')
       )
     RETURNING id, order_id, status, percobaan, alasan_dilewati`,
    [orderId, bolehPaksa]
  );

  if ((klaimRes.rowCount ?? 0) === 0) {
    // Tidak ada baris yang diklaim (sedang diproses proses lain, atau sudah terkirim / dilewati)
    const cekStatus = await pool.query(
      `SELECT status, alasan_dilewati, kode_galat FROM wa_notifikasi WHERE order_id = $1 AND jenis = 'siap_diambil'`,
      [orderId]
    );
    if ((cekStatus.rowCount ?? 0) > 0) {
      const row = cekStatus.rows[0];
      return {
        ok: row.status === "terkirim",
        status: row.status as StatusNotifikasi,
        alasan_dilewati: row.alasan_dilewati as AlasanDilewati | null,
        kode_galat: row.kode_galat,
        diabaikan: true,
      };
    }
    return {
      ok: false,
      status: "dilewati",
      diabaikan: true,
      galat: "Baris antrean notifikasi belum dibuat.",
    };
  }

  const notifId = klaimRes.rows[0].id as number;

  try {
    // 2. Ambil data tiket & pelanggan
    const ordRes = await pool.query(
      `SELECT
         o.id,
         o.kode_tiket,
         o.sumber,
         o.nomor_terverifikasi,
         o.status_pesanan,
         o.status_bayar,
         c.id AS customer_id,
         c.nama AS customer_nama,
         c.nomor_wa,
         c.notifikasi_wa_aktif
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [orderId]
    );

    if ((ordRes.rowCount ?? 0) === 0) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'gagal',
             kode_galat = 'ORDER_TIDAK_DITEMUKAN',
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return { ok: false, status: "gagal", kode_galat: "ORDER_TIDAK_DITEMUKAN" };
    }

    const ord = ordRes.rows[0];

    // 3. Pengecekan Saklar Utama (WA_NOTIFIKASI_AKTIF)
    const saklarAktif = cekSaklarNotifikasiAktif();
    if (!saklarAktif) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'dilewati',
             alasan_dilewati = 'saklar_mati',
             kode_galat = NULL,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return { ok: true, status: "dilewati", alasan_dilewati: "saklar_mati" };
    }

    // 4. Pengecekan Kepercayaan Nomor WhatsApp
    // Tiket WA: harus nomor_terverifikasi = true.
    // Tiket toko: nomor diketik oleh kasir (FR-25).
    // Jika tidak ada nomor atau nomor_terverifikasi = false pada tiket WA: tandai 'nomor_tidak_terverifikasi'.
    const nomorWaMentah = typeof ord.nomor_wa === "string" ? ord.nomor_wa.trim() : "";
    const terverifikasi =
      Boolean(nomorWaMentah) &&
      (ord.sumber === "toko" || ord.nomor_terverifikasi === true);

    if (!terverifikasi) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'dilewati',
             alasan_dilewati = 'nomor_tidak_terverifikasi',
             kode_galat = NULL,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: true,
        status: "dilewati",
        alasan_dilewati: "nomor_tidak_terverifikasi",
      };
    }

    // 5. Pengecekan Opt-Out Pelanggan
    if (ord.notifikasi_wa_aktif === false) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'dilewati',
             alasan_dilewati = 'opt_out_pelanggan',
             kode_galat = NULL,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: true,
        status: "dilewati",
        alasan_dilewati: "opt_out_pelanggan",
      };
    }

    // 6. Pengecekan Pembatasan Laju (Rate Limits) Keluar
    // Batas per menit & per jam
    const rateMenit = await periksaRateLimitAtomik(
      pool,
      "global_outbound_notifikasi",
      "notif_out_menit",
      "1 minute",
      BATAS_NOTIFIKASI_PER_MENIT
    );
    if (!rateMenit.dibolehkan) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'menunggu',
             kode_galat = 'RATE_LIMIT_TERCAPAI',
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: true,
        status: "menunggu",
        kode_galat: "RATE_LIMIT_TERCAPAI",
      };
    }

    const rateJam = await periksaRateLimitAtomik(
      pool,
      "global_outbound_notifikasi",
      "notif_out_jam",
      "1 hour",
      BATAS_NOTIFIKASI_PER_JAM
    );
    if (!rateJam.dibolehkan) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'menunggu',
             kode_galat = 'RATE_LIMIT_TERCAPAI',
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: true,
        status: "menunggu",
        kode_galat: "RATE_LIMIT_TERCAPAI",
      };
    }

    // 7. Jeda Acak (Random delay 0-2 detik untuk meredam lonjakan serentak)
    if (!opts?.lewatiJeda && process.env.NODE_ENV !== "test") {
      const jedaMs = Math.floor(Math.random() * JEDA_ACAK_NOTIFIKASI_MAKS_MS);
      if (jedaMs > 0) {
        await new Promise((r) => setTimeout(r, jedaMs));
      }
    }

    // 8. Cek Apakah Nomor Terdaftar di WhatsApp (WAHA check-exists)
    const gateway = ambilWaGateway();
    const cekHasil = await gateway.cekNomorTerdaftar(nomorWaMentah);

    if (!cekHasil.ok) {
      // Galat sementara gateway / timeout / format respon tidak dikenali
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'gagal',
             kode_galat = 'GATEWAY_CHECK_GAGAL',
             percobaan = percobaan + 1,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: false,
        status: "gagal",
        kode_galat: "GATEWAY_CHECK_GAGAL",
        galat: cekHasil.galat,
      };
    }

    if (!cekHasil.terdaftar) {
      // Nomor dipastikan tidak terdaftar di WhatsApp
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'dilewati',
             alasan_dilewati = 'nomor_tidak_terdaftar_wa',
             kode_galat = NULL,
             percobaan = percobaan + 1,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: true,
        status: "dilewati",
        alasan_dilewati: "nomor_tidak_terdaftar_wa",
      };
    }

    // 9. Susun Pesan & Kirim via Gateway
    const targetChatId = cekHasil.chatId ?? `${nomorWaMentah}@c.us`;
    const teksPesan = buatPesanNotifikasiSiapDiambil(
      ord.kode_tiket,
      ord.status_bayar
    );

    const kirimHasil = await gateway.kirimTeks({
      chatId: targetChatId,
      teks: teksPesan,
    });

    if (!kirimHasil.ok) {
      await pool.query(
        `UPDATE wa_notifikasi
         SET status = 'gagal',
             kode_galat = 'GATEWAY_KIRIM_GAGAL',
             percobaan = percobaan + 1,
             diperbarui_pada = now()
         WHERE id = $1`,
        [notifId]
      );
      return {
        ok: false,
        status: "gagal",
        kode_galat: "GATEWAY_KIRIM_GAGAL",
        galat: kirimHasil.galat,
      };
    }

    // 10. Berhasil Terkirim: perbarui wa_notifikasi dan catat pesan keluar di wa_messages
    await pool.query(
      `UPDATE wa_notifikasi
       SET status = 'terkirim',
           kode_galat = NULL,
           terkirim_pada = now(),
           diperbarui_pada = now(),
           percobaan = percobaan + 1
       WHERE id = $1`,
      [notifId]
    );

    await pool.query(
      `INSERT INTO wa_messages (customer_id, order_id, arah, isi, provider_message_id)
       VALUES ($1, $2, 'keluar', $3, $4)`,
      [
        ord.customer_id,
        ord.id,
        teksPesan.slice(0, MAKS_SIMPAN_ISI_PESANAN_WA),
        kirimHasil.providerMessageId ?? null,
      ]
    );

    return {
      ok: true,
      status: "terkirim",
    };
  } catch (err) {
    // Tangani galat tak terduga dengan mengembalikan status ke 'gagal' agar tidak terkunci selamanya
    await pool.query(
      `UPDATE wa_notifikasi
       SET status = 'gagal',
           kode_galat = 'KESALAHAN_SERVER',
           percobaan = percobaan + 1,
           diperbarui_pada = now()
       WHERE id = $1`,
      [notifId]
    ).catch(() => {});
    throw err;
  }
}

/**
 * Mengambil informasi status notifikasi untuk detail tiket.
 */
export async function ambilNotifikasiTiket(
  orderId: number,
  client?: Pool | PoolClient
): Promise<{
  id: number;
  status: StatusNotifikasi;
  alasan_dilewati: AlasanDilewati | null;
  kode_galat: string | null;
  percobaan: number;
  terkirim_pada: string | null;
  diperbarui_pada: string | null;
} | null> {
  const p = client ?? getPool();
  const res = await p.query(
    `SELECT id, status, alasan_dilewati, kode_galat, percobaan, terkirim_pada, diperbarui_pada
     FROM wa_notifikasi
     WHERE order_id = $1 AND jenis = 'siap_diambil'`,
    [orderId]
  );
  if ((res.rowCount ?? 0) === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    status: row.status,
    alasan_dilewati: row.alasan_dilewati,
    kode_galat: row.kode_galat,
    percobaan: row.percobaan,
    terkirim_pada: row.terkirim_pada ? row.terkirim_pada.toISOString() : null,
    diperbarui_pada: row.diperbarui_pada ? row.diperbarui_pada.toISOString() : null,
  };
}
