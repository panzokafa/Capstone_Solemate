// POST /api/pelanggan/cek — Pemeriksaan pelanggan berdasarkan nomor WhatsApp untuk kasir.
// Menggunakan POST dengan body JSON (bukan GET query URL) supaya nomor WhatsApp tidak muncul di URL/log akses,
// serta dilindungi requireKasir() dan periksaPermintaanUbah() (Content-Type JSON & Origin).

import { NextRequest, NextResponse } from "next/server";
import { requireKasir, AksesDitolakError } from "@/lib/auth";
import { periksaPermintaanUbah } from "@/lib/request-guard";
import { validasiCekPelanggan } from "@/lib/tiket-validasi";
import { cekPelangganByNomorWa } from "@/lib/tiket";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

export async function POST(req: NextRequest) {
  try {
    await requireKasir();

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

    const v = validasiCekPelanggan(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.galat }, { status: 400 });
    }

    const hasil = await cekPelangganByNomorWa(v.data.nomor_wa);
    return NextResponse.json({
      ok: true,
      ditemukan: hasil.ditemukan,
      data: hasil.pelanggan,
    });
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (typeof e === "object" && e !== null && "digest" in e) throw e;
    console.error("POST /api/pelanggan/cek gagal:", e instanceof Error ? e.name : "GALAT");
    return GALAT_SERVER();
  }
}
