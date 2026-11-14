// POST /api/pelanggan/cek — Pemeriksaan pelanggan berdasarkan nomor WhatsApp untuk kasir.
// Menggunakan POST dengan body JSON (bukan GET query URL) supaya nomor WhatsApp tidak muncul di URL/log akses,
// serta dilindungi periksaPermintaanUbah(), requireKasir(), dan batas laju per pengguna.

import { NextRequest, NextResponse } from "next/server";
import { requireKasir } from "@/lib/auth";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";
import { validasiCekPelanggan } from "@/lib/tiket-validasi";
import { cekPelangganByNomorWa } from "@/lib/tiket";

export async function POST(req: NextRequest) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireKasir();

    const tolakLaju = await tegakkanBatasLajuApi("pelanggan_cek", sesi.userId);
    if (tolakLaju) return tolakLaju;

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
      return NextResponse.json(
        { error: v.galat, pesan: v.galat, field: v.field },
        { status: 400 }
      );
    }

    const hasil = await cekPelangganByNomorWa(v.data.nomor_wa);
    return NextResponse.json({
      ok: true,
      ditemukan: hasil.ditemukan,
      data: hasil.pelanggan ? { nama: hasil.pelanggan.nama } : null,
    });
  } catch (e) {
    return tanganiGalatRoute("POST /api/pelanggan/cek gagal", e);
  }
}
