import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
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
