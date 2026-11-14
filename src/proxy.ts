// Proxy:
// 1. Rute pengembangan (/dev/*) dan stub (/detail-tiket) di produksi membalas 404
//    untuk SEMUA pengunjung termasuk anonim (Phase 9A).
// 2. Halaman Karyawan & Rekap Absensi saat fitur ditunda (Phase 8A):
//    mencegah (app)/layout.tsx merender Sidebar khusus peran ke payload RSC 404
//    agar respons 404 owner dan kasir benar-benar identik, sambil tetap mengarahkan
//    pengunjung anonim ke /login.
import { NextResponse, type NextRequest } from "next/server";
import { KARYAWAN_ABSENSI_AKTIF } from "./config/fitur";
import { apakahRuteDevTerblokir } from "./lib/env-produksi";
import { SESSION_COOKIE_NAME, bacaSesiDariId } from "./lib/session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (apakahRuteDevTerblokir(pathname)) {
    return NextResponse.rewrite(new URL("/__fitur-nonaktif__", request.url));
  }

  if (
    pathname === "/dev" ||
    pathname.startsWith("/dev/") ||
    pathname === "/detail-tiket" ||
    pathname.startsWith("/detail-tiket/")
  ) {
    return NextResponse.next();
  }

  if (KARYAWAN_ABSENSI_AKTIF) {
    return NextResponse.next();
  }

  const sesi = await bacaSesiDariId(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!sesi) {
    return NextResponse.redirect(new URL("/login", request.url), 307);
  }

  return NextResponse.rewrite(new URL("/__fitur-nonaktif__", request.url));
}

export const config = {
  matcher: [
    "/karyawan",
    "/karyawan/:path*",
    "/rekap-absensi",
    "/rekap-absensi/:path*",
    "/dev",
    "/dev/:path*",
    "/detail-tiket",
    "/detail-tiket/:path*",
  ],
};
