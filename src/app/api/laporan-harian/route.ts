// Endpoint API Laporan Harian Operasional (Phase 7A, FR-40 - FR-44).
// OWNER SAJA. Kasir ditolak 403.
// Hanya-baca (hanya metode GET). Tidak menerima mutasi atau angka dari klien.
// Respons dinamis tanpa cache lintas pengguna (Cache-Control: no-store).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { validasiQueryLaporanHarian, ambilLaporanHarian } from "@/lib/laporan";
import { tanganiGalatRoute } from "@/lib/request-guard";

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
    return tanganiGalatRoute("GET /api/laporan-harian gagal", e, HEADER_NO_STORE);
  }
}
