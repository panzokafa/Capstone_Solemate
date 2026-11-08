// API Tiket per ID:
// - GET   /api/tiket/[id] : Detail tiket lengkap beserta item & riwayat audit (kasir dan owner, hanya baca).
// - PATCH /api/tiket/[id] : Ubah status pesanan, ubah pembayaran, atau batalkan tiket (kasir saja).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireKasir, AksesDitolakError } from "@/lib/auth";
import { periksaPermintaanUbah } from "@/lib/request-guard";
import { validasiIdTiket, validasiUbahTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket, ubahTiket } from "@/lib/tiket";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

type Konteks = { params: Promise<{ id: string }> };

function apakahRedirectNext(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e;
}

function logGalatAman(label: string, e: unknown): void {
  const kode =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : e instanceof Error
        ? e.name
        : "GALAT";
  console.error(`${label}:`, kode);
}

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
    if (apakahRedirectNext(e)) throw e;
    logGalatAman("GET /api/tiket/[id] gagal", e);
    return GALAT_SERVER();
  }
}

export async function PATCH(req: NextRequest, ctx: Konteks) {
  try {
    const sesi = await requireKasir();

    const tolak = periksaPermintaanUbah(req);
    if (tolak) return tolak;

    const { id: teksId } = await ctx.params;
    const id = validasiIdTiket(teksId);
    if (id === null) {
      return NextResponse.json(
        { error: "ID tiket harus berupa bilangan bulat positif.", field: "id" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Isi permintaan bukan JSON valid." },
        { status: 400 }
      );
    }

    const v = validasiUbahTiket(body);
    if (!v.ok) {
      return NextResponse.json(
        { error: v.galat, pesan: v.galat, field: v.field },
        { status: 400 }
      );
    }

    const hasil = await ubahTiket(id, v.data, sesi.userId);
    if (!hasil.ok) {
      return NextResponse.json(
        {
          error: hasil.galat,
          pesan: hasil.galat,
          kode_konflik: hasil.kode_konflik,
          field: hasil.field,
          data: hasil.tiket ?? null,
        },
        { status: hasil.kode }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        data: hasil.tiket,
        idempoten: hasil.idempoten,
      },
      { status: 200 }
    );
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (apakahRedirectNext(e)) throw e;
    logGalatAman("PATCH /api/tiket/[id] gagal", e);
    return GALAT_SERVER();
  }
}
