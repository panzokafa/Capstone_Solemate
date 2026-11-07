// Penjaga endpoint yang mengubah data (POST/PUT/PATCH):
//  - Content-Type wajib application/json (form lintas-situs tidak bisa mengirim ini tanpa preflight).
//  - Header Origin wajib ada dan harus sama dengan alamat aplikasi.
// Alamat aplikasi = header Host permintaan. Kalau di belakang proxy tepercaya (TRUST_PROXY=true)
// X-Forwarded-Host juga diterima. Opsional: APP_ORIGIN (daftar origin dipisah koma) untuk
// alamat tetap, mis. https://solemate.example.
import { NextRequest, NextResponse } from "next/server";

function hostDiizinkan(req: NextRequest): Set<string> {
  const set = new Set<string>();
  const host = req.headers.get("host");
  if (host) set.add(host.toLowerCase());
  if (process.env.TRUST_PROXY === "true") {
    const xfh = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (xfh) set.add(xfh.toLowerCase());
  }
  for (const o of (process.env.APP_ORIGIN ?? "").split(",")) {
    const t = o.trim();
    if (!t) continue;
    try {
      set.add(new URL(t).host.toLowerCase());
    } catch {
      // abaikan nilai APP_ORIGIN yang salah format
    }
  }
  return set;
}

// Mengembalikan response galat, atau null kalau permintaan lolos.
export function periksaPermintaanUbah(req: NextRequest): NextResponse | null {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(ct)) {
    return NextResponse.json(
      { error: "Content-Type harus application/json." },
      { status: 415 }
    );
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ error: "Asal permintaan tidak valid." }, { status: 403 });
  }
  let hostOrigin: string;
  try {
    hostOrigin = new URL(origin).host.toLowerCase();
  } catch {
    return NextResponse.json({ error: "Asal permintaan tidak valid." }, { status: 403 });
  }
  if (!hostDiizinkan(req).has(hostOrigin)) {
    return NextResponse.json({ error: "Asal permintaan tidak valid." }, { status: 403 });
  }
  return null;
}
