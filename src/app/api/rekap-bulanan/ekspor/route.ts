// Endpoint API Ekspor Rekap Bulanan ke Excel (.xlsx) dan PDF (FR-53).
// Owner saja: kasir ditolak 403 JSON; tanpa login redirect 307 ke /login.
// Hanya-baca (GET saja; metode lain otomatis 405). Audit EKSPOR_REKAP bersifat fail-closed.
// Semua error selalu mengembalikan JSON (tidak pernah mengirim file korup).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { validasiQueryEksporRekap } from "@/lib/laporan";
import { eksporRekapDenganAudit } from "@/lib/rekap-ekspor";
import { tanganiGalatRoute, tegakkanBatasLajuApi } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER_KEAMANAN = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

const MIME_EKSPOR = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

export async function GET(req: NextRequest) {
  try {
    const sesi = await requireOwner();

    const tolakLaju = await tegakkanBatasLajuApi(
      "ekspor_rekap",
      sesi.userId,
      HEADER_KEAMANAN
    );
    if (tolakLaju) return tolakLaju;

    const validasi = validasiQueryEksporRekap(req.nextUrl.searchParams);
    if (!validasi.ok) {
      return NextResponse.json(
        { error: validasi.galat },
        { status: validasi.kode, headers: HEADER_KEAMANAN }
      );
    }

    const { format, filter } = validasi.data;
    const { buffer, model } = await eksporRekapDenganAudit({
      filter,
      format,
      userId: sesi.userId,
    });

    const namaAman = model.namaBerkasDasar.replace(/[^a-zA-Z0-9._-]/g, "");
    const namaFile = `${namaAman}.${format}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...HEADER_KEAMANAN,
        "Content-Type": MIME_EKSPOR[format],
        "Content-Disposition": `attachment; filename="${namaFile}"`,
      },
    });
  } catch (e) {
    return tanganiGalatRoute("GET /api/rekap-bulanan/ekspor gagal", e, HEADER_KEAMANAN);
  }
}
