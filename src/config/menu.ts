// Daftar menu sidebar per peran (sumber tunggal, dipakai layout).
export type ItemMenu = { href: string; label: string; ikon: string };

export const MENU_OWNER: ItemMenu[] = [
  { href: "/", label: "Dashboard", ikon: "dashboard" },
  { href: "/tiket", label: "Daftar Tiket", ikon: "confirmation_number" },
  { href: "/laporan-harian", label: "Laporan Harian", ikon: "event_note" },
  { href: "/rekap-bulanan", label: "Rekap Bulanan", ikon: "calendar_month" },
  { href: "/katalog", label: "Katalog Layanan", ikon: "style" },
  { href: "/karyawan", label: "Karyawan", ikon: "badge" },
  { href: "/rekap-absensi", label: "Rekap Absensi", ikon: "fact_check" },
];

export const MENU_KASIR: ItemMenu[] = [
  { href: "/", label: "Dashboard", ikon: "dashboard" },
  { href: "/tiket", label: "Daftar Tiket", ikon: "confirmation_number" },
  { href: "/buat-tiket", label: "Buat Tiket", ikon: "add_circle" },
  { href: "/absensi", label: "Absensi", ikon: "schedule" },
];
