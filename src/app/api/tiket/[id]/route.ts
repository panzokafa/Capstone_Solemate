// API Tiket per ID:
// - GET   /api/tiket/[id] : Detail tiket lengkap beserta item & riwayat audit (kasir dan owner, hanya baca).
// - PATCH /api/tiket/[id] : Ubah status pesanan, ubah pembayaran, atau batalkan tiket (kasir saja).

import { after, NextRequest, NextResponse } from "next/server";
import { requireAuth, requireKasir } from "@/lib/auth";
import { ekstrakKodeGalatAman } from "@/lib/env-produksi";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";
import { validasiIdTiket, validasiUbahTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket, ubahTiket } from "@/lib/tiket";
import { jadwalkanPengirimanNotifikasiSiapDiambil } from "@/lib/wa-notifikasi";

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
    return tanganiGalatRoute("GET /api/tiket/[id] gagal", e);
  }
}

export async function PATCH(req: NextRequest, ctx: Konteks) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireKasir();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
    if (tolakLaju) return tolakLaju;

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

    // Phase 6B & 9A: Pemicu notifikasi otomatis saat tiket menjadi "Siap diambil" (FR-24).
    // Pengiriman dijadwalkan di dalam after() (next/server) agar aman di fungsi serverless
    // dan tidak menahan respons PATCH. Header x-sync-notifikasi hanya dihormati di non-produksi.
    const hasilJadwal = await jadwalkanPengirimanNotifikasiSiapDiambil({
      orderId: id,
      notifikasiDibuat: Boolean(hasil.notifikasiDibuat),
      tiketAwal: hasil.tiket,
      headerSync: req.headers.get("x-sync-notifikasi"),
      jadwalkanAfter: after,
      muatUlangTiket: (oid) => ambilDetailTiket(oid),
      catatGalat: (err) =>
        console.error("Background dispatch notifikasi gagal:", ekstrakKodeGalatAman(err)),
    });
    const tiketFinal = hasilJadwal.tiketFinal;

    return NextResponse.json(
      {
        ok: true,
        data: tiketFinal,
        idempoten: hasil.idempoten,
      },
      { status: 200 }
    );
  } catch (e) {
    return tanganiGalatRoute("PATCH /api/tiket/[id] gagal", e);
  }
}
