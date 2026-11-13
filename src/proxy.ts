// Proxy khusus halaman Karyawan & Rekap Absensi saat fitur ditunda:
// mencegah (app)/layout.tsx merender Sidebar khusus peran ke payload RSC 404
// agar respons 404 owner dan kasir benar-benar identik, sambil tetap mengarahkan
// pengunjung anonim ke /login.
import { NextResponse, type NextRequest } from "next/server";
import { KARYAWAN_ABSENSI_AKTIF } from "./config/fitur";
import { SESSION_COOKIE_NAME, bacaSesiDariId } from "./lib/session";

export async function proxy(request: NextRequest) {
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
  matcher: ["/karyawan", "/karyawan/:path*", "/rekap-absensi", "/rekap-absensi/:path*"],
};
