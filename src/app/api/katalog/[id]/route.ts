// PUT   /api/katalog/[id]  — ubah nama, harga, estimasi hari (OWNER SAJA).
// PATCH /api/katalog/[id]  — atur status dengan target eksplisit { "aktif": true|false } (OWNER SAJA, idempoten).
// Tidak ada DELETE: layanan hanya dinonaktifkan.
import { NextRequest, NextResponse } from "next/server";
import { requireOwner, AksesDitolakError } from "@/lib/auth";
import { ekstrakKodeGalatAman } from "@/lib/env-produksi";
import { ubahLayanan, aturStatusLayanan, type HasilUbah } from "@/lib/katalog";
import { validasiUbah, validasiStatus, validasiId } from "@/lib/katalog-validasi";
import { periksaPermintaanUbah } from "@/lib/request-guard";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

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
    { error: "Nama layanan sudah dipakai layanan aktif lain." },
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

function tanganiGalat(e: unknown, nama: string): NextResponse {
  if (e instanceof AksesDitolakError) return DITOLAK();
  // Redirect ke /login (belum login) dilempar Next sebagai error khusus: teruskan.
  if (typeof e === "object" && e !== null && "digest" in e) throw e;
  console.error(`${nama} /api/katalog/[id] gagal:`, ekstrakKodeGalatAman(e));
  return GALAT_SERVER();
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;
  try {
    const sesi = await requireOwner();
    const id = validasiId((await ctx.params).id);
    if (id === null) return NextResponse.json({ error: "ID layanan tidak valid." }, { status: 400 });

    const b = await bacaJson(req);
    if (!b.ok) return NextResponse.json({ error: "Isi permintaan bukan JSON valid." }, { status: 400 });
    const v = validasiUbah(b.body);
    if (!v.ok) return NextResponse.json({ error: v.galat }, { status: 400 });

    return jawab(await ubahLayanan(id, v.data, sesi.userId));
  } catch (e) {
    return tanganiGalat(e, "PUT");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;
  try {
    const sesi = await requireOwner();
    const id = validasiId((await ctx.params).id);
    if (id === null) return NextResponse.json({ error: "ID layanan tidak valid." }, { status: 400 });

    const b = await bacaJson(req);
    if (!b.ok) return NextResponse.json({ error: "Isi permintaan bukan JSON valid." }, { status: 400 });
    const v = validasiStatus(b.body);
    if (!v.ok) return NextResponse.json({ error: v.galat }, { status: 400 });

    return jawab(await aturStatusLayanan(id, v.data.aktif, sesi.userId));
  } catch (e) {
    return tanganiGalat(e, "PATCH");
  }
}
