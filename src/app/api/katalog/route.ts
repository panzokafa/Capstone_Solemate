// API Katalog — OWNER SAJA. Kasir mendapat 403 (kasir membaca layanan aktif lewat /api/katalog/aktif).
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { daftarSemuaLayanan, tambahLayanan } from "@/lib/katalog";
import { validasiTambah } from "@/lib/katalog-validasi";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";

const PESAN_NAMA_NONAKTIF =
  "Layanan dengan nama ini sudah ada tetapi nonaktif. Aktifkan kembali dari daftar.";

export async function GET() {
  try {
    await requireOwner();
    return NextResponse.json({ ok: true, data: await daftarSemuaLayanan() });
  } catch (e) {
    return tanganiGalatRoute("GET /api/katalog gagal", e);
  }
}

export async function POST(req: NextRequest) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireOwner();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
    if (tolakLaju) return tolakLaju;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Isi permintaan bukan JSON valid." }, { status: 400 });
    }
    const v = validasiTambah(body);
    if (!v.ok) return NextResponse.json({ error: v.galat }, { status: 400 });

    const hasil = await tambahLayanan(v.data, sesi.userId);
    if (!hasil.ok) {
      return NextResponse.json(
        {
          error:
            hasil.alasan === "nama_nonaktif"
              ? PESAN_NAMA_NONAKTIF
              : "Nama layanan sudah dipakai layanan lain.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, data: hasil.layanan }, { status: 201 });
  } catch (e) {
    return tanganiGalatRoute("POST /api/katalog gagal", e);
  }
}
