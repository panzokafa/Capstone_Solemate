// Konfigurasi keamanan terpusat (Phase 9B): batas laju API, panjang kunci, dan retensi.

export type JenisBatasLajuApi = "pelanggan_cek" | "ekspor_rekap" | "ubah_data";

export type AturanBatasLajuApi = {
  readonly kategori: string;
  readonly maks: number;
  readonly jendelaDetik: number;
};

/**
 * Seluruh angka batas laju API berbasis PostgreSQL (`wa_rate_limit`).
 * Tidak ada parameter pelonggaran untuk lingkungan tes di kode produksi.
 */
export const API_RATE_LIMIT: Record<JenisBatasLajuApi, AturanBatasLajuApi> = {
  pelanggan_cek: {
    kategori: "api_pelanggan_cek",
    maks: 30,
    jendelaDetik: 60,
  },
  ekspor_rekap: {
    kategori: "api_ekspor_rekap",
    maks: 15,
    jendelaDetik: 60,
  },
  ubah_data: {
    kategori: "api_ubah_data",
    maks: 120,
    jendelaDetik: 60,
  },
} as const;

// Baris rate-limit API yang jendelanya sudah lewat > 5 menit aman dibersihkan secara berkala.
export const RETENSI_BARIS_RATE_LIMIT_API_DETIK = 300;

// Sesuai batas varchar(100) pada tabel users.nama dan login_rate_limit.kunci.
export const MAKS_PANJANG_USERNAME = 100;

// Sesuai batas alamat IPv6 maksimal (45 karakter, kolom sessions.ip varchar(45)).
export const MAKS_PANJANG_IP = 45;

export const SESSION_COOKIE_NAME_DEV = "solemate_session";
export const SESSION_COOKIE_NAME_PROD = "__Host-solemate_session";

const UUID_SESI_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mengembalikan nama cookie sesi aktif.
 * Menggunakan prefiks `__Host-` khusus di produksi HTTPS untuk mencegah cookie tossing subdomain.
 */
export function namaCookieSesi(
  env: Record<string, string | undefined> = process.env
): string {
  return env.NODE_ENV === "production"
    ? SESSION_COOKIE_NAME_PROD
    : SESSION_COOKIE_NAME_DEV;
}

export function adalahUuidSesiValid(id: string | undefined | null): id is string {
  return typeof id === "string" && UUID_SESI_RE.test(id);
}
