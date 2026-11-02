// Seed data contoh. Semua data palsu.
// Aturan: TIDAK membuat users dan TIDAK memuat hash PIN apa pun.
// Akun owner pertama dibuat lewat skrip terpisah di Phase 3.
// Hanya berjalan saat NODE_ENV=development.

import pg from "pg";

const { Pool } = pg;

if (process.env.NODE_ENV !== "development") {
  console.log("Seed dilewati: NODE_ENV bukan 'development'.");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LAYANAN_CONTOH = [
  { nama: "Contoh Layanan A", harga: 25000, estimasi_hari: 2 },
  { nama: "Contoh Layanan B", harga: 50000, estimasi_hari: 3 },
];

const PELANGGAN_CONTOH = [
  { nama: "Contoh Pelanggan Satu", nomor_wa: "6280000000001" },
  { nama: "Contoh Pelanggan Dua", nomor_wa: "6280000000002" },
];

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const s of LAYANAN_CONTOH) {
      await client.query(
        `INSERT INTO services (nama, harga, estimasi_hari)
         VALUES ($1,$2,$3)
         ON CONFLICT (nama) DO NOTHING`,
        [s.nama, s.harga, s.estimasi_hari]
      );
    }
    for (const p of PELANGGAN_CONTOH) {
      await client.query(
        `INSERT INTO customers (nama, nomor_wa) VALUES ($1,$2)
         ON CONFLICT (nomor_wa) DO NOTHING`,
        [p.nama, p.nomor_wa]
      );
    }

    await client.query("COMMIT");
    console.log(
      `Seed selesai: ${LAYANAN_CONTOH.length} layanan, ${PELANGGAN_CONTOH.length} pelanggan (contoh).`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
