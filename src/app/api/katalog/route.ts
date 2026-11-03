// API Katalog — OWNER SAJA. Kasir harus mendapat 403.
import { NextResponse } from "next/server";
import { requireOwner, AksesDitolakError } from "@/lib/auth";

export async function GET() {
  try {
    const sesi = await requireOwner();
    return NextResponse.json({ ok: true, peran: sesi.peran, data: "katalog" });
  } catch (e) {
    if (e instanceof AksesDitolakError) {
      return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
    }
    throw e;
  }
}
