// Pengambilan alamat IP klien secara aman dengan validasi sintaks IP (`node:net`).
// - Jika TRUST_PROXY !== "true", seluruh header forward selalu diabaikan.
// - Di Vercel (`VERCEL === "1"`), edge network menimpa `x-forwarded-for` dan menyuntikkan
//   `x-vercel-forwarded-for` serta `x-real-ip`.
// - Di luar Vercel, `x-vercel-forwarded-for` dan header vendor lain (`cf-connecting-ip`,
//   `true-client-ip`, `x-client-ip`, `forwarded`) tidak pernah dipercaya.
import type { NextRequest } from "next/server";
import { isIP } from "node:net";
import { MAKS_PANJANG_IP } from "../config/keamanan.ts";

function ekstrakIpValid(nilai: string | null): string | null {
  if (!nilai) return null;
  const pertama = nilai.split(",")[0]?.trim() ?? "";
  if (pertama.length === 0 || pertama.length > MAKS_PANJANG_IP) return null;
  return isIP(pertama) !== 0 ? pertama : null;
}

export function ambilIp(
  req: NextRequest | Request,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.TRUST_PROXY !== "true") return null;

  if (env.VERCEL === "1") {
    return (
      ekstrakIpValid(req.headers.get("x-vercel-forwarded-for")) ??
      ekstrakIpValid(req.headers.get("x-real-ip")) ??
      ekstrakIpValid(req.headers.get("x-forwarded-for"))
    );
  }

  return (
    ekstrakIpValid(req.headers.get("x-forwarded-for")) ??
    ekstrakIpValid(req.headers.get("x-real-ip"))
  );
}
