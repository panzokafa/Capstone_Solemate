// Endpoint pengaturan preferensi notifikasi WhatsApp pelanggan (Phase 6B, FR-24 / FR-25).
// - PATCH /api/pelanggan/[id]/notifikasi : Kasir saja. Mengaktifkan/menonaktifkan notifikasi pelanggan toko.

import { NextRequest, NextResponse } from "next/server";
import { requireKasir } from "@/lib/auth";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { ubahNotifikasiPelanggan } from "@/lib/tiket";

type Konteks = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Konteks) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireKasir();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
    if (tolakLaju) return tolakLaju;

    const { id: teksId } = await ctx.params;
    const customerId = validasiIdTiket(teksId);
    if (customerId === null) {
      return NextResponse.json(
        { error: "ID pelanggan harus berupa bilangan bulat positif.", field: "id" },
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

    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as { aktif?: unknown }).aktif !== "boolean"
    ) {
      return NextResponse.json(
        { error: "Field 'aktif' wajib berupa boolean.", field: "aktif" },
        { status: 400 }
      );
    }

    const aktif = (body as { aktif: boolean }).aktif;
    const hasil = await ubahNotifikasiPelanggan(customerId, aktif, sesi.userId);

    if (!hasil.ok) {
      return NextResponse.json(
        { error: hasil.pesan ?? "Pelanggan tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        data: {
          customer_id: hasil.customerId,
          notifikasi_wa_aktif: hasil.aktif,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    return tanganiGalatRoute("PATCH /api/pelanggan/[id]/notifikasi gagal", e);
  }
}
