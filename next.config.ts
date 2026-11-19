import type { NextConfig } from "next";
import { bangunHeaderKeamanan } from "./src/lib/security-headers.ts";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "argon2"],
  outputFileTracingIncludes: {
    "/api/rekap-bulanan/ekspor": ["./node_modules/pdfkit/js/data/**/*"],
  },
  experimental: {
    // Nonaktifkan pengingat upgrade agen otomatis agar `next dev` (server tes) dan `next build`
    // tidak berhenti mendadak dengan SecurityFatalError saat upgrade tidak diminta.
    agentUpgrade: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: bangunHeaderKeamanan(process.env),
      },
    ];
  },
  /* config options here */
  // cacheComponents & partialPrefetching dimatikan: tidak ada fitur `use cache`
  // yang dipakai, dan cacheComponents membuat `export const dynamic` di halaman
  // login gagal build. partialPrefetching hanya bisa hidup bersama cacheComponents.
  // Server tes memakai distDir terpisah supaya tidak bentrok dengan dev server.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Kunci root proyek agar Turbopack tidak salah membaca package.json
  // di folder di atas repo (mis. /Users/user).
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
