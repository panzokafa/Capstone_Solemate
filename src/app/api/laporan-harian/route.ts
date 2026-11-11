// Endpoint API Laporan Harian Operasional (Phase 7A, FR-40 - FR-44).
// OWNER SAJA. Kasir ditolak 403.
// Hanya-baca (hanya metode GET). Tidak menerima mutasi atau angka dari klien.
// Respons dinamis tanpa cache lintas pengguna (Cache-Control: no-store).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner, AksesDitolakError } from "@/lib/auth.ts";
import {
  validasiQueryLaporanHarian,
  ambilLaporanHarian,
} from "@/lib/laporan.ts";

export const dynamic = "force-dynamic";

const HEADER_NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Vary: "Cookie",
};

export async function GET(req: NextRequest) {
  try {
    const sesi = await requireOwner();

    const validasi = validasiQueryLaporanHarian(req.nextUrl.searchParams);
    if (!validasi.ok) {
      return NextResponse.json(
        { error: validasi.galat },
        { status: validasi.kode, headers: HEADER_NO_STORE }
      );
    }

    const data = await ambilLaporanHarian(validasi.data);

    return NextResponse.json(
      { ok: true, peran: sesi.peran, data },
      { status: 200, headers: HEADER_NO_STORE }
    );
  } catch (e) {
    if (e instanceof AksesDitolakError) {
      return NextResponse.json(
        { error: "Akses ditolak" },
        { status: 403, headers: HEADER_NO_STORE }
      );
    }
    // Jika redirect Next.js (mis. belum login diarahkan ke /login)
    if (typeof e === "object" && e !== null && "digest" in e) {
      throw e;
    }
    console.error("GET /api/laporan-harian galat:", e instanceof Error ? e.name : "GALAT");
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server." },
      { status: 500, headers: HEADER_NO_STORE }
    );
  }
}
