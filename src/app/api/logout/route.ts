// POST /api/logout — cabut sesi aktif di database dan hapus cookie sesi.
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { periksaPermintaanUbah, tanganiGalatRoute } from "@/lib/request-guard";
import { hapusSesiCookie, hapusSesiDariDb, namaCookieSesi } from "@/lib/session";

export async function POST(req: NextRequest) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const jar = await cookies();
    const sesiId = jar.get(namaCookieSesi())?.value;
    await hapusSesiDariDb(sesiId);
    await hapusSesiCookie();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return tanganiGalatRoute("POST /api/logout gagal", e);
  }
}
