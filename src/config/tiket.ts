// Konfigurasi terpusat modul Tiket Pesanan (Phase 5A).
// Letakkan batas dan asumsi bisnis tiket di satu tempat supaya mudah ditinjau pemilik toko.

export const ZONA_WAKTU_TOKO = "Asia/Jakarta";
export const OFFSET_WIB = "+07:00";

// Catatan penting: kode tiket (contoh SM-20261107-001) memakai TANGGAL TERBIT tiket di server
// dalam zona waktu Asia/Jakarta, BUKAN tanggal_masuk yang diisi kasir. Dengan begitu nomor urut
// resi harian selalu maju berurutan dan tidak bentrok walau kasir mencatat tiket susulan.
export const AWALAN_KODE_TIKET = "SM";

// Batas atas total nominal per tiket (Rp 1.000.000.000) untuk mencegah luapan kolom integer
// PostgreSQL (batas integer 32-bit bertanda adalah 2.147.483.647).
export const BATAS_TOTAL_TIKET = 1_000_000_000;

// Batas item & kuantitas pasang sepatu per tiket (PRD FR-11).
export const MAKS_ITEM_PER_TIKET = 20;
export const MIN_JUMLAH_PASANG = 1;
export const MAKS_JUMLAH_PASANG = 20;
export const MAKS_DESKRIPSI_BARANG = 200;
export const MAKS_NAMA_PELANGGAN = 100;

// Toleransi selisih jam perangkat kasir terhadap jam server untuk aturan
// "tanggal_masuk tidak boleh di masa depan".
export const TOLERANSI_TANGGAL_MASUK_MENIT = 5;

// Batas filter dan paginasi Daftar Tiket (semua parameter query dianggap input tidak tepercaya).
// Catatan asumsi (perlu konfirmasi pemilik toko): segmen "7_hari" (7 hari terakhir) dipakai
// sementara menggantikan istilah "beberapa hari lalu" pada PRD 7.3 / FR-13.
export const PERIODE_FILTER_TIKET = [
  "semua",
  "hari_ini",
  "kemarin",
  "7_hari",
  "rentang",
] as const;

export type PeriodeFilterTiket = (typeof PERIODE_FILTER_TIKET)[number];

export const MAKS_RENTANG_HARI_FILTER = 366;
export const UKURAN_HALAMAN_DEFAULT = 20;
export const MAKS_UKURAN_HALAMAN = 50;
export const MAKS_HALAMAN = 10_000;
export const MAKS_PANJANG_CARI = 100;

// Asumsi sementara (perlu konfirmasi pemilik toko — PRD bagian 13 butir 9):
// Estimasi selesai default dihitung dari tanggal_masuk ditambah estimasi_hari terbesar
// di antara seluruh layanan yang dipilih pada tiket tersebut.
export function hitungEstimasiSelesaiDefault(
  tanggalMasuk: Date,
  daftarEstimasiHari: number[]
): Date {
  const maksHari =
    daftarEstimasiHari.length > 0 ? Math.max(0, ...daftarEstimasiHari) : 0;
  return new Date(tanggalMasuk.getTime() + maksHari * 24 * 60 * 60 * 1000);
}
