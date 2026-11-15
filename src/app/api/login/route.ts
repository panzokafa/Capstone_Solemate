// POST /api/login — verifikasi PIN, rotasi sesi (hapus sesi lama & kedaluwarsa), dan buat sesi baru.
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { MAKS_PANJANG_USERNAME } from "@/config/keamanan";
import { ambilIp } from "@/lib/ip";
import { cobaLogin, PESAN_GAGAL } from "@/lib/login";
import { periksaPermintaanUbah, tanganiGalatRoute } from "@/lib/request-guard";
import { buatSesi, namaCookieSesi, setSesiCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  const tolak = periksaPermintaanUbah(req);
  if (tolak) return tolak;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Isi permintaan bukan JSON valid." },
        { status: 400 }
      );
    }

    const { username, pin } =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (typeof username !== "string" || username.trim().length === 0 || !pin) {
      return NextResponse.json({ error: "Field tidak boleh kosong." }, { status: 400 });
    }
    if (username.trim().length > MAKS_PANJANG_USERNAME) {
      return NextResponse.json({ error: "Nama pengguna terlalu panjang." }, { status: 400 });
    }
    // PIN selalu tepat 6 digit angka (aturan pemilik). Ditolak di server, bukan hanya di keypad.
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: "PIN harus tepat 6 digit angka." }, { status: 400 });
    }

    const ip = ambilIp(req);
    const hasil = await cobaLogin(username, pin, ip);

    if (!hasil.ok) {
      // Status HTTP 403 dan pesan identik untuk PIN salah, akun tak dikenal, nonaktif,
      // maupun akun terkunci; hanya kunci per-IP yang dibedakan (tidak bergantung akun).
      const msg =
        hasil.alasan === "kunci_ip"
          ? "Terlalu banyak percobaan dari IP ini. Coba lagi nanti."
          : PESAN_GAGAL;
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    const jar = await cookies();
    const sesiLamaId = jar.get(namaCookieSesi())?.value ?? null;
    const sesiId = await buatSesi(hasil.userId, hasil.peran, ip, sesiLamaId);
    await setSesiCookie(sesiId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return tanganiGalatRoute("POST /api/login gagal", e);
  }
}
