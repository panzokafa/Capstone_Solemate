// Endpoint API Ekspor Rekap Bulanan ke Excel (.xlsx) dan PDF (FR-53).
// Owner saja: kasir ditolak 403 JSON; tanpa login redirect 307 ke /login.
// Hanya-baca (GET saja; metode lain otomatis 405). Audit EKSPOR_REKAP bersifat fail-closed.
// Semua error selalu mengembalikan JSON (tidak pernah mengirim file korup).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner, AksesDitolakError } from "@/lib/auth.ts";
import { validasiQueryEksporRekap } from "@/lib/laporan.ts";
import { eksporRekapDenganAudit } from "@/lib/rekap-ekspor.ts";

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
    if (e instanceof AksesDitolakError) {
      return NextResponse.json(
        { error: "Akses ditolak" },
        { status: 403, headers: HEADER_KEAMANAN }
      );
    }
    if (typeof e === "object" && e !== null && "digest" in e) {
      throw e;
    }
    console.error("GET /api/rekap-bulanan/ekspor galat:", e instanceof Error ? e.name : "GALAT");
    return NextResponse.json(
      { error: "Gagal mengekspor rekap bulanan." },
      { status: 500, headers: HEADER_KEAMANAN }
    );
  }
}
