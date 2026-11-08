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

// Batas rentang tanggal pesanan (asumsi sementara — perlu konfirmasi pemilik toko):
// 1. tanggal_masuk maksimal 30 hari ke belakang (memungkinkan pencatatan tiket susulan yang wajar)
// 2. tanggal_masuk maksimal 5 menit ke depan (toleransi selisih jam perangkat kasir vs server)
// 3. estimasi_selesai maksimal 365 hari setelah tanggal_masuk (mencegah kesalahan ketik tahun jauh)
export const MAKS_HARI_MASUK_LAMPAU = 30;
export const TOLERANSI_TANGGAL_MASUK_MENIT = 5;
export const MAKS_HARI_ESTIMASI_SELESAI = 365;

// Masa simpan kunci idempotensi sebelum dibersihkan secara berkala (jam).
export const MASA_SIMPAN_IDEMPOTENSI_JAM = 24;

// Catatan Keterbatasan Sistem & Rekomendasi Mitigasi (Phase 5A):
// 1. Pencarian nomor WhatsApp lewat query string URL GET /api/tiket?cari=08...
//    berpotensi terekam di access log server HTTP/reverse proxy. Disarankan di masa depan
//    menggunakan konfigurasi masking log atau audit log tersendiri untuk penelusuran.
// 2. Endpoint POST /api/pelanggan/cek saat ini belum memiliki rate limiting per user/IP
//    (berbeda dengan login yang dilindungi login_rate_limit). Disarankan di masa depan
//    diberi pembatas frekuensi (mis. 30 cek/menit) untuk mencegah enumerasi pelanggan.

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

// ---------- Konfigurasi Mutasi & Tiket Lama Phase 5B ----------
// Batas panjang alasan pembatalan tiket dan alasan pembalikan status Lunas -> Belum bayar.
export const MAKS_ALASAN_TIKET = 200;

// Asumsi sementara (perlu konfirmasi pemilik toko — PRD FR-17 "pesanan dua hari lalu"):
// Tiket berstatus "Siap diambil" yang sudah mencapai minimal MIN_HARI_BELUM_DIAMBIL hari kalender
// (>= 2 hari di zona Asia/Jakarta sejak siap_diambil_pada) diberi lencana "N hari belum diambil"
// dan dapat difilter pada Daftar Tiket. Waktu siap_diambil_pada hanya diisi saat masih NULL dan
// tidak pernah di-reset walau status sempat dikoreksi mundur lalu maju kembali.
export const MIN_HARI_BELUM_DIAMBIL = 2;

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
