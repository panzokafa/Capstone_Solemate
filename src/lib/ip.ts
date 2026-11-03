// Ambil alamat IP klien. X-Forwarded-For hanya dipercaya jika TRUST_PROXY=true.
import type { NextRequest } from "next/server";

export function ambilIp(req: NextRequest | Request): string | null {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      // Entri pertama adalah klien asli (dari proxy tepercaya).
      const first = xff.split(",")[0].trim();
      if (first) return first;
    }
  }
  // Di Node runtime, remote address tidak tersedia lewat Request biasa.
  // Kembalikan null jika tidak ada header tepercaya.
  return null;
}
