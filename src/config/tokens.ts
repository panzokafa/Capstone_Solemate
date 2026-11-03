// Definisi token desain tunggal Solemate (Solemate Design System).
// Sumber kebenaran untuk warna, tipografi, radius, dan status.

export const WARNA = {
  // Primer (Navy)
  primary: "#133b63",
  primaryDark: "#002546",
  primaryHover: "#0c3b64",
  primaryLight: "#d3e4ff",

  // Latar & Kartu (Warm Paper / Cream)
  surfaceCanvas: "#fff9ef",
  surfaceApp: "#e5ded4",
  surfaceCard: "#faf4eb",
  surfaceSubtle: "#efebe4",
  surfaceHover: "#ede5d8",

  // Teks
  textMain: "#002546",
  textBody: "#1d1b16",
  textMuted: "#524c42",

  // Batas (Border)
  borderWarm: "#ece4d6",
  borderCard: "#e5ded3",

  // Aksi Bahaya
  danger: "#ba1a1a",
  dangerHover: "#93000a",
  dangerLight: "#ffdad6",

  // Status Pesanan (PRD)
  statusBelumDicuciBg: "#efebe4",
  statusBelumDicuciText: "#3e3a33",
  statusBelumDicuciBorder: "#e0d9cf",

  statusDiprosesBg: "#d3e4ff",
  statusDiprosesText: "#002546",
  statusDiprosesBorder: "#b9d7fe",

  statusSiapDiambilBg: "#fef3c7",
  statusSiapDiambilText: "#78350f",
  statusSiapDiambilBorder: "#fde68a",

  statusSudahDiambilBg: "#dcfce7",
  statusSudahDiambilText: "#14532d",
  statusSudahDiambilBorder: "#bbf7d0",

  statusDibatalkanBg: "#fee2e2",
  statusDibatalkanText: "#991b1b",
  statusDibatalkanBorder: "#fecaca",

  // Status Pembayaran (PRD) - Berbeda jelas dari Siap Diambil dan Dibatalkan
  statusBelumBayarBg: "#ffedd5",
  statusBelumBayarText: "#9a3412",
  statusBelumBayarBorder: "#fed7aa",

  statusLunasBg: "#dcfce7",
  statusLunasText: "#14532d",
  statusLunasBorder: "#bbf7d0",
} as const;

// Pasangan teks & latar yang wajib diuji rasio kontrasnya (minimal 4.5:1 untuk WCAG AA)
export const PASANGAN_KONTRAS: { nama: string; fg: string; bg: string }[] = [
  { nama: "Tombol Primer (White on Primary Navy)", fg: "#ffffff", bg: WARNA.primary },
  { nama: "Tombol Bahaya (White on Danger Red)", fg: "#ffffff", bg: WARNA.danger },
  { nama: "Tombol Sekunder (Navy on Surface Card)", fg: WARNA.primary, bg: WARNA.surfaceCard },
  { nama: "Teks Utama on Canvas", fg: WARNA.textMain, bg: WARNA.surfaceCanvas },
  { nama: "Teks Utama on Card", fg: WARNA.textMain, bg: WARNA.surfaceCard },
  { nama: "Teks Utama on App Surface", fg: WARNA.textMain, bg: WARNA.surfaceApp },
  { nama: "Teks Body on Canvas", fg: WARNA.textBody, bg: WARNA.surfaceCanvas },
  { nama: "Teks Body on Card", fg: WARNA.textBody, bg: WARNA.surfaceCard },
  { nama: "Teks Muted on Canvas", fg: WARNA.textMuted, bg: WARNA.surfaceCanvas },
  { nama: "Teks Muted on Card", fg: WARNA.textMuted, bg: WARNA.surfaceCard },
  { nama: "Status Pesanan: Belum Dicuci", fg: WARNA.statusBelumDicuciText, bg: WARNA.statusBelumDicuciBg },
  { nama: "Status Pesanan: Diproses", fg: WARNA.statusDiprosesText, bg: WARNA.statusDiprosesBg },
  { nama: "Status Pesanan: Siap Diambil", fg: WARNA.statusSiapDiambilText, bg: WARNA.statusSiapDiambilBg },
  { nama: "Status Pesanan: Sudah Diambil", fg: WARNA.statusSudahDiambilText, bg: WARNA.statusSudahDiambilBg },
  { nama: "Status Pesanan: Dibatalkan", fg: WARNA.statusDibatalkanText, bg: WARNA.statusDibatalkanBg },
  { nama: "Status Pembayaran: Belum Bayar", fg: WARNA.statusBelumBayarText, bg: WARNA.statusBelumBayarBg },
  { nama: "Status Pembayaran: Lunas", fg: WARNA.statusLunasText, bg: WARNA.statusLunasBg },
];

