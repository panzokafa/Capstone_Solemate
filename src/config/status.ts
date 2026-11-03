// Pemetaan terpusat warna, label, dan gaya badge status pesanan & status bayar (PRD Solemate).
// Aturan: Warna harus berbeda jelas satu sama lain dan selalu menampilkan label teks.
import {
  STATUS_PESANAN,
  STATUS_BAYAR,
  type StatusPesanan,
  type StatusBayar,
} from "./order-status.ts";

export { STATUS_PESANAN, STATUS_BAYAR, type StatusPesanan, type StatusBayar };

export type KonfigurasiStatus = {
  label: string;
  className: string;
};

// Konfigurasi visual status pesanan:
// - Belum dicuci: Abu-abu netral
// - Diproses: Biru navy lembut
// - Siap diambil: Amber / Emas (berbeda jelas dari Belum bayar dan Dibatalkan)
// - Sudah diambil: Hijau emerald segar
// - Dibatalkan: Merah maroon tegas
export const KONFIGURASI_STATUS_PESANAN: Record<StatusPesanan, KonfigurasiStatus> = {
  "Belum dicuci": {
    label: "Belum Dicuci",
    className: "bg-status-belum-dicuci-bg text-status-belum-dicuci-text border-status-belum-dicuci-border",
  },
  Diproses: {
    label: "Diproses",
    className: "bg-status-diproses-bg text-status-diproses-text border-status-diproses-border",
  },
  "Siap diambil": {
    label: "Siap Diambil",
    className: "bg-status-siap-diambil-bg text-status-siap-diambil-text border-status-siap-diambil-border",
  },
  "Sudah diambil": {
    label: "Sudah Diambil",
    className: "bg-status-sudah-diambil-bg text-status-sudah-diambil-text border-status-sudah-diambil-border",
  },
  Dibatalkan: {
    label: "Dibatalkan",
    className: "bg-status-dibatalkan-bg text-status-dibatalkan-text border-status-dibatalkan-border",
  },
};

// Konfigurasi visual status bayar:
// - Belum bayar: Oranye koral / peach hangat (berbeda jelas dari Siap diambil dan Dibatalkan)
// - Lunas: Hijau emerald segar
export const KONFIGURASI_STATUS_BAYAR: Record<StatusBayar, KonfigurasiStatus> = {
  "Belum bayar": {
    label: "Belum Bayar",
    className: "bg-status-belum-bayar-bg text-status-belum-bayar-text border-status-belum-bayar-border",
  },
  Lunas: {
    label: "Lunas",
    className: "bg-status-lunas-bg text-status-lunas-text border-status-lunas-border",
  },
};
