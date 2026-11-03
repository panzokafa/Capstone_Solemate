// Helper tes: buat akun dengan PIN tertentu (hash argon2id langsung ke DB).
// Database tes dibuat ulang tiap run, jadi tidak perlu fungsi hapus.
import pg from "pg";
import argon2 from "argon2";

const { Pool } = pg;

export async function buatAkunUji(nama, peran, pin) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MiB
    timeCost: 2,
    parallelism: 1,
  });
  const r = await pool.query(
    `INSERT INTO users (nama, peran, pin_hash, aktif) VALUES ($1,$2,$3,true) RETURNING id`,
    [nama, peran, hash]
  );
  await pool.end();
  return r.rows[0].id;
}