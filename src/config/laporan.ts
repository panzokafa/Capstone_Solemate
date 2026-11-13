// Konfigurasi terpusat Laporan Harian Operasional & Dashboard (Phase 7A).
// Mendefinisikan periode, batasan rentang, dan dokumentasi asumsi metrik.

export const ZONA_WAKTU_LAPORAN = "Asia/Jakarta";
export const OFFSET_WIB_LAPORAN = "+07:00";

export const PERIODE_LAPORAN = ["hari_ini", "kemarin", "rentang"] as const;
export type PeriodeLaporan = (typeof PERIODE_LAPORAN)[number];

export const MAKS_RENTANG_HARI_LAPORAN = 366;
export const JUMLAH_HARI_TREN_DASHBOARD = 7;
export const JUMLAH_TIKET_TERBARU_DASHBOARD = 5;

export const PERIODE_REKAP_BULANAN = ["bulan_ini", "bulan_lalu", "rentang"] as const;
export type PeriodeRekapBulanan = (typeof PERIODE_REKAP_BULANAN)[number];
export const FORMAT_EKSPOR_REKAP = ["xlsx", "pdf"] as const;
export type FormatEksporRekap = (typeof FORMAT_EKSPOR_REKAP)[number];
export const MAKS_LAYANAN_TERLARIS = 10;
export const TEKS_LABA_RUGI_BELUM_TERSEDIA =
  "Belum tersedia: sumber data pengeluaran belum ditentukan";

/**
 * Catatan Asumsi & Keterbatasan Metrik (Phase 7A & 7B - Perlu Dikonfirmasi Pemilik Toko):
 * 1. Pesanan Masuk: Dihitung menurut tanggal_masuk (WIB) pada periode dan bukan Dibatalkan.
 *    Volume fisik sepatu dihitung per pasang (SUM(order_items.jumlah)), bukan per tiket atau baris item.
 * 2. Pembayaran Diterima: Dihitung menurut tanggal_bayar (WIB) pada periode untuk tiket Lunas yang
 *    tidak dibatalkan, dipisahkan menjadi Cash ("Cash tercatat di sistem") dan Non-cash.
 * 3. Pembatalan & Pembalikan:
 *    - Jumlah tiket dibatalkan pada periode dihitung dari audit_logs aksi 'BATALKAN_TIKET'.
 *    - Tiket dibatalkan setelah sempat Lunas dihitung dari audit BATALKAN_TIKET yang nilai_lama->>'status_bayar' = 'Lunas'.
 *      Hanya menghitung jumlah tiket yang sempat Lunas lalu dibatalkan (tanpa nominal).
 *    - Pembalikan pembayaran dihitung dari audit 'UBAH_PEMBAYARAN' (dari Lunas ke Belum bayar).
 * 4. Layanan Terlaris (Rekap Bulanan): Dikelompokkan per service_id menggunakan nama layanan saat ini
 *    dan nominal dari order_items.harga_saat_transaksi. Memakai pembulatan jujur 1 desimal untuk
 *    setiap baris (termasuk baris "Lainnya") dari porsi aslinya terhadap total pasang (0 bila total
 *    pasang nol), sehingga baris "Lainnya" yang berisi pasang tidak menjadi 0,0% ataupun negatif
 *    dan total porsi yang tampil wajar berada di sekitar 99,9%–100,1% (bisa sedikit berbeda saat banyak baris).
 * 5. Keterbatasan Keadaan Sekarang (Live State vs Snapshot):
 *    Laporan dihitung dari data tiket saat ini (bukan snapshot pembekuan saat tutup toko).
 *    Perubahan setelah periode berlalu (seperti tiket kemarin yang baru dilunasi atau dibatalkan hari ini)
 *    dapat menggeser rincian status pada periode lampau. Sebaliknya, perubahan harga layanan di katalog
 *    tidak mengubah laporan lama karena seluruh nominal menggunakan order_items.harga_saat_transaksi.
 */
export const TEKS_DISCLAIMER_LAPORAN =
  "Angka dihitung dari data tiket saat ini; perubahan setelah periode berlalu dapat menggeser angka hari lampau.";

export const TEKS_CATATAN_PEMBULATAN_LAYANAN =
  "Persentase dibulatkan satu desimal per baris (termasuk Lainnya) dari porsi aslinya terhadap total pasang; total dapat berkisar 99,9%–100,1% akibat pembulatan.";

/**
 * Hitung persentase dengan pembulatan 1 angka di belakang koma.
 * Mengembalikan 0 jika total <= 0 untuk mencegah NaN.
 */
export function hitungPersentaseSatuDesimal(bagian: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((bagian * 1000) / total) / 10;
}

/**
 * Konversi nilai agregat database (bigint/string dari pg) ke angka number JavaScript secara aman.
 * Batas aman JavaScript: Number.MAX_SAFE_INTEGER = 9.007.199.254.740.991 (~9 x 10^15).
 * Nilai per tiket dibatasi Rp 1.000.000.000 (10^9), sehingga total kumulatif ratusan ribu tiket
 * tetap berada jauh di bawah Number.MAX_SAFE_INTEGER.
 */
export function keNominalAman(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER || n < 0) {
    throw new Error(`Nilai nominal di luar rentang angka aman JavaScript: ${String(v)}`);
  }
  return n;
}

export function keJumlahAman(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n > Number.MAX_SAFE_INTEGER || n < 0) {
    throw new Error(`Nilai jumlah di luar rentang integer aman JavaScript: ${String(v)}`);
  }
  return n;
}
