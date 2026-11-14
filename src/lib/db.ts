// Koneksi database aplikasi (hanya memakai user terbatas DATABASE_URL_APP;
// TIDAK pernah jatuh kembali ke DATABASE_URL admin).
import { Pool, type PoolConfig } from "pg";
import {
  apakahFaseBuildNext,
  ekstrakKodeGalatAman,
  tegakkanEnvProduksi,
} from "./env-produksi.ts";

declare global {
  var __solemateDbPool: Pool | undefined;
}

function bacaAngkaPositif(
  mentah: string | undefined,
  cadangan: number,
  maks: number
): number {
  if (!mentah || mentah.trim().length === 0) return cadangan;
  const n = Number(mentah.trim());
  if (!Number.isInteger(n) || n < 1) return cadangan;
  return Math.min(n, maks);
}

/**
 * Membangun konfigurasi `pg.Pool` untuk runtime aplikasi.
 * - Hanya membaca `DATABASE_URL_APP` (tanpa fallback ke `DATABASE_URL` admin).
 * - Di produksi, memvalidasi env produksi dan mewajibkan SSL (`rejectUnauthorized: true`).
 * - Di lokal (`127.0.0.1` / `localhost` / `::1`), perilaku tanpa SSL tidak berubah.
 */
export function bangunKonfigurasiPoolDb(
  env: Record<string, string | undefined> = process.env
): PoolConfig {
  const adalahProduksi = env.NODE_ENV === "production";
  if (adalahProduksi && !apakahFaseBuildNext(env)) {
    tegakkanEnvProduksi(env);
  }

  const rejectUnauth = env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (adalahProduksi && (rejectUnauth === "false" || rejectUnauth === "0")) {
    throw new Error(
      "DB_SSL_REJECT_UNAUTHORIZED=false ditolak di produksi (verifikasi sertifikat SSL wajib aktif)."
    );
  }

  const dbSsl = env.DB_SSL?.trim().toLowerCase();
  if (adalahProduksi && (dbSsl === "false" || dbSsl === "0")) {
    throw new Error("DB_SSL=false ditolak di produksi (koneksi database wajib SSL).");
  }

  const url = env.DATABASE_URL_APP?.trim() ?? "";
  if (!url) {
    throw new Error(
      "DATABASE_URL_APP belum diisi (runtime aplikasi wajib memakai DATABASE_URL_APP, bukan DATABASE_URL admin)."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL_APP bukan URL koneksi PostgreSQL yang valid.");
  }

  const hostLower = parsed.hostname.toLowerCase();
  const adalahHostLokal =
    hostLower === "127.0.0.1" ||
    hostLower === "localhost" ||
    hostLower === "::1" ||
    hostLower === "[::1]";

  const maxDefault = adalahProduksi ? 5 : 10;
  const idleDefault = adalahProduksi ? 5000 : 10000;

  const max = bacaAngkaPositif(env.DB_POOL_MAX, maxDefault, 50);
  const idleTimeoutMillis = bacaAngkaPositif(
    env.DB_POOL_IDLE_TIMEOUT_MS,
    idleDefault,
    300000
  );
  const connectionTimeoutMillis = bacaAngkaPositif(
    env.DB_POOL_CONNECTION_TIMEOUT_MS,
    10000,
    60000
  );

  // Perilaku lokal (`127.0.0.1` / `localhost`) tetap tanpa SSL kecuali `DB_SSL=true`.
  // Di produksi (atau jika `DB_SSL=true` / host non-lokal dengan SSL), aktifkan SSL terverifikasi.
  let ssl: PoolConfig["ssl"] = undefined;
  if (adalahProduksi) {
    ssl = { rejectUnauthorized: true };
  } else if (dbSsl === "true" || dbSsl === "1") {
    ssl = {
      rejectUnauthorized: rejectUnauth !== "false" && rejectUnauth !== "0",
    };
  } else if (!adalahHostLokal && dbSsl !== "false" && dbSsl !== "0") {
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (sslmode !== "disable") {
      ssl = {
        rejectUnauthorized: rejectUnauth !== "false" && rejectUnauth !== "0",
      };
    }
  }

  return {
    connectionString: url,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: true,
    ...(ssl !== undefined ? { ssl } : {}),
  };
}

export function catatGalatPoolAman(
  err: unknown,
  pencatat: (pesan: string, kode: string) => void = console.error
): string {
  const kode = ekstrakKodeGalatAman(err, "DB_POOL_ERROR");
  pencatat("[DB_POOL] Galat klien idle:", kode);
  return kode;
}

export function getPool(): Pool {
  if (!globalThis.__solemateDbPool) {
    const p = new Pool(bangunKonfigurasiPoolDb(process.env));
    p.on("error", (err) => {
      catatGalatPoolAman(err);
    });
    globalThis.__solemateDbPool = p;
  }
  return globalThis.__solemateDbPool;
}
