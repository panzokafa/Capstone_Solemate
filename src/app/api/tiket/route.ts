// API Tiket Pesanan:
// - GET  /api/tiket : Daftar tiket terfilter & terpaginasi (kasir dan owner — requireAuth).
// - POST /api/tiket : Buat tiket toko baru (kasir saja — request-guard + requireKasir + batas laju).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireKasir } from "@/lib/auth";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";
import { validasiBuatTiket, validasiQueryDaftarTiket } from "@/lib/tiket-validasi";
import { buatTiketToko, daftarTiket } from "@/lib/tiket";

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
    return tanganiGalatRoute("GET /api/tiket gagal", e);
  }
}

export async function POST(req: NextRequest) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireKasir();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
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

    const sekarang = new Date();

    const idempotencyHeader =
      req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
    if (
      idempotencyHeader &&
      typeof body === "object" &&
      body !== null &&
      !("idempotency_key" in body)
    ) {
      (body as Record<string, unknown>).idempotency_key = idempotencyHeader;
    }

    const v = validasiBuatTiket(body, sekarang);
    if (!v.ok) {
      return NextResponse.json(
        { error: v.galat, pesan: v.galat, field: v.field },
        { status: 400 }
      );
    }

    const hasil = await buatTiketToko(v.data, sesi.userId, sekarang);
    if (!hasil.ok) {
      return NextResponse.json(
        { error: hasil.galat, pesan: hasil.galat, field: hasil.field },
        { status: hasil.kode }
      );
    }

    const statusHttp = hasil.duplikat ? 200 : 201;

    return NextResponse.json(
      {
        ok: true,
        data: hasil.tiket,
        peringatan: hasil.peringatan,
        duplikat: hasil.duplikat ?? false,
      },
      { status: statusHttp }
    );
  } catch (e) {
    return tanganiGalatRoute("POST /api/tiket gagal", e);
  }
}
