// Pembatasan laju permintaan API terautentikasi berbasis PostgreSQL (`wa_rate_limit`).
// Menggunakan derivasi kunci HMAC-SHA256 berlabel dari `SESSION_SECRET` sehingga ID pengguna
// atau pengenal sensitif tidak pernah disimpan dalam bentuk mentah.

import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import { adalahNilaiPlaceholder, ekstrakKodeGalatAman } from "./env-produksi.ts";
import {
  API_RATE_LIMIT,
  RETENSI_BARIS_RATE_LIMIT_API_DETIK,
  type JenisBatasLajuApi,
} from "../config/keamanan.ts";

export type HasilBatasLajuApi = {
  dibolehkan: boolean;
  hitungan: number;
  maks: number;
  retryAfterDetik: number;
};

function ambilSecretRateLimit(
  env: Record<string, string | undefined> = process.env
): string {
  const secret = env.SESSION_SECRET?.trim() ?? "";
  if (secret.length < 32 || adalahNilaiPlaceholder(secret)) {
    throw new Error(
      "[RATE_LIMIT_API] SESSION_SECRET belum dikonfigurasi dengan rahasia valid minimal 32 karakter."
    );
  }
  return secret;
}

/**
 * Menghasilkan kunci HMAC-SHA256 berlabel (64 karakter hex) untuk baris `wa_rate_limit`.
 * Label menyertakan kategori agar kunci terisolasi antar-fungsi.
 */
export function buatKunciBatasLajuApi(
  userId: number,
  kategori: string,
  env: Record<string, string | undefined> = process.env
): string {
  const secret = ambilSecretRateLimit(env);
  const derivedKey = crypto
    .createHmac("sha256", secret)
    .update(`api-rate-limit:${kategori}`)
    .digest();
  return crypto
    .createHmac("sha256", derivedKey)
    .update(`user:${userId}`)
    .digest("hex");
}

/**
 * Membersihkan baris `wa_rate_limit` kategori `api_*` yang jendelanya sudah kedaluwarsa.
 * Hanya menyentuh kategori berprefiks `api_`, tidak pernah menghapus batas laju WA bot.
 */
export async function bersihkanBatasLajuApiKedaluwarsa(
  poolOrClient: Pool | PoolClient = getPool(),
  retensiDetik: number = RETENSI_BARIS_RATE_LIMIT_API_DETIK
): Promise<number> {
  try {
    const res = await poolOrClient.query(
      `DELETE FROM wa_rate_limit
        WHERE kategori LIKE 'api\\_%' ESCAPE '\\'
          AND window_mulai <= now() - make_interval(secs => $1)`,
      [retensiDetik]
    );
    return res.rowCount ?? 0;
  } catch (err) {
    console.warn(
      "[RATE_LIMIT_API] Gagal membersihkan baris kedaluwarsa:",
      ekstrakKodeGalatAman(err, "DB_ERROR")
    );
    return 0;
  }
}

/**
 * Pengecekan & kenaikan counter batas laju API secara atomik (1 kueri SQL).
 * - Permintaan yang ditolak (> maks) tetap melalui pencatatan tetapi nilai `hitungan`
 *   dibatasi maksimal `maks + 1` tanpa memperpanjang `window_mulai`.
 * - Ketika jendela baru dimulai (`hitungan === 1`), menjadwalkan pembersihan baris `api_*`
 *   kedaluwarsa lewat `jadwalkanAfter` (atau inline jika dipanggil tanpa request scope).
 */
export async function periksaBatasLajuApi(opsi: {
  jenis: JenisBatasLajuApi;
  userId: number;
  pool?: Pool | PoolClient;
  env?: Record<string, string | undefined>;
  jadwalkanAfter?: (fn: () => Promise<void> | void) => void;
}): Promise<HasilBatasLajuApi> {
  const aturan = API_RATE_LIMIT[opsi.jenis];
  const pool = opsi.pool ?? getPool();
  const kunci = buatKunciBatasLajuApi(opsi.userId, aturan.kategori, opsi.env);

  const res = await pool.query(
    `INSERT INTO wa_rate_limit (kunci, kategori, hitungan, window_mulai)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (kunci, kategori) DO UPDATE SET
       hitungan = CASE
         WHEN wa_rate_limit.window_mulai <= now() - make_interval(secs => $3)
         THEN 1
         ELSE LEAST(wa_rate_limit.hitungan + 1, $4::integer + 1)
       END,
       window_mulai = CASE
         WHEN wa_rate_limit.window_mulai <= now() - make_interval(secs => $3)
         THEN now()
         ELSE wa_rate_limit.window_mulai
       END
     RETURNING
       hitungan,
       GREATEST(
         1,
         CEIL(EXTRACT(EPOCH FROM ((window_mulai + make_interval(secs => $3)) - now())))
       )::int AS retry_after_detik`,
    [kunci, aturan.kategori, aturan.jendelaDetik, aturan.maks]
  );

  const row = res.rows[0] as { hitungan: number; retry_after_detik: number } | undefined;
  const hitungan = Number(row?.hitungan ?? 1);
  const retryAfterDetik = Math.max(
    1,
    Number(row?.retry_after_detik ?? aturan.jendelaDetik)
  );

  if (hitungan === 1) {
    if (opsi.jadwalkanAfter) {
      opsi.jadwalkanAfter(async () => {
        await bersihkanBatasLajuApiKedaluwarsa(pool);
      });
    } else {
      await bersihkanBatasLajuApiKedaluwarsa(pool);
    }
  }

  return {
    dibolehkan: hitungan <= aturan.maks,
    hitungan,
    maks: aturan.maks,
    retryAfterDetik,
  };
}
