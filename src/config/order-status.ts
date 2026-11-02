// Satu tempat untuk daftar status pesanan dan status pembayaran.
// Kalau daftar final berubah (pertanyaan terbuka PRD), ubah hanya di sini.

export const STATUS_PESANAN = [
  "Belum dicuci",
  "Diproses",
  "Siap diambil",
  "Sudah diambil",
  "Dibatalkan",
] as const;

export type StatusPesanan = (typeof STATUS_PESANAN)[number];

export const STATUS_BAYAR = ["Belum bayar", "Lunas"] as const;

export type StatusBayar = (typeof STATUS_BAYAR)[number];

// Metode pembayaran hanya dicatat, tidak diproses sistem (PRD FR-81).
// Sementara cash / non-cash saja; jenis non-cash masih pertanyaan terbuka.
export const METODE_BAYAR = ["Cash", "Non-cash"] as const;

export type MetodeBayar = (typeof METODE_BAYAR)[number];
