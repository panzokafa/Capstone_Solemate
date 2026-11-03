// Tampilkan daftar migrasi: sudah dijalankan (ada di pgmigrations) atau belum.
// Membaca tabel pgmigrations, tidak menjalankan migrasi apa pun.
import { readdirSync } from "node:fs";
import pg from "pg";

const dir = "migrations";
const files = readdirSync(dir)
  .filter((f) => /^\d+.*\.(js|ts|mjs)$/.test(f))
  .sort();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(
    "SELECT name FROM pgmigrations ORDER BY id"
  ).catch(() => ({ rows: [] }));
  const sudah = new Set(r.rows.map((x) => x.name));
  console.log("Migrasi di folder migrations:");
  for (const f of files) {
    const nama = f.replace(/\.(js|ts|mjs)$/, "");
    console.log(`  ${sudah.has(nama) ? "[X] sudah dijalankan" : "[ ] BELUM"}  ${nama}`);
  }
  const belum = files
    .map((f) => f.replace(/\.(js|ts|mjs)$/, ""))
    .filter((n) => !sudah.has(n));
  console.log(
    belum.length === 0
      ? "\nSemua migrasi sudah dijalankan."
      : `\n${belum.length} migrasi belum dijalankan: ${belum.join(", ")}`
  );
} finally {
  await pool.end();
}