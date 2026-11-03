// API Buat Tiket — KASIR SAJA. Owner harus mendapat 403.
import { NextResponse } from "next/server";
import { requireKasir, AksesDitolakError } from "@/lib/auth";

export async function POST() {
  try {
    const sesi = await requireKasir();
    return NextResponse.json({ ok: true, peran: sesi.peran, created: true });
  } catch (e) {
    if (e instanceof AksesDitolakError) {
      return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
    }
    throw e;
  }
}
