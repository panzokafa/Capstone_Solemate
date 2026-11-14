// Endpoint API Rekap Bulanan — OWNER SAJA (Phase 7B, FR-50, FR-51, FR-52).
// Kasir ditolak 403; tanpa login diarahkan ke /login.
// Hanya-baca (hanya metode GET). Tidak menerima mutasi atau angka dari klien.
// Respons dinamis tanpa cache lintas pengguna (Cache-Control: no-store, Vary: Cookie).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { validasiQueryRekapBulanan, ambilRekapBulanan } from "@/lib/laporan";
import { tanganiGalatRoute } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

const HEADER_NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Vary: "Cookie",
};

export async function GET(req: NextRequest) {
  try {
    const sesi = await requireOwner();

    const validasi = validasiQueryRekapBulanan(req.nextUrl.searchParams);
    if (!validasi.ok) {
      return NextResponse.json(
        { error: validasi.galat },
        { status: validasi.kode, headers: HEADER_NO_STORE }
      );
    }

    const data = await ambilRekapBulanan(validasi.data);

    return NextResponse.json(
      { ok: true, peran: sesi.peran, data },
      { status: 200, headers: HEADER_NO_STORE }
    );
  } catch (e) {
    return tanganiGalatRoute("GET /api/rekap-bulanan gagal", e, HEADER_NO_STORE);
  }
}
