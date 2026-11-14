// Penjaga endpoint yang mengubah data (POST/PUT/PATCH):
//  - Content-Type wajib application/json (form lintas-situs tidak bisa mengirim ini tanpa preflight).
//  - Header Origin wajib ada dan harus sama dengan alamat aplikasi.
//  - TIDAK PERNAH mempercayai X-Forwarded-Host karena dapat dipalsukan klien di sejumlah konfigurasi proxy.
//  - Di produksi (NODE_ENV === "production"), APP_ORIGIN wajib diisi (https://...) dan menjadi
//    satu-satunya acuan origin yang diizinkan.
//  - Di pengembangan/tes (non-produksi), menerima header Host permintaan atau daftar APP_ORIGIN.
import { NextRequest, NextResponse } from "next/server";
import {
  apakahOriginDiizinkan,
  evaluasiPermintaanUbah,
} from "./env-produksi.ts";

export { apakahOriginDiizinkan, evaluasiPermintaanUbah };

// Mengembalikan response galat, atau null kalau permintaan lolos.
export function periksaPermintaanUbah(
  req: NextRequest,
  env: Record<string, string | undefined> = process.env
): NextResponse | null {
  const hasil = evaluasiPermintaanUbah(req, env);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return null;
}
