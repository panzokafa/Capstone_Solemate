// GET /api/katalog/aktif — daftar layanan AKTIF untuk kasir (dan owner). Hanya baca.
// Hanya mengembalikan id, nama, harga, estimasi_hari.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { daftarLayananAktif } from "@/lib/katalog";
import { tanganiGalatRoute } from "@/lib/request-guard";

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ ok: true, data: await daftarLayananAktif() });
  } catch (e) {
    return tanganiGalatRoute("GET /api/katalog/aktif gagal", e);
  }
}
