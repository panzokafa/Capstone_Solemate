// Pembangun header keamanan HTTP & Content Security Policy (Phase 9B).
// Dipanggil oleh `next.config.ts headers()` agar berlaku seragam di halaman, API, dan unduhan.

export type HeaderKeamanan = {
  key: string;
  value: string;
};

/**
 * Menyusun Content-Security-Policy tanpa nonce (Next.js static headers).
 * Mengizinkan `'unsafe-inline'` untuk skrip hidrasi RSC Next.js dan atribut `style` inline
 * pada grafik Rekap Bulanan. CSP berbasis nonce direncanakan untuk fase hosting berbayar.
 */
export function bangunCsp(adalahProduksi: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${adalahProduksi ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (adalahProduksi) {
    // Hanya dipasang di produksi agar server HTTP lokal/pengujian tidak dipaksa naik ke HTTPS.
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

/**
 * Membangun daftar header keamanan untuk seluruh rute (`/:path*`).
 * Strict-Transport-Security hanya dipasang saat `NODE_ENV === "production"`,
 * tanpa `includeSubDomains` dan tanpa `preload`.
 */
export function bangunHeaderKeamanan(
  env: Record<string, string | undefined> = process.env
): HeaderKeamanan[] {
  const adalahProduksi = env.NODE_ENV === "production";

  const headers: HeaderKeamanan[] = [
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Content-Security-Policy",
      value: bangunCsp(adalahProduksi),
    },
  ];

  if (adalahProduksi) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000",
    });
  }

  return headers;
}
