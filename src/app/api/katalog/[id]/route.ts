// PUT   /api/katalog/[id]  — ubah nama, harga, estimasi hari (OWNER SAJA).
// PATCH /api/katalog/[id]  — atur status dengan target eksplisit { "aktif": true|false } (OWNER SAJA, idempoten).
// Tidak ada DELETE: layanan hanya dinonaktifkan.
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { ubahLayanan, aturStatusLayanan, type HasilUbah } from "@/lib/katalog";
import { validasiUbah, validasiStatus, validasiId } from "@/lib/katalog-validasi";
import {
  periksaPermintaanUbah,
  tanganiGalatRoute,
  tegakkanBatasLajuApi,
} from "@/lib/request-guard";

function jawab(hasil: HasilUbah): NextResponse {
  if (hasil.ok) {
    return NextResponse.json({ ok: true, berubah: hasil.berubah, data: hasil.layanan });
  }
  if (hasil.alasan === "tidak_ada") {
    return NextResponse.json({ error: "Layanan tidak ditemukan." }, { status: 404 });
  }
  if (hasil.alasan === "nama_nonaktif") {
    return NextResponse.json(
      { error: "Layanan dengan nama ini sudah ada tetapi nonaktif. Aktifkan kembali dari daftar." },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { error: "Nama layanan sudah dipakai layanan lain." },
    { status: 409 }
  );
}

async function bacaJson(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireOwner();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
    if (tolakLaju) return tolakLaju;

    const id = validasiId((await ctx.params).id);
    if (id === null) return NextResponse.json({ error: "ID layanan tidak valid." }, { status: 400 });

    const b = await bacaJson(req);
    if (!b.ok) return NextResponse.json({ error: "Isi permintaan bukan JSON valid." }, { status: 400 });
    const v = validasiUbah(b.body);
    if (!v.ok) return NextResponse.json({ error: v.galat }, { status: 400 });

    return jawab(await ubahLayanan(id, v.data, sesi.userId));
  } catch (e) {
    return tanganiGalatRoute("PUT /api/katalog/[id] gagal", e);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    const sesi = await requireOwner();

    const tolakLaju = await tegakkanBatasLajuApi("ubah_data", sesi.userId);
    if (tolakLaju) return tolakLaju;

    const id = validasiId((await ctx.params).id);
    if (id === null) return NextResponse.json({ error: "ID layanan tidak valid." }, { status: 400 });

    const b = await bacaJson(req);
    if (!b.ok) return NextResponse.json({ error: "Isi permintaan bukan JSON valid." }, { status: 400 });
    const v = validasiStatus(b.body);
    if (!v.ok) return NextResponse.json({ error: v.galat }, { status: 400 });

    return jawab(await aturStatusLayanan(id, v.data.aktif, sesi.userId));
  } catch (e) {
    return tanganiGalatRoute("PATCH /api/katalog/[id] gagal", e);
  }
}
