// Akses data Tiket Pesanan (Phase 5A):
// - Pengecekan pelanggan berdasar nomor WA baku
// - Pembuatan tiket toko dalam SATU transaksi database atomik (pelanggan, counter kode tiket,
//   orders, order_items, dan audit_logs)
// - Daftar tiket dengan filter tanggal Asia/Jakarta, urutan Belum bayar di SQL sebelum LIMIT/OFFSET,
//   pencarian berparameter, dan paginasi
// - Detail tiket lengkap beserta item dan riwayat audit hanya-baca

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import {
  AWALAN_KODE_TIKET,
  BATAS_TOTAL_TIKET,
  MASA_SIMPAN_IDEMPOTENSI_JAM,
  MIN_HARI_BELUM_DIAMBIL,
  hitungEstimasiSelesaiDefault,
} from "../config/tiket.ts";
import {
  periksaTransisiStatusPesanan,
  bolehBatalkanTiket,
  type StatusPesanan,
  type StatusBayar,
  type MetodeBayar,
} from "../config/order-status.ts";
import type {
  FilterDaftarTiket,
  InputBuatTiket,
  InputUbahTiket,
} from "./tiket-validasi.ts";

export type InfoPelangganTiket = {
  id: number;
  nama: string;
  nomor_wa: string;
  notifikasi_wa_aktif?: boolean;
};

export type ItemTiket = {
  id: number;
  service_id: number;
  nama_layanan: string;
  deskripsi_barang: string;
  jumlah: number;
  harga_saat_transaksi: number;
  subtotal: number;
};

export type PeringatanNamaPelanggan = {
  kode: "NAMA_PELANGGAN_BERBEDA";
  pesan: string;
  nama_tersimpan: string;
  nama_dikirim: string;
};

export type InfoNotifikasiTiket = {
  id: number;
  status: "menunggu" | "mengirim" | "terkirim" | "gagal" | "dilewati";
  alasan_dilewati: string | null;
  kode_galat: string | null;
  percobaan: number;
  terkirim_pada: string | null;
  diperbarui_pada: string | null;
};

export type RingkasanTiket = {
  id: number;
  kode_tiket: string;
  sumber: "wa" | "toko";
  tanggal_masuk: string;
  estimasi_selesai: string | null;
  status_pesanan: StatusPesanan;
  siap_diambil_pada: string | null;
  hari_belum_diambil: number | null;
  terlambat_ambil: boolean;
  status_bayar: StatusBayar;
  metode_bayar: MetodeBayar | null;
  tanggal_bayar: string | null;
  total: number;
  jumlah_item: number;
  jumlah_pasang: number;
  ringkasan_layanan: string;
  nomor_terverifikasi: boolean;
  notifikasi_status?: string | null;
  notifikasi_gagal?: boolean;
  pelanggan: InfoPelangganTiket;
};

export type RiwayatAuditTiket = {
  id: number;
  aksi: string;
  nilai_lama: Record<string, unknown> | null;
  nilai_baru: Record<string, unknown> | null;
  user_id: number | null;
  nama_pengguna: string | null;
  waktu: string;
};

export type DetailTiket = {
  id: number;
  kode_tiket: string;
  sumber: "wa" | "toko";
  serah_terima?: "antar_sendiri" | "jemput" | null;
  dibuat_oleh: number | null;
  nama_pembuat: string | null;
  tanggal_masuk: string;
  estimasi_selesai: string | null;
  status_pesanan: StatusPesanan;
  siap_diambil_pada: string | null;
  hari_belum_diambil: number | null;
  terlambat_ambil: boolean;
  status_bayar: StatusBayar;
  metode_bayar: MetodeBayar | null;
  tanggal_bayar: string | null;
  total: number;
  alasan_batal: string | null;
  jumlah_item: number;
  jumlah_pasang: number;
  ringkasan_layanan: string;
  nomor_terverifikasi: boolean;
  notifikasi?: InfoNotifikasiTiket | null;
  pelanggan: InfoPelangganTiket;
  items: ItemTiket[];
  riwayat_audit: RiwayatAuditTiket[];
};

export type HasilUbahTiket =
  | {
      ok: true;
      tiket: DetailTiket;
      idempoten: boolean;
      notifikasiDibuat?: boolean;
    }
  | {
      ok: false;
      kode: 400 | 404 | 409;
      kode_konflik?: string;
      galat: string;
      field?: string;
      tiket?: DetailTiket | null;
    };

export type HasilBuatTiket =
  | {
      ok: true;
      tiket: DetailTiket;
      peringatan: PeringatanNamaPelanggan | null;
      duplikat?: boolean;
    }
  | {
      ok: false;
      kode: number;
      galat: string;
      field?: string;
    };

export type HasilDaftarTiket = {
  data: RingkasanTiket[];
  paginasi: {
    halaman: number;
    ukuran: number;
    total_data: number;
    total_halaman: number;
  };
};

class GalatBisnisTiket extends Error {
  readonly kode: number;
  readonly field?: string;
  constructor(pesan: string, field?: string, kode: number = 400) {
    super(pesan);
    this.name = "GalatBisnisTiket";
    this.kode = kode;
    this.field = field;
  }
}

/**
 * Menghitung representasi hash kanonikal dari isi permintaan pembuatan tiket (SHA-256).
 * Digunakan untuk memastikan kunci idempotensi yang sama tidak disalahgunakan
 * dengan isi formulir atau pengguna yang berbeda (deteksi konflik 409).
 */
export function hitungHashPermintaanTiket(input: InputBuatTiket): string {
  const kanonikal = {
    nama_pelanggan: input.nama_pelanggan.trim(),
    nomor_wa: input.nomor_wa,
    konfirmasi_ubah_nama: Boolean(input.konfirmasi_ubah_nama),
    items: [...input.items]
      .sort((a, b) => a.service_id - b.service_id || a.deskripsi_barang.localeCompare(b.deskripsi_barang) || a.jumlah - b.jumlah)
      .map((it) => ({
        service_id: it.service_id,
        deskripsi_barang: it.deskripsi_barang.trim(),
        jumlah: it.jumlah,
      })),
    tanggal_masuk: input.tanggal_masuk_diisi
      ? input.tanggal_masuk instanceof Date
        ? input.tanggal_masuk.toISOString()
        : new Date(input.tanggal_masuk).toISOString()
      : null,
    estimasi_selesai: input.estimasi_selesai
      ? input.estimasi_selesai instanceof Date
        ? input.estimasi_selesai.toISOString()
        : new Date(input.estimasi_selesai).toISOString()
      : null,
    status_bayar: input.status_bayar,
    metode_bayar: input.metode_bayar ?? null,
  };
  return createHash("sha256").update(JSON.stringify(kanonikal)).digest("hex");
}

export async function dalamTransaksi<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let rusak: unknown = null;
  try {
    await client.query("BEGIN");
    const hasil = await fn(client);
    await client.query("COMMIT");
    return hasil;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      rusak = rbErr ?? true;
    }
    throw err;
  } finally {
    if (rusak) {
      client.release(rusak instanceof Error ? rusak : true);
    } else {
      client.release();
    }
  }
}

function keIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function escapeIlike(teks: string): string {
  return teks.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Mencari pelanggan yang sudah terdaftar berdasarkan nomor WA baku.
 * Tidak pernah menulis nomor WA ke log aplikasi.
 */
export async function cekPelangganByNomorWa(
  nomorWaBaku: string
): Promise<{ ditemukan: boolean; pelanggan: InfoPelangganTiket | null }> {
  const r = await getPool().query(
    `SELECT id, nama, nomor_wa FROM customers WHERE nomor_wa = $1 LIMIT 1`,
    [nomorWaBaku]
  );
  if ((r.rowCount ?? 0) === 0) {
    return { ditemukan: false, pelanggan: null };
  }
  const b = r.rows[0];
  return {
    ditemukan: true,
    pelanggan: { id: b.id, nama: b.nama, nomor_wa: b.nomor_wa },
  };
}

/**
 * Membuat tiket walk-in toko dalam SATU transaksi database:
 * 1. Verifikasi seluruh layanan aktif & hitung sendiri harga_saat_transaksi serta total (Zero Trust).
 * 2. Tolak bila total > BATAS_TOTAL_TIKET (Rp 1.000.000.000).
 * 3. Buat/pakai ulang pelanggan lewat INSERT ... ON CONFLICT (nomor_wa) DO NOTHING lalu SELECT.
 * 4. Ambil nomor urut harian kode tiket secara atomik dari ticket_counters (tanggal terbit WIB).
 * 5. Simpan orders, order_items, dan audit_logs (TAMBAH_TIKET tanpa nomor WA).
 */
export async function buatTiketToko(
  input: InputBuatTiket,
  userId: number,
  sekarang: Date = new Date()
): Promise<HasilBuatTiket> {
  const reqHash = hitungHashPermintaanTiket(input);

  try {
    return await dalamTransaksi(async (c) => {
      // 0. Bersihkan kunci idempotensi usang (> 24 jam) secara berkala/oportunistik
      await c
        .query(
          `DELETE FROM ticket_idempotency WHERE created_at < now() - interval '24 hours'`
        )
        .catch(() => {});

      // 0b. Cek kunci idempotensi bila disediakan: jika sudah ada, validasi kesesuaian pengguna dan isi permintaan
      if (input.idempotency_key) {
        const existingKey = await c.query(
          `SELECT order_id, user_id, request_hash FROM ticket_idempotency WHERE key = $1`,
          [input.idempotency_key]
        );
        if ((existingKey.rowCount ?? 0) > 0) {
          const row = existingKey.rows[0];
          if (row.user_id !== userId || row.request_hash !== reqHash) {
            throw new GalatBisnisTiket(
              "Kunci idempotensi sudah pernah digunakan dengan data atau pengguna yang berbeda.",
              "idempotency_key",
              409
            );
          }
          const orderId = row.order_id as number;
          const tiketLama = await ambilDetailTiketDenganClient(c, orderId);
          if (tiketLama) {
            return { ok: true, tiket: tiketLama, peringatan: null, duplikat: true };
          }
        }
      }

      // 1. Ambil layanan dari database (tidak percaya harga/total dari klien).
      // Menggunakan FOR SHARE agar baris layanan terkunci dari perubahan saat transaksi berlangsung.
      const unikServiceIds = Array.from(new Set(input.items.map((it) => it.service_id)));
      const svcRes = await c.query(
        `SELECT id, nama, harga, estimasi_hari, aktif
           FROM services
          WHERE id = ANY($1::int[])
          FOR SHARE`,
        [unikServiceIds]
      );
      const petaLayanan = new Map<
        number,
        { id: number; nama: string; harga: number; estimasi_hari: number; aktif: boolean }
      >();
      for (const baris of svcRes.rows) {
        petaLayanan.set(baris.id, baris);
      }

      const itemSiapSimpan: Array<{
        service_id: number;
        nama_layanan: string;
        deskripsi_barang: string;
        jumlah: number;
        harga_saat_transaksi: number;
        subtotal: number;
        estimasi_hari: number;
      }> = [];

      let total = 0;
      let jumlahPasang = 0;

      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        const layanan = petaLayanan.get(it.service_id);
        if (!layanan) {
          throw new GalatBisnisTiket(
            "Layanan yang dipilih tidak ditemukan.",
            `items.${i}.service_id`
          );
        }
        if (!layanan.aktif) {
          throw new GalatBisnisTiket(
            `Layanan "${layanan.nama}" sedang nonaktif.`,
            `items.${i}.service_id`
          );
        }
        const hargaSaatTransaksi = layanan.harga;
        const subtotal = hargaSaatTransaksi * it.jumlah;
        total += subtotal;
        jumlahPasang += it.jumlah;

        if (total > BATAS_TOTAL_TIKET) {
          throw new GalatBisnisTiket(
            "Total tiket melebihi batas maksimal Rp 1.000.000.000."
          );
        }

        itemSiapSimpan.push({
          service_id: layanan.id,
          nama_layanan: layanan.nama,
          deskripsi_barang: it.deskripsi_barang,
          jumlah: it.jumlah,
          harga_saat_transaksi: hargaSaatTransaksi,
          subtotal,
          estimasi_hari: layanan.estimasi_hari,
        });
      }

      // 2. Pelanggan: INSERT ... ON CONFLICT (nomor_wa) DO NOTHING lalu SELECT bila sudah ada.
      let pelanggan: InfoPelangganTiket;
      let peringatan: PeringatanNamaPelanggan | null = null;
      const notifAktifAwal = !input.jangan_kirim_notifikasi_wa;

      const insCust = await c.query(
        `INSERT INTO customers (nama, nomor_wa, notifikasi_wa_aktif)
         VALUES ($1, $2, $3)
         ON CONFLICT (nomor_wa) DO NOTHING
         RETURNING id, nama, nomor_wa, notifikasi_wa_aktif`,
        [input.nama_pelanggan, input.nomor_wa, notifAktifAwal]
      );

      if ((insCust.rowCount ?? 0) === 1) {
        pelanggan = insCust.rows[0];
      } else {
        const selCust = await c.query(
          `SELECT id, nama, nomor_wa, notifikasi_wa_aktif
             FROM customers
            WHERE nomor_wa = $1
            FOR UPDATE`,
          [input.nomor_wa]
        );
        if ((selCust.rowCount ?? 0) === 0) {
          throw new Error("Pelanggan tidak ditemukan setelah pemeriksaan konflik nomor WA.");
        }
        pelanggan = selCust.rows[0];

        // Jika kasir mencentang "Jangan kirim notifikasi WhatsApp" untuk pelanggan yang sudah ada
        if (input.jangan_kirim_notifikasi_wa && pelanggan.notifikasi_wa_aktif !== false) {
          await c.query(
            `UPDATE customers SET notifikasi_wa_aktif = false WHERE id = $1`,
            [pelanggan.id]
          );
          pelanggan.notifikasi_wa_aktif = false;
          await c.query(
            `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
             VALUES ('customers', $1, 'UBAH_NOTIFIKASI_PELANGGAN', $2::jsonb, $3::jsonb, $4)`,
            [
              pelanggan.id,
              JSON.stringify({ notifikasi_wa_aktif: true }),
              JSON.stringify({ notifikasi_wa_aktif: false }),
              userId,
            ]
          );
        }

        if (pelanggan.nama !== input.nama_pelanggan) {
          if (input.konfirmasi_ubah_nama) {
            const namaLama = pelanggan.nama;
            const updCust = await c.query(
              `UPDATE customers
                  SET nama = $2
                WHERE id = $1
                RETURNING id, nama, nomor_wa, notifikasi_wa_aktif`,
              [pelanggan.id, input.nama_pelanggan]
            );
            pelanggan = updCust.rows[0];

            // Catat perubahan nama pelanggan tanpa menyertakan nomor WA di audit_logs (NFR-06).
            await c.query(
              `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
               VALUES ('customers', $1, 'UBAH_NAMA_PELANGGAN', $2::jsonb, $3::jsonb, $4)`,
              [
                pelanggan.id,
                JSON.stringify({ nama: namaLama }),
                JSON.stringify({ nama: pelanggan.nama }),
                userId,
              ]
            );
          } else {
            peringatan = {
              kode: "NAMA_PELANGGAN_BERBEDA",
              pesan: `Nomor WhatsApp sudah terdaftar atas nama "${pelanggan.nama}". Nama tersimpan tetap dipakai; konfirmasi perubahan jika ingin memperbarui nama pelanggan.`,
              nama_tersimpan: pelanggan.nama,
              nama_dikirim: input.nama_pelanggan,
            };
          }
        }
      }

      // 3. Kode tiket atomik dari ticket_counters berdasarkan TANGGAL TERBIT di Asia/Jakarta.
      const ctrRes = await c.query(
        `INSERT INTO ticket_counters (tanggal, terakhir)
         VALUES (($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date, 1)
         ON CONFLICT (tanggal)
         DO UPDATE SET terakhir = ticket_counters.terakhir + 1
         RETURNING to_char(tanggal, 'YYYYMMDD') AS tgl_teks, terakhir`,
        [sekarang]
      );
      const tglTeks: string = ctrRes.rows[0].tgl_teks;
      const urut: number = ctrRes.rows[0].terakhir;
      const kodeTiket = `${AWALAN_KODE_TIKET}-${tglTeks}-${String(urut).padStart(3, "0")}`;

      // 4. Jadwal & pembayaran awal.
      const estimasiSelesai =
        input.estimasi_selesai ??
        hitungEstimasiSelesaiDefault(
          input.tanggal_masuk,
          itemSiapSimpan.map((it) => it.estimasi_hari)
        );
      const tanggalBayar = input.status_bayar === "Lunas" ? sekarang : null;
      const metodeBayar = input.status_bayar === "Lunas" ? input.metode_bayar : null;

      // 5. Simpan orders.
      const ordRes = await c.query(
        `INSERT INTO orders (
           kode_tiket, customer_id, sumber, dibuat_oleh,
           tanggal_masuk, estimasi_selesai,
           status_pesanan, status_bayar, metode_bayar, tanggal_bayar,
           total, alasan_batal
         )
         VALUES ($1, $2, 'toko', $3, $4, $5, 'Belum dicuci', $6, $7, $8, $9, NULL)
         RETURNING
           id, kode_tiket, sumber, dibuat_oleh,
           tanggal_masuk, estimasi_selesai,
           status_pesanan, status_bayar, metode_bayar, tanggal_bayar,
           total, alasan_batal`,
        [
          kodeTiket,
          pelanggan.id,
          userId,
          input.tanggal_masuk,
          estimasiSelesai,
          input.status_bayar,
          metodeBayar,
          tanggalBayar,
          total,
        ]
      );
      const ord = ordRes.rows[0];

      // 5b. Simpan kunci idempotensi bila disediakan (beserta user_id dan request_hash)
      if (input.idempotency_key) {
        await c.query(
          `INSERT INTO ticket_idempotency (key, order_id, user_id, request_hash)
           VALUES ($1, $2, $3, $4)`,
          [input.idempotency_key, ord.id, userId, reqHash]
        );
      }

      // 6. Simpan order_items (harga_saat_transaksi disalin per baris dari katalog aktif).
      const itemsTersimpan: ItemTiket[] = [];
      for (const it of itemSiapSimpan) {
        const oiRes = await c.query(
          `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi`,
          [ord.id, it.service_id, it.deskripsi_barang, it.jumlah, it.harga_saat_transaksi]
        );
        const oi = oiRes.rows[0];
        itemsTersimpan.push({
          id: oi.id,
          service_id: oi.service_id,
          nama_layanan: it.nama_layanan,
          deskripsi_barang: oi.deskripsi_barang,
          jumlah: oi.jumlah,
          harga_saat_transaksi: oi.harga_saat_transaksi,
          subtotal: oi.jumlah * oi.harga_saat_transaksi,
        });
      }

      // 7. Catat audit_logs (ringkasan secukupnya tanpa nomor WA pelanggan — NFR-06).
      const ringkasanAudit = {
        kode_tiket: kodeTiket,
        customer_id: pelanggan.id,
        sumber: "toko",
        jumlah_item: itemsTersimpan.length,
        jumlah_pasang: jumlahPasang,
        total,
        status_pesanan: "Belum dicuci",
        status_bayar: input.status_bayar,
        metode_bayar: metodeBayar,
      };
      const audRes = await c.query(
        `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
         VALUES ('orders', $1, 'TAMBAH_TIKET', NULL, $2::jsonb, $3)
         RETURNING id, aksi, nilai_lama, nilai_baru, user_id, waktu`,
        [ord.id, JSON.stringify(ringkasanAudit), userId]
      );
      const userRes = await c.query(`SELECT nama FROM users WHERE id = $1`, [userId]);
      const namaPembuat: string | null = userRes.rows[0]?.nama ?? null;
      const aud = audRes.rows[0];

      const ringkasanLayanan = Array.from(
        new Set(itemsTersimpan.map((it) => it.nama_layanan))
      )
        .sort()
        .join(", ");

      const tiket: DetailTiket = {
        id: ord.id,
        kode_tiket: ord.kode_tiket,
        sumber: ord.sumber,
        serah_terima: null,
        dibuat_oleh: ord.dibuat_oleh,
        nama_pembuat: namaPembuat,
        tanggal_masuk: keIso(ord.tanggal_masuk)!,
        estimasi_selesai: keIso(ord.estimasi_selesai),
        status_pesanan: ord.status_pesanan,
        siap_diambil_pada: null,
        hari_belum_diambil: null,
        terlambat_ambil: false,
        status_bayar: ord.status_bayar,
        metode_bayar: ord.metode_bayar,
        tanggal_bayar: keIso(ord.tanggal_bayar),
        total: ord.total,
        alasan_batal: ord.alasan_batal,
        jumlah_item: itemsTersimpan.length,
        jumlah_pasang: jumlahPasang,
        ringkasan_layanan: ringkasanLayanan,
        nomor_terverifikasi: true,
        pelanggan,
        items: itemsTersimpan,
        riwayat_audit: [
          {
            id: aud.id,
            aksi: aud.aksi,
            nilai_lama: aud.nilai_lama,
            nilai_baru: aud.nilai_baru,
            user_id: aud.user_id,
            nama_pengguna: namaPembuat,
            waktu: keIso(aud.waktu)!,
          },
        ],
      };

      return { ok: true as const, tiket, peringatan };
    });
  } catch (err) {
    if (err instanceof GalatBisnisTiket) {
      return { ok: false, kode: err.kode, galat: err.message, field: err.field };
    }
    // Tangani race condition bila kunci idempotensi sama dikirim serentak
    if (
      input.idempotency_key &&
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      const existingKey = await getPool().query(
        `SELECT order_id, user_id, request_hash FROM ticket_idempotency WHERE key = $1`,
        [input.idempotency_key]
      );
      if ((existingKey.rowCount ?? 0) > 0) {
        const row = existingKey.rows[0];
        if (row.user_id !== userId || row.request_hash !== reqHash) {
          return {
            ok: false,
            kode: 409,
            galat: "Kunci idempotensi sudah pernah digunakan dengan data atau pengguna yang berbeda.",
            field: "idempotency_key",
          };
        }
        const orderId = row.order_id as number;
        const tiketLama = await ambilDetailTiket(orderId);
        if (tiketLama) {
          return { ok: true, tiket: tiketLama, peringatan: null, duplikat: true };
        }
      }
    }
    throw err;
  }
}

/**
 * Mengambil daftar tiket dengan filter tanggal zona Asia/Jakarta, penanda & filter tiket lama
 * belum diambil (>= MIN_HARI_BELUM_DIAMBIL hari kalender WIB di SQL), pencarian berparameter,
 * urutan "Belum bayar di atas" di level SQL sebelum LIMIT/OFFSET, dan paginasi.
 */
export async function daftarTiket(
  filter: FilterDaftarTiket,
  waktuAcuan: Date | null = null
): Promise<HasilDaftarTiket> {
  const syarat: string[] = [];
  // $1 = waktuAcuan (bila null memakai now() di PostgreSQL), $2 = MIN_HARI_BELUM_DIAMBIL
  const params: unknown[] = [waktuAcuan, MIN_HARI_BELUM_DIAMBIL];
  const ekspresiHariBelumDiambil = `((COALESCE($1::timestamptz, now()) AT TIME ZONE 'Asia/Jakarta')::date - (COALESCE(o.siap_diambil_pada, o.tanggal_masuk) AT TIME ZONE 'Asia/Jakarta')::date)`;

  if (filter.batas_mulai !== null) {
    params.push(filter.batas_mulai);
    syarat.push(`o.tanggal_masuk >= $${params.length}`);
  }
  if (filter.batas_akhir_eksklusif !== null) {
    params.push(filter.batas_akhir_eksklusif);
    syarat.push(`o.tanggal_masuk < $${params.length}`);
  }

  if (filter.belum_diambil_lama) {
    syarat.push(`(o.status_pesanan = 'Siap diambil' AND ${ekspresiHariBelumDiambil} >= $2)`);
  }

  if (filter.cari.length > 0) {
    const polaUtama = `%${escapeIlike(filter.cari)}%`;
    params.push(polaUtama);
    const idxUtama = params.length;

    // Bantu pencocokan nomor WA bila kasir mengetik format 08xx / +62 / dengan tanda hubung.
    const bersihTanda = filter.cari.replace(/[\s\-().]/g, "");
    let polaWaAlt: string | null = null;
    if (bersihTanda.startsWith("08") && /^08\d+$/.test(bersihTanda)) {
      polaWaAlt = `%${escapeIlike("628" + bersihTanda.slice(2))}%`;
    } else if (bersihTanda.startsWith("+62") && /^\+62\d+$/.test(bersihTanda)) {
      polaWaAlt = `%${escapeIlike("62" + bersihTanda.slice(3))}%`;
    } else if (/^\d{4,15}$/.test(bersihTanda) && bersihTanda !== filter.cari) {
      polaWaAlt = `%${escapeIlike(bersihTanda)}%`;
    }
    params.push(polaWaAlt);
    const idxWaAlt = params.length;

    syarat.push(
      `(o.kode_tiket ILIKE $${idxUtama} ESCAPE '\\'
        OR c.nama ILIKE $${idxUtama} ESCAPE '\\'
        OR c.nomor_wa ILIKE $${idxUtama} ESCAPE '\\'
        OR ($${idxWaAlt}::text IS NOT NULL AND c.nomor_wa ILIKE $${idxWaAlt} ESCAPE '\\'))`
    );
  }

  const whereSql = syarat.length > 0 ? `WHERE ${syarat.join(" AND ")}` : "";

  // Urutan ditentukan murni dari boolean tervalidasi (bukan string input pengguna)
  // dan dijalankan di SQL SEBELUM LIMIT/OFFSET dengan pembeda o.id DESC.
  const orderSql = filter.belum_bayar_di_atas
    ? `(o.status_bayar = 'Belum bayar') DESC, o.tanggal_masuk DESC, o.id DESC`
    : `o.tanggal_masuk DESC, o.id DESC`;

  const pool = getPool();
  // Untuk query COUNT, bila tidak ada filter belum_diambil_lama, $1 dan $2 tidak dipakai di WHERE
  // sehingga kita hanya mengikat parameter yang dirujuk atau membangun ulang syarat hitung.
  const syaratHitung: string[] = [];
  const paramsHitung: unknown[] = [];
  if (filter.batas_mulai !== null) {
    paramsHitung.push(filter.batas_mulai);
    syaratHitung.push(`o.tanggal_masuk >= $${paramsHitung.length}`);
  }
  if (filter.batas_akhir_eksklusif !== null) {
    paramsHitung.push(filter.batas_akhir_eksklusif);
    syaratHitung.push(`o.tanggal_masuk < $${paramsHitung.length}`);
  }
  if (filter.belum_diambil_lama) {
    paramsHitung.push(waktuAcuan);
    const idxW = paramsHitung.length;
    paramsHitung.push(MIN_HARI_BELUM_DIAMBIL);
    const idxM = paramsHitung.length;
    syaratHitung.push(
      `(o.status_pesanan = 'Siap diambil' AND ((COALESCE($${idxW}::timestamptz, now()) AT TIME ZONE 'Asia/Jakarta')::date - (COALESCE(o.siap_diambil_pada, o.tanggal_masuk) AT TIME ZONE 'Asia/Jakarta')::date) >= $${idxM})`
    );
  }
  if (filter.cari.length > 0) {
    const polaUtama = `%${escapeIlike(filter.cari)}%`;
    paramsHitung.push(polaUtama);
    const idxUtama = paramsHitung.length;
    const bersihTanda = filter.cari.replace(/[\s\-().]/g, "");
    let polaWaAlt: string | null = null;
    if (bersihTanda.startsWith("08") && /^08\d+$/.test(bersihTanda)) {
      polaWaAlt = `%${escapeIlike("628" + bersihTanda.slice(2))}%`;
    } else if (bersihTanda.startsWith("+62") && /^\+62\d+$/.test(bersihTanda)) {
      polaWaAlt = `%${escapeIlike("62" + bersihTanda.slice(3))}%`;
    } else if (/^\d{4,15}$/.test(bersihTanda) && bersihTanda !== filter.cari) {
      polaWaAlt = `%${escapeIlike(bersihTanda)}%`;
    }
    paramsHitung.push(polaWaAlt);
    const idxWaAlt = paramsHitung.length;
    syaratHitung.push(
      `(o.kode_tiket ILIKE $${idxUtama} ESCAPE '\\'
        OR c.nama ILIKE $${idxUtama} ESCAPE '\\'
        OR c.nomor_wa ILIKE $${idxUtama} ESCAPE '\\'
        OR ($${idxWaAlt}::text IS NOT NULL AND c.nomor_wa ILIKE $${idxWaAlt} ESCAPE '\\'))`
    );
  }
  const whereHitungSql =
    syaratHitung.length > 0 ? `WHERE ${syaratHitung.join(" AND ")}` : "";

  const hitungRes = await pool.query(
    `SELECT COUNT(*)::int AS total_data
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       ${whereHitungSql}`,
    paramsHitung
  );
  const totalData: number = hitungRes.rows[0]?.total_data ?? 0;
  const totalHalaman = Math.max(1, Math.ceil(totalData / filter.ukuran));
  const offset = (filter.halaman - 1) * filter.ukuran;

  const paramsData = [...params, filter.ukuran, offset];
  const idxLimit = params.length + 1;
  const idxOffset = params.length + 2;

  const dataRes = await pool.query(
    `SELECT
       o.id,
       o.kode_tiket,
       o.sumber,
       o.tanggal_masuk,
       o.estimasi_selesai,
       o.status_pesanan,
       o.siap_diambil_pada,
       CASE
         WHEN o.status_pesanan = 'Siap diambil' THEN
           GREATEST(0, ${ekspresiHariBelumDiambil})::int
         ELSE NULL
       END AS hari_belum_diambil,
       (
         o.status_pesanan = 'Siap diambil'
         AND ${ekspresiHariBelumDiambil} >= $2
       ) AS terlambat_ambil,
       o.status_bayar,
       o.metode_bayar,
       o.tanggal_bayar,
       o.total,
       COALESCE(o.nomor_terverifikasi, true) AS nomor_terverifikasi,
       c.id AS customer_id,
       c.nama AS customer_nama,
       c.nomor_wa AS customer_nomor_wa,
       c.notifikasi_wa_aktif AS customer_notifikasi_wa_aktif,
       wn.status AS notifikasi_status,
       COALESCE(agg.jumlah_item, 0)::int AS jumlah_item,
       COALESCE(agg.jumlah_pasang, 0)::int AS jumlah_pasang,
       COALESCE(agg.ringkasan_layanan, '') AS ringkasan_layanan
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN wa_notifikasi wn ON wn.order_id = o.id AND wn.jenis = 'siap_diambil'
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS jumlah_item,
         COALESCE(SUM(oi.jumlah), 0)::int AS jumlah_pasang,
         STRING_AGG(DISTINCT s.nama, ', ' ORDER BY s.nama) AS ringkasan_layanan
       FROM order_items oi
       JOIN services s ON s.id = oi.service_id
       WHERE oi.order_id = o.id
     ) agg ON true
     ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${idxLimit} OFFSET $${idxOffset}`,
    paramsData
  );

  const data: RingkasanTiket[] = dataRes.rows.map((b) => ({
    id: b.id,
    kode_tiket: b.kode_tiket,
    sumber: b.sumber,
    tanggal_masuk: keIso(b.tanggal_masuk)!,
    estimasi_selesai: keIso(b.estimasi_selesai),
    status_pesanan: b.status_pesanan,
    siap_diambil_pada: keIso(b.siap_diambil_pada),
    hari_belum_diambil:
      typeof b.hari_belum_diambil === "number" ? b.hari_belum_diambil : null,
    terlambat_ambil: Boolean(b.terlambat_ambil),
    status_bayar: b.status_bayar,
    metode_bayar: b.metode_bayar,
    tanggal_bayar: keIso(b.tanggal_bayar),
    total: b.total,
    jumlah_item: b.jumlah_item,
    jumlah_pasang: b.jumlah_pasang,
    ringkasan_layanan: b.ringkasan_layanan,
    nomor_terverifikasi: b.nomor_terverifikasi !== false,
    notifikasi_status: b.notifikasi_status ?? null,
    notifikasi_gagal: b.notifikasi_status === "gagal",
    pelanggan: {
      id: b.customer_id,
      nama: b.customer_nama,
      nomor_wa: b.customer_nomor_wa,
      notifikasi_wa_aktif: b.customer_notifikasi_wa_aktif !== false,
    },
  }));

  return {
    data,
    paginasi: {
      halaman: filter.halaman,
      ukuran: filter.ukuran,
      total_data: totalData,
      total_halaman: totalHalaman,
    },
  };
}

function sensorNomorWaDariNilaiAudit(
  nilai: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!nilai || typeof nilai !== "object") return null;
  const hasil: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nilai)) {
    if (k === "nomor_wa" || k === "wa" || k === "phone") continue;
    hasil[k] = v;
  }
  return hasil;
}

/**
 * Mengambil detail lengkap satu tiket beserta daftar item dan riwayat audit hanya-baca.
 * Menampilkan riwayat perubahan order dan perubahan nama pelanggan (tanpa nomor WA).
 */
export async function ambilDetailTiket(
  id: number,
  waktuAcuan: Date | null = null
): Promise<DetailTiket | null> {
  return ambilDetailTiketDenganClient(getPool(), id, waktuAcuan);
}

export async function ambilDetailTiketDenganClient(
  client: Pool | PoolClient,
  id: number,
  waktuAcuan: Date | null = null
): Promise<DetailTiket | null> {
  const ekspresiHari = `((COALESCE($2::timestamptz, now()) AT TIME ZONE 'Asia/Jakarta')::date - (COALESCE(o.siap_diambil_pada, o.tanggal_masuk) AT TIME ZONE 'Asia/Jakarta')::date)`;
  const ordRes = await client.query(
    `SELECT
       o.id,
       o.kode_tiket,
       o.sumber,
       o.serah_terima,
       o.dibuat_oleh,
       u.nama AS nama_pembuat,
       o.tanggal_masuk,
       o.estimasi_selesai,
       o.status_pesanan,
       o.siap_diambil_pada,
       CASE
         WHEN o.status_pesanan = 'Siap diambil' THEN
           GREATEST(0, ${ekspresiHari})::int
         ELSE NULL
       END AS hari_belum_diambil,
       (
         o.status_pesanan = 'Siap diambil'
         AND ${ekspresiHari} >= $3
       ) AS terlambat_ambil,
       o.status_bayar,
       o.metode_bayar,
       o.tanggal_bayar,
       o.total,
       o.alasan_batal,
       COALESCE(o.nomor_terverifikasi, true) AS nomor_terverifikasi,
       c.id AS customer_id,
       c.nama AS customer_nama,
       c.nomor_wa AS customer_nomor_wa,
       c.notifikasi_wa_aktif AS customer_notifikasi_wa_aktif
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = o.dibuat_oleh
     WHERE o.id = $1`,
    [id, waktuAcuan, MIN_HARI_BELUM_DIAMBIL]
  );

  if ((ordRes.rowCount ?? 0) === 0) return null;
  const ord = ordRes.rows[0];

  const [itemRes, auditRes, notifRes] = await Promise.all([
    client.query(
      `SELECT
         oi.id,
         oi.service_id,
         s.nama AS nama_layanan,
         oi.deskripsi_barang,
         oi.jumlah,
         oi.harga_saat_transaksi
       FROM order_items oi
       JOIN services s ON s.id = oi.service_id
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`,
      [id]
    ),
    client.query(
      `SELECT
         al.id,
         al.aksi,
         al.nilai_lama,
         al.nilai_baru,
         al.user_id,
         u.nama AS nama_pengguna,
         al.waktu
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE (al.entitas = 'orders' AND al.entitas_id = $1)
          OR (al.entitas = 'customers' AND al.entitas_id = $2 AND al.aksi IN ('UBAH_NAMA_PELANGGAN', 'UBAH_NOTIFIKASI_PELANGGAN'))
       ORDER BY al.waktu ASC, al.id ASC`,
      [id, ord.customer_id]
    ),
    client.query(
      `SELECT id, status, alasan_dilewati, kode_galat, percobaan, terkirim_pada, diperbarui_pada
       FROM wa_notifikasi
       WHERE order_id = $1 AND jenis = 'siap_diambil'`,
      [id]
    ),
  ]);

  const items: ItemTiket[] = itemRes.rows.map((it) => ({
    id: it.id,
    service_id: it.service_id,
    nama_layanan: it.nama_layanan,
    deskripsi_barang: it.deskripsi_barang,
    jumlah: it.jumlah,
    harga_saat_transaksi: it.harga_saat_transaksi,
    subtotal: it.jumlah * it.harga_saat_transaksi,
  }));

  const jumlahPasang = items.reduce((sum, it) => sum + it.jumlah, 0);
  const ringkasanLayanan = Array.from(new Set(items.map((it) => it.nama_layanan)))
    .sort()
    .join(", ");

  const riwayatAudit: RiwayatAuditTiket[] = auditRes.rows.map((al) => ({
    id: al.id,
    aksi: al.aksi,
    nilai_lama: sensorNomorWaDariNilaiAudit(al.nilai_lama),
    nilai_baru: sensorNomorWaDariNilaiAudit(al.nilai_baru),
    user_id: al.user_id,
    nama_pengguna: al.nama_pengguna,
    waktu: keIso(al.waktu)!,
  }));

  return {
    id: ord.id,
    kode_tiket: ord.kode_tiket,
    sumber: ord.sumber,
    serah_terima: ord.serah_terima ?? null,
    dibuat_oleh: ord.dibuat_oleh,
    nama_pembuat: ord.nama_pembuat,
    tanggal_masuk: keIso(ord.tanggal_masuk)!,
    estimasi_selesai: keIso(ord.estimasi_selesai),
    status_pesanan: ord.status_pesanan,
    siap_diambil_pada: keIso(ord.siap_diambil_pada),
    hari_belum_diambil:
      typeof ord.hari_belum_diambil === "number" ? ord.hari_belum_diambil : null,
    terlambat_ambil: Boolean(ord.terlambat_ambil),
    status_bayar: ord.status_bayar,
    metode_bayar: ord.metode_bayar,
    tanggal_bayar: keIso(ord.tanggal_bayar),
    total: ord.total,
    alasan_batal: ord.alasan_batal,
    jumlah_item: items.length,
    jumlah_pasang: jumlahPasang,
    ringkasan_layanan: ringkasanLayanan,
    nomor_terverifikasi: ord.nomor_terverifikasi !== false,
    notifikasi:
      (notifRes.rowCount ?? 0) > 0
        ? {
            id: notifRes.rows[0].id,
            status: notifRes.rows[0].status,
            alasan_dilewati: notifRes.rows[0].alasan_dilewati,
            kode_galat: notifRes.rows[0].kode_galat,
            percobaan: notifRes.rows[0].percobaan,
            terkirim_pada: keIso(notifRes.rows[0].terkirim_pada),
            diperbarui_pada: keIso(notifRes.rows[0].diperbarui_pada),
          }
        : null,
    pelanggan: {
      id: ord.customer_id,
      nama: ord.customer_nama,
      nomor_wa: ord.customer_nomor_wa,
      notifikasi_wa_aktif: ord.customer_notifikasi_wa_aktif !== false,
    },
    items,
    riwayat_audit: riwayatAudit,
  };
}

/**
 * Mengubah status pesanan, status pembayaran, atau membatalkan tiket dalam SATU transaksi DB (Phase 5B):
 * - Mengunci baris dengan SELECT ... FOR UPDATE (anti race condition dua kasir serentak).
 * - Idempoten: bila target sama persis dengan status di DB, tidak menjalankan UPDATE dan tidak menulis audit ganda.
 * - Memeriksa status_sebelumnya: bila sudah diubah pengguna lain, membalas 409 beserta data terbaru.
 * - siap_diambil_pada hanya diisi saat masih NULL dan tidak pernah dikosongkan / di-reset.
 * - Menulis audit_logs (tanpa nomor WA) dalam transaksi yang sama; kegagalan audit membatalkan perubahan orders.
 */
export async function ubahTiket(
  id: number,
  input: InputUbahTiket,
  userId: number
): Promise<HasilUbahTiket> {
  return dalamTransaksi(async (c) => {
    const kunciRes = await c.query(
      `SELECT
         id,
         kode_tiket,
         status_pesanan,
         siap_diambil_pada,
         status_bayar,
         metode_bayar,
         tanggal_bayar,
         alasan_batal
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if ((kunciRes.rowCount ?? 0) === 0) {
      return { ok: false, kode: 404, galat: "Tiket tidak ditemukan." };
    }

    const ord = kunciRes.rows[0] as {
      id: number;
      kode_tiket: string;
      status_pesanan: StatusPesanan;
      siap_diambil_pada: Date | null;
      status_bayar: StatusBayar;
      metode_bayar: MetodeBayar | null;
      tanggal_bayar: Date | null;
      alasan_batal: string | null;
    };

    const muatDetail = async () => (await ambilDetailTiketDenganClient(c, id))!;

    // ---------- 1. Perubahan Status Pesanan ----------
    if (input.jenis === "status_pesanan") {
      if (ord.status_pesanan === "Dibatalkan") {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "TIKET_SUDAH_DIBATALKAN",
          galat: "Tiket sudah berstatus Dibatalkan dan bersifat final (tidak dapat diubah lagi).",
          tiket: await muatDetail(),
        };
      }

      // Idempotensi: target sudah sama persis dengan status di DB
      // (baik dikirim dengan status_sebelumnya === status saat ini maupun retry dari langkah sah sebelumnya)
      if (
        ord.status_pesanan === input.status_pesanan &&
        (input.status_sebelumnya === ord.status_pesanan ||
          periksaTransisiStatusPesanan(input.status_sebelumnya, input.status_pesanan).izinkan)
      ) {
        return { ok: true, tiket: await muatDetail(), idempoten: true };
      }

      if (ord.status_pesanan !== input.status_sebelumnya) {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "STATUS_BERUBAH",
          galat: `Status pesanan telah berubah menjadi '${ord.status_pesanan}'. Data tiket telah disegarkan.`,
          tiket: await muatDetail(),
        };
      }

      const cekTransisi = periksaTransisiStatusPesanan(
        ord.status_pesanan,
        input.status_pesanan
      );
      if (!cekTransisi.izinkan) {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "TRANSISI_TIDAK_VALID",
          galat: cekTransisi.alasan,
          tiket: await muatDetail(),
        };
      }
      if (cekTransisi.jenis === "idempoten") {
        return { ok: true, tiket: await muatDetail(), idempoten: true };
      }

      const belumBayarSaatDiambil =
        input.status_pesanan === "Sudah diambil" && ord.status_bayar === "Belum bayar";

      if (belumBayarSaatDiambil && !input.konfirmasi_belum_bayar) {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "BUTUH_KONFIRMASI_BELUM_BAYAR",
          galat:
            "Tiket ini masih berstatus Belum bayar. Konfirmasi terlebih dahulu sebelum menandai pesanan Sudah diambil.",
          tiket: await muatDetail(),
        };
      }

      // siap_diambil_pada hanya diisi ketika masih NULL dan tidak pernah dikosongkan / di-reset
      let notifikasiDibuat = false;
      if (input.status_pesanan === "Siap diambil") {
        await c.query(
          `UPDATE orders
              SET status_pesanan = $1,
                  siap_diambil_pada = COALESCE(siap_diambil_pada, now())
            WHERE id = $2`,
          [input.status_pesanan, id]
        );

        // Phase 6B (FR-24): Masukkan antrean keluar notifikasi 'siap_diambil' dalam transaksi yang sama.
        // UNIQUE (order_id, jenis) dan ON CONFLICT DO NOTHING menjamin idempotensi:
        // jika nanti koreksi mundur lalu maju lagi ke 'Siap diambil', baris tidak dibuat ulang / tidak kirim ulang.
        // Koreksi mundur (cekTransisi.jenis === "koreksi") tidak membuat notifikasi.
        if (cekTransisi.jenis !== "koreksi") {
          const insNotif = await c.query(
            `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan, dibuat_pada, diperbarui_pada)
             VALUES ($1, 'siap_diambil', 'menunggu', 0, now(), now())
             ON CONFLICT (order_id, jenis) DO NOTHING
             RETURNING id`,
            [id]
          );
          notifikasiDibuat = (insNotif.rowCount ?? 0) > 0;
        }
      } else {
        await c.query(
          `UPDATE orders
              SET status_pesanan = $1
            WHERE id = $2`,
          [input.status_pesanan, id]
        );
      }

      const nilaiLama: Record<string, unknown> = {
        status_pesanan: ord.status_pesanan,
      };
      const nilaiBaru: Record<string, unknown> = {
        status_pesanan: input.status_pesanan,
        ...(cekTransisi.jenis === "koreksi" ? { koreksi_mundur: true } : {}),
        ...(belumBayarSaatDiambil ? { belum_bayar_saat_diambil: true } : {}),
      };

      await c.query(
        `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
         VALUES ('orders', $1, $2, $3::jsonb, $4::jsonb, $5)`,
        [
          id,
          cekTransisi.aksiAudit,
          JSON.stringify(nilaiLama),
          JSON.stringify(nilaiBaru),
          userId,
        ]
      );

      return { ok: true, tiket: await muatDetail(), idempoten: false, notifikasiDibuat };
    }

    // ---------- 2. Perubahan Status Pembayaran ----------
    if (input.jenis === "pembayaran") {
      if (ord.status_pesanan === "Dibatalkan") {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "TIKET_SUDAH_DIBATALKAN",
          galat: "Tiket sudah berstatus Dibatalkan dan bersifat final (pembayaran tidak dapat diubah).",
          tiket: await muatDetail(),
        };
      }

      // Lunas -> Lunas
      if (ord.status_bayar === "Lunas" && input.status_bayar === "Lunas") {
        if (ord.metode_bayar === input.metode_bayar) {
          return { ok: true, tiket: await muatDetail(), idempoten: true };
        }
        return {
          ok: false,
          kode: 409,
          kode_konflik: "UBAH_METODE_HARUS_BALIK_BELUM_BAYAR",
          galat: `Tiket sudah berstatus Lunas (${ord.metode_bayar}). Untuk mengganti metode pembayaran, balik dulu ke Belum bayar dengan alasan, lalu Lunas lagi.`,
          tiket: await muatDetail(),
        };
      }

      // Belum bayar -> Belum bayar (idempoten)
      if (ord.status_bayar === "Belum bayar" && input.status_bayar === "Belum bayar") {
        return { ok: true, tiket: await muatDetail(), idempoten: true };
      }

      // Cek konkurensi status_sebelumnya
      if (ord.status_bayar !== input.status_sebelumnya) {
        return {
          ok: false,
          kode: 409,
          kode_konflik: "STATUS_BERUBAH",
          galat: `Status pembayaran telah berubah menjadi '${ord.status_bayar}'. Data tiket telah disegarkan.`,
          tiket: await muatDetail(),
        };
      }

      if (input.status_bayar === "Lunas") {
        const upd = await c.query(
          `UPDATE orders
              SET status_bayar = 'Lunas',
                  metode_bayar = $1,
                  tanggal_bayar = now()
            WHERE id = $2
            RETURNING tanggal_bayar`,
          [input.metode_bayar, id]
        );
        const tglBayarBaru = keIso(upd.rows[0].tanggal_bayar);

        await c.query(
          `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
           VALUES ('orders', $1, 'UBAH_PEMBAYARAN', $2::jsonb, $3::jsonb, $4)`,
          [
            id,
            JSON.stringify({
              status_bayar: ord.status_bayar,
              metode_bayar: ord.metode_bayar,
              tanggal_bayar: keIso(ord.tanggal_bayar),
            }),
            JSON.stringify({
              status_bayar: "Lunas",
              metode_bayar: input.metode_bayar,
              tanggal_bayar: tglBayarBaru,
            }),
            userId,
          ]
        );

        return { ok: true, tiket: await muatDetail(), idempoten: false };
      }

      // Lunas -> Belum bayar (wajib alasan)
      if (!input.alasan || input.alasan.trim().length === 0) {
        return {
          ok: false,
          kode: 400,
          galat: "Alasan pembalikan pembayaran wajib diisi saat mengubah status Lunas ke Belum bayar.",
          field: "alasan",
        };
      }

      await c.query(
        `UPDATE orders
            SET status_bayar = 'Belum bayar',
                metode_bayar = NULL,
                tanggal_bayar = NULL
          WHERE id = $1`,
        [id]
      );

      await c.query(
        `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
         VALUES ('orders', $1, 'UBAH_PEMBAYARAN', $2::jsonb, $3::jsonb, $4)`,
        [
          id,
          JSON.stringify({
            status_bayar: ord.status_bayar,
            metode_bayar: ord.metode_bayar,
            tanggal_bayar: keIso(ord.tanggal_bayar),
          }),
          JSON.stringify({
            status_bayar: "Belum bayar",
            metode_bayar: null,
            tanggal_bayar: null,
            alasan: input.alasan,
          }),
          userId,
        ]
      );

      return { ok: true, tiket: await muatDetail(), idempoten: false };
    }

    // ---------- 3. Pembatalan Tiket ----------
    if (ord.status_pesanan === "Dibatalkan") {
      // Idempoten hanya bila mengirim ulang pembatalan yang persis sama dari status pra-batal yang sah;
      // jika status_sebelumnya dikirim "Dibatalkan" atau alasan berbeda, tolak 409 karena Dibatalkan bersifat final.
      if (
        ord.alasan_batal === input.alasan_batal &&
        input.status_sebelumnya !== "Dibatalkan" &&
        bolehBatalkanTiket(input.status_sebelumnya).boleh
      ) {
        return { ok: true, tiket: await muatDetail(), idempoten: true };
      }
      return {
        ok: false,
        kode: 409,
        kode_konflik: "TIKET_SUDAH_DIBATALKAN",
        galat: "Tiket sudah berstatus Dibatalkan dan bersifat final (tidak dapat diubah lagi).",
        tiket: await muatDetail(),
      };
    }

    const izinBatal = bolehBatalkanTiket(ord.status_pesanan);
    if (!izinBatal.boleh) {
      return {
        ok: false,
        kode: 409,
        kode_konflik: "TIDAK_DAPAT_DIBATALKAN",
        galat: izinBatal.alasan,
        tiket: await muatDetail(),
      };
    }

    if (ord.status_pesanan !== input.status_sebelumnya) {
      return {
        ok: false,
        kode: 409,
        kode_konflik: "STATUS_BERUBAH",
        galat: `Status pesanan telah berubah menjadi '${ord.status_pesanan}'. Data tiket telah disegarkan.`,
        tiket: await muatDetail(),
      };
    }

    const sudahLunas = ord.status_bayar === "Lunas";
    if (sudahLunas && !input.konfirmasi_sudah_lunas) {
      return {
        ok: false,
        kode: 409,
        kode_konflik: "BUTUH_KONFIRMASI_LUNAS",
        galat:
          "Tiket ini sudah berstatus Lunas. Konfirmasi secara eksplisit bahwa pengembalian dana ditangani di luar sistem sebelum membatalkan tiket.",
        tiket: await muatDetail(),
      };
    }

    await c.query(
      `UPDATE orders
          SET status_pesanan = 'Dibatalkan',
              alasan_batal = $1
        WHERE id = $2`,
      [input.alasan_batal, id]
    );

    const nilaiBaruBatal: Record<string, unknown> = {
      status_pesanan: "Dibatalkan",
      alasan_batal: input.alasan_batal,
      ...(sudahLunas
        ? {
            uang_dikembalikan_di_luar_sistem: true,
            catatan_pembayaran:
              "Tiket sudah Lunas saat dibatalkan; pengembalian dana dilakukan di luar sistem.",
          }
        : {}),
    };

    await c.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
       VALUES ('orders', $1, 'BATALKAN_TIKET', $2::jsonb, $3::jsonb, $4)`,
      [
        id,
        JSON.stringify({
          status_pesanan: ord.status_pesanan,
          status_bayar: ord.status_bayar,
        }),
        JSON.stringify(nilaiBaruBatal),
        userId,
      ]
    );

    return { ok: true, tiket: await muatDetail(), idempoten: false };
  });
}

/**
 * Membersihkan baris kunci idempotensi yang telah kedaluwarsa.
 */
export async function bersihkanKunciIdempotensiKedaluwarsa(
  jamKedaluwarsa: number = MASA_SIMPAN_IDEMPOTENSI_JAM
): Promise<number> {
  const res = await getPool().query(
    `DELETE FROM ticket_idempotency WHERE created_at < now() - ($1 || ' hours')::interval`,
    [String(jamKedaluwarsa)]
  );
  return res.rowCount ?? 0;
}

/**
 * Mengubah preferensi notifikasi WhatsApp pelanggan toko (Phase 6B, FR-24 / FR-25).
 * Kasir saja; mencatat audit_logs tanpa menyertakan nomor telepon pelanggan.
 */
export async function ubahNotifikasiPelanggan(
  customerId: number,
  aktif: boolean,
  userId: number
): Promise<{ ok: boolean; customerId: number; aktif: boolean; pesan?: string }> {
  const pool = getPool();
  const cek = await pool.query(
    `SELECT id, notifikasi_wa_aktif FROM customers WHERE id = $1`,
    [customerId]
  );
  if ((cek.rowCount ?? 0) === 0) {
    return { ok: false, customerId, aktif, pesan: "Pelanggan tidak ditemukan." };
  }
  const nilaiLama = cek.rows[0].notifikasi_wa_aktif;
  await pool.query(
    `UPDATE customers SET notifikasi_wa_aktif = $1 WHERE id = $2`,
    [aktif, customerId]
  );

  // Catat riwayat audit tanpa nomor WhatsApp
  await pool.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
     VALUES ('customers', $1, 'UBAH_NOTIFIKASI_PELANGGAN', $2::jsonb, $3::jsonb, $4)`,
    [
      customerId,
      JSON.stringify({ notifikasi_wa_aktif: nilaiLama }),
      JSON.stringify({ notifikasi_wa_aktif: aktif }),
      userId,
    ]
  );
  return { ok: true, customerId, aktif };
}
