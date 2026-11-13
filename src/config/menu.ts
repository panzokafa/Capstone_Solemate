import type { NamaIkon } from "./icons.ts";
import { KARYAWAN_ABSENSI_AKTIF } from "./fitur.ts";

// Daftar menu sidebar per peran (sumber tunggal, dipakai layout).
export type ItemMenu = { href: string; label: string; ikon: NamaIkon };

const MENU_OWNER_INTI: ItemMenu[] = [
  { href: "/", label: "Dashboard", ikon: "dashboard" },
  { href: "/tiket", label: "Daftar Tiket", ikon: "confirmation_number" },
  { href: "/laporan-harian", label: "Laporan Harian", ikon: "event_note" },
  { href: "/rekap-bulanan", label: "Rekap Bulanan", ikon: "calendar_month" },
  { href: "/katalog", label: "Katalog Layanan", ikon: "style" },
];

const MENU_OWNER_KARYAWAN_ABSENSI: ItemMenu[] = [
  { href: "/karyawan", label: "Karyawan", ikon: "badge" },
  { href: "/rekap-absensi", label: "Rekap Absensi", ikon: "fact_check" },
];

const MENU_KASIR_INTI: ItemMenu[] = [
  { href: "/", label: "Dashboard", ikon: "dashboard" },
  { href: "/tiket", label: "Daftar Tiket", ikon: "confirmation_number" },
  { href: "/buat-tiket", label: "Buat Tiket", ikon: "add_circle" },
];

const MENU_KASIR_KARYAWAN_ABSENSI: ItemMenu[] = [
  { href: "/absensi", label: "Absensi", ikon: "schedule" },
];

/** Bangun daftar menu Owner berdasarkan saklar fitur Karyawan & Absensi. */
export function buatMenuOwner(karyawanAbsensiAktif: boolean = KARYAWAN_ABSENSI_AKTIF): ItemMenu[] {
  return karyawanAbsensiAktif
    ? [...MENU_OWNER_INTI, ...MENU_OWNER_KARYAWAN_ABSENSI]
    : [...MENU_OWNER_INTI];
}

/** Bangun daftar menu Kasir berdasarkan saklar fitur Karyawan & Absensi. */
export function buatMenuKasir(karyawanAbsensiAktif: boolean = KARYAWAN_ABSENSI_AKTIF): ItemMenu[] {
  return karyawanAbsensiAktif
    ? [...MENU_KASIR_INTI, ...MENU_KASIR_KARYAWAN_ABSENSI]
    : [...MENU_KASIR_INTI];
}

export const MENU_OWNER: ItemMenu[] = buatMenuOwner();

export const MENU_KASIR: ItemMenu[] = buatMenuKasir();
