// POST /api/login — verifikasi PIN dan buat sesi.
import { NextRequest, NextResponse } from "next/server";
import { cobaLogin, PESAN_GAGAL } from "@/lib/login";
import { buatSesi, setSesiCookie } from "@/lib/session";
import { ambilIp } from "@/lib/ip";

export async function POST(req: NextRequest) {
  const { username, pin } = await req.json();
  if (!username || !pin) {
    return NextResponse.json({ error: "Field tidak boleh kosong." }, { status: 400 });
  }

  const ip = ambilIp(req);
  const hasil = await cobaLogin(username, pin, ip);

  if (!hasil.ok) {
    // Pesan seragam untuk semua kasus.
    const msg =
      hasil.alasan === "kunci_akun"
        ? "Akun dikunci sementara. Coba lagi nanti."
        : hasil.alasan === "kunci_ip"
          ? "Terlalu banyak percobaan dari IP ini. Coba lagi nanti."
          : PESAN_GAGAL;
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const sesiId = await buatSesi(hasil.userId, hasil.peran, ip);
  await setSesiCookie(sesiId);
  return NextResponse.json({ ok: true });
}
