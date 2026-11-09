// Akses data katalog layanan. Setiap perubahan (tambah, ubah, aktif/nonaktif) dan baris audit_logs
// dijalankan dalam SATU transaksi: kalau penulisan audit gagal, perubahan layanan ikut dibatalkan.
// Layanan tidak pernah dihapus (solemate_app memang tidak punya hak DELETE pada services).
import type { PoolClient } from "pg";
import { getPool } from "./db.ts";
import type { InputLayanan, InputTambah } from "./katalog-validasi.ts";

export type Layanan = {
  id: number;
  nama: string;
  harga: number;
  estimasi_hari: number;
  aktif: boolean;
};

export type LayananPublik = Omit<Layanan, "aktif">;

// nama_kembar   = nama sudah dipakai layanan AKTIF.
// nama_nonaktif = nama sudah ada pada layanan NONAKTIF (constraint lama services_uniq_nama).
export type HasilUbah =
  | { ok: true; layanan: Layanan; berubah: boolean }
  | { ok: false; alasan: "tidak_ada" | "nama_kembar" | "nama_nonaktif" };

const KOLOM = "id, nama, harga, estimasi_hari, aktif";
const UNIQUE_VIOLATION = "23505";

function adalahNamaKembar(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

// Setelah transaksi dibatalkan karena nama kembar: bedakan apakah bentrok dengan layanan aktif
// atau hanya dengan layanan nonaktif (supaya pesan ke owner tepat).
async function klasifikasiNamaKembar(
  nama: string,
  kecualiId: number | null
): Promise<"nama_kembar" | "nama_nonaktif"> {
  const r = await getPool().query(
    `SELECT 1 FROM services
      WHERE aktif AND LOWER(TRIM(nama)) = LOWER(TRIM($1))
        AND ($2::int IS NULL OR id <> $2)
      LIMIT 1`,
    [nama, kecualiId]
  );
  return (r.rowCount ?? 0) > 0 ? "nama_kembar" : "nama_nonaktif";
}

async function dalamTransaksi<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const hasil = await fn(client);
    await client.query("COMMIT");
    return hasil;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function catatAudit(
  c: PoolClient,
  aksi: string,
  layananId: number,
  nilaiLama: Layanan | null,
  nilaiBaru: Layanan | null,
  userId: number
): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
     VALUES ('services', $1, $2, $3::jsonb, $4::jsonb, $5)`,
    [
      layananId,
      aksi,
      nilaiLama ? JSON.stringify(nilaiLama) : null,
      nilaiBaru ? JSON.stringify(nilaiBaru) : null,
      userId,
    ]
  );
}

// Semua layanan (aktif dan nonaktif) untuk owner.
export async function daftarSemuaLayanan(): Promise<Layanan[]> {
  const r = await getPool().query(
    `SELECT ${KOLOM} FROM services ORDER BY aktif DESC, LOWER(nama), id`
  );
  return r.rows;
}

// Hanya layanan aktif, hanya kolom yang perlu dipakai kasir dan bot.
export async function daftarLayananAktif(): Promise<LayananPublik[]> {
  const r = await getPool().query(
    `SELECT id, nama, harga, estimasi_hari FROM services WHERE aktif ORDER BY LOWER(nama), id`
  );
  return r.rows;
}

export async function tambahLayanan(
  input: InputTambah,
  userId: number
): Promise<HasilUbah> {
  try {
    return await dalamTransaksi(async (c) => {
      const r = await c.query(
        `INSERT INTO services (nama, harga, estimasi_hari, aktif)
         VALUES ($1, $2, $3, $4) RETURNING ${KOLOM}`,
        [input.nama, input.harga, input.estimasi_hari, input.aktif]
      );
      const baru: Layanan = r.rows[0];
      await catatAudit(c, "TAMBAH_LAYANAN", baru.id, null, baru, userId);
      return { ok: true as const, layanan: baru, berubah: true };
    });
  } catch (err) {
    if (adalahNamaKembar(err)) {
      return { ok: false, alasan: await klasifikasiNamaKembar(input.nama, null) };
    }
    throw err;
  }
}

export async function ubahLayanan(
  id: number,
  input: InputLayanan,
  userId: number
): Promise<HasilUbah> {
  try {
    return await dalamTransaksi(async (c) => {
      const lama = await c.query(`SELECT ${KOLOM} FROM services WHERE id = $1 FOR UPDATE`, [id]);
      if (lama.rowCount === 0) return { ok: false as const, alasan: "tidak_ada" as const };
      const sebelum: Layanan = lama.rows[0];

      // Tidak ada yang berubah: tidak menulis apa pun (idempoten, tanpa audit ganda).
      if (
        sebelum.nama === input.nama &&
        sebelum.harga === input.harga &&
        sebelum.estimasi_hari === input.estimasi_hari
      ) {
        return { ok: true as const, layanan: sebelum, berubah: false };
      }

      const r = await c.query(
        `UPDATE services SET nama = $2, harga = $3, estimasi_hari = $4
          WHERE id = $1 RETURNING ${KOLOM}`,
        [id, input.nama, input.harga, input.estimasi_hari]
      );
      const sesudah: Layanan = r.rows[0];
      await catatAudit(c, "UBAH_LAYANAN", id, sebelum, sesudah, userId);
      return { ok: true as const, layanan: sesudah, berubah: true };
    });
  } catch (err) {
    if (adalahNamaKembar(err)) {
      return { ok: false, alasan: await klasifikasiNamaKembar(input.nama, id) };
    }
    throw err;
  }
}

// Target eksplisit. Kalau status sudah sama: tidak ada perubahan dan tidak ada audit baru.
export async function aturStatusLayanan(
  id: number,
  aktif: boolean,
  userId: number
): Promise<HasilUbah> {
  try {
    return await dalamTransaksi(async (c) => {
      const lama = await c.query(`SELECT ${KOLOM} FROM services WHERE id = $1 FOR UPDATE`, [id]);
      if (lama.rowCount === 0) return { ok: false as const, alasan: "tidak_ada" as const };
      const sebelum: Layanan = lama.rows[0];
      if (sebelum.aktif === aktif) {
        return { ok: true as const, layanan: sebelum, berubah: false };
      }

      const r = await c.query(
        `UPDATE services SET aktif = $2 WHERE id = $1 RETURNING ${KOLOM}`,
        [id, aktif]
      );
      const sesudah: Layanan = r.rows[0];
      await catatAudit(
        c,
        aktif ? "AKTIFKAN_LAYANAN" : "NONAKTIFKAN_LAYANAN",
        id,
        sebelum,
        sesudah,
        userId
      );
      return { ok: true as const, layanan: sesudah, berubah: true };
    });
  } catch (err) {
    // Mengaktifkan kembali bisa menabrak indeks unik nama aktif.
    if (adalahNamaKembar(err)) return { ok: false, alasan: "nama_kembar" };
    throw err;
  }
}
