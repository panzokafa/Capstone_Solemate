// Helper pemformatan terpusat untuk Rupiah dan Tanggal (Solemate Shoes Clean).
// Aturan: Rupiah (Rp 25.000), bahasa Indonesia, zona waktu Asia/Jakarta (WIB).

const ZONA_WAKTU = "Asia/Jakarta";

/**
 * Format angka ke mata uang Rupiah standar Indonesia.
 * Contoh: 0 -> "Rp 0", 25000 -> "Rp 25.000", 1500000 -> "Rp 1.500.000"
 */
export function formatRupiah(nilai: number | null | undefined): string {
  if (nilai === null || nilai === undefined || isNaN(nilai)) {
    return "Rp 0";
  }
  const pemisahRibuan = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(Math.round(nilai));

  return `Rp ${pemisahRibuan}`;
}

export type OpsiFormatTanggal = {
  denganWaktu?: boolean;
  ringkas?: boolean;
};

/**
 * Format tanggal ke format standar Indonesia dengan zona waktu Asia/Jakarta.
 * Memastikan konversi dari UTC ke WIB akurat, termasuk pergantian hari.
 * Contoh:
 * - "2026-05-10T20:00:00.000Z" -> "11 Mei 2026" (WIB +7 jam)
 * - denganWaktu: true -> "11 Mei 2026, 03.00 WIB"
 */
export function formatTanggal(
  input: Date | string | number | null | undefined,
  opsi: OpsiFormatTanggal = {}
): string {
  if (!input) return "-";

  const tgl = typeof input === "object" && input instanceof Date ? input : new Date(input);
  if (isNaN(tgl.getTime())) return "-";

  const namaBulan = opsi.ringkas ? "short" : "long";

  const formatterTgl = new Intl.DateTimeFormat("id-ID", {
    timeZone: ZONA_WAKTU,
    day: "numeric",
    month: namaBulan,
    year: "numeric",
  });

  const teksTgl = formatterTgl.format(tgl);

  if (opsi.denganWaktu) {
    const formatterJam = new Intl.DateTimeFormat("id-ID", {
      timeZone: ZONA_WAKTU,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const teksJam = formatterJam.format(tgl).replace(":", ".");
    return `${teksTgl}, ${teksJam} WIB`;
  }

  return teksTgl;
}

/**
 * Format hanya bagian waktu (HH.mm WIB) dalam zona waktu Asia/Jakarta.
 */
export function formatWaktu(input: Date | string | number | null | undefined): string {
  if (!input) return "-";
  const tgl = typeof input === "object" && input instanceof Date ? input : new Date(input);
  if (isNaN(tgl.getTime())) return "-";

  const formatterJam = new Intl.DateTimeFormat("id-ID", {
    timeZone: ZONA_WAKTU,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${formatterJam.format(tgl).replace(":", ".")} WIB`;
}

