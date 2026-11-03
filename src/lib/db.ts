// Koneksi database aplikasi (pakai user terbatas solemate_app).
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL_APP;
    if (!url) throw new Error("DATABASE_URL_APP belum diisi di .env");
    pool = new Pool({ connectionString: url, max: 10 });
  }
  return pool;
}
