// Penjaga endpoint API:
//  1. Penjaga mutasi CSRF/Origin (`periksaPermintaanUbah`): wajib Content-Type application/json dan Origin sah.
//  2. Penjaga batas laju (`tegakkanBatasLajuApi`): batas laju atomik berbasis PostgreSQL (HTTP 429 + Retry-After).
//  3. Penjaga error & sanitasi respons 500 (`apakahErrorNavigasiNext`, `tanganiGalatRoute`):
//     meneruskan redirect()/notFound() Next.js serta mencegah kebocoran stack/tabel/constraint.
import { after, NextRequest, NextResponse } from "next/server";
import { AksesDitolakError } from "./auth.ts";
import { periksaBatasLajuApi } from "./api-rate-limit.ts";
import {
  apakahOriginDiizinkan,
  ekstrakKodeGalatAman,
  evaluasiPermintaanUbah,
} from "./env-produksi.ts";
import type { JenisBatasLajuApi } from "../config/keamanan.ts";

export { apakahOriginDiizinkan, evaluasiPermintaanUbah };

// Mengembalikan response galat, atau null kalau permintaan lolos.
export function periksaPermintaanUbah(
  req: NextRequest,
  env: Record<string, string | undefined> = process.env
): NextResponse | null {
  const hasil = evaluasiPermintaanUbah(req, env);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return null;
}

/**
 * Menegakkan batas laju per pengguna untuk endpoint API.
 * Mengembalikan respons 429 dengan header `Retry-After` jika melebihi batas, atau `null` jika lolos.
 */
export async function tegakkanBatasLajuApi(
  jenis: JenisBatasLajuApi,
  userId: number,
  headersTambahan?: Record<string, string>
): Promise<NextResponse | null> {
  const hasil = await periksaBatasLajuApi({
    jenis,
    userId,
    jadwalkanAfter: after,
  });
  if (!hasil.dibolehkan) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
      {
        status: 429,
        headers: {
          ...(headersTambahan ?? {}),
          "Retry-After": String(hasil.retryAfterDetik),
        },
      }
    );
  }
  return null;
}

/**
 * Mengenali sinyal navigasi internal Next.js (`redirect()` dan `notFound()`)
 * agar tetap diteruskan dan tidak tertelan menjadi 500 JSON.
 */
export function apakahErrorNavigasiNext(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("digest" in e)) return false;
  const d = (e as { digest?: unknown }).digest;
  return (
    typeof d === "string" &&
    (d.startsWith("NEXT_REDIRECT;") ||
      d.startsWith("NEXT_HTTP_ERROR_FALLBACK;") ||
      d === "NEXT_NOT_FOUND")
  );
}

/**
 * Menangani galat tak terduga di route handler:
 * - AksesDitolakError -> 403 JSON
 * - Redirect / NotFound Next.js -> diteruskan (`throw e`)
 * - Lainnya -> mencatat kode aman dan membalas 500 generik tanpa stack trace / nama tabel / constraint.
 */
export function tanganiGalatRoute(
  label: string,
  e: unknown,
  headersTambahan?: Record<string, string>
): NextResponse {
  if (e instanceof AksesDitolakError) {
    return NextResponse.json(
      { error: "Akses ditolak" },
      { status: 403, ...(headersTambahan ? { headers: headersTambahan } : {}) }
    );
  }
  if (apakahErrorNavigasiNext(e)) {
    throw e;
  }
  console.error(`${label}:`, ekstrakKodeGalatAman(e));
  return NextResponse.json(
    { error: "Terjadi kesalahan pada server." },
    { status: 500, ...(headersTambahan ? { headers: headersTambahan } : {}) }
  );
}
