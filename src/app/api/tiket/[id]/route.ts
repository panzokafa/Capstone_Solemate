// GET /api/tiket/[id] — Detail tiket lengkap beserta item & riwayat audit (kasir dan owner, hanya baca).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket } from "@/lib/tiket";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

type Konteks = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Konteks) {
  try {
    await requireAuth();

    const { id: teksId } = await ctx.params;
    const id = validasiIdTiket(teksId);
    if (id === null) {
      return NextResponse.json(
        { error: "ID tiket harus berupa bilangan bulat positif." },
        { status: 400 }
      );
    }

    const tiket = await ambilDetailTiket(id);
    if (!tiket) {
      return NextResponse.json(
        { error: "Tiket tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, data: tiket });
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (typeof e === "object" && e !== null && "digest" in e) throw e;
    console.error("GET /api/tiket/[id] gagal:", e instanceof Error ? e.name : "GALAT");
    return GALAT_SERVER();
  }
}
