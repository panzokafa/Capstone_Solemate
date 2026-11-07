// API Tiket Pesanan:
// - GET  /api/tiket : Daftar tiket terfilter & terpaginasi (kasir dan owner — requireAuth).
// - POST /api/tiket : Buat tiket toko baru (kasir saja — requireKasir + request-guard).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireKasir, AksesDitolakError } from "@/lib/auth";
import { periksaPermintaanUbah } from "@/lib/request-guard";
import { validasiBuatTiket, validasiQueryDaftarTiket } from "@/lib/tiket-validasi";
import { buatTiketToko, daftarTiket } from "@/lib/tiket";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

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

export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const v = validasiQueryDaftarTiket(req.nextUrl.searchParams);
    if (!v.ok) {
      return NextResponse.json({ error: v.galat }, { status: 400 });
    }

    const hasil = await daftarTiket(v.data);
    return NextResponse.json({
      ok: true,
      data: hasil.data,
      paginasi: hasil.paginasi,
    });
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (apakahRedirectNext(e)) throw e;
    logGalatAman("GET /api/tiket gagal", e);
    return GALAT_SERVER();
  }
}

export async function POST(req: NextRequest) {
  try {
    const sesi = await requireKasir();

    const tolak = periksaPermintaanUbah(req);
    if (tolak) return tolak;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Isi permintaan bukan JSON valid." },
        { status: 400 }
      );
    }

    const sekarang = new Date();
    const v = validasiBuatTiket(body, sekarang);
    if (!v.ok) {
      return NextResponse.json({ error: v.galat }, { status: 400 });
    }

    const hasil = await buatTiketToko(v.data, sesi.userId, sekarang);
    if (!hasil.ok) {
      return NextResponse.json({ error: hasil.galat }, { status: hasil.kode });
    }

    return NextResponse.json(
      {
        ok: true,
        data: hasil.tiket,
        peringatan: hasil.peringatan,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (apakahRedirectNext(e)) throw e;
    logGalatAman("POST /api/tiket gagal", e);
    return GALAT_SERVER();
  }
}
