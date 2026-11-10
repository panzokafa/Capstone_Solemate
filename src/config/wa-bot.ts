// Konfigurasi modul WhatsApp Bot (Phase 6A).
// ASUMSI: format pesan, template teks, dan ambang batas ini perlu dikonfirmasi pemilik toko.

export const ZONA_WAKTU_BOT = "Asia/Jakarta";

// Batasan ukuran payload & pesan masuk
export const MAKS_BYTES_WEBHOOK_WA = 65_536; // 64 KB
export const MAKS_USIA_WEBHOOK_DETIK = 300; // 5 menit (toleransi replay attack & jam melayang)
export const MAKS_PANJANG_PESAN_WA = 2000; // Batas panjang teks pesan masuk yang diproses
export const MAKS_SIMPAN_ISI_PESANAN_WA = 1000; // Batas potong penyimpanan isi pesan di database

// Pembatas laju (Rate Limits) atomik
export const BATAS_PESAN_PER_MENIT = 12; // Maksimal pesan per pengirim per menit
export const BATAS_TIKET_BARU_PER_JAM = 5; // Maksimal pembuatan tiket per pengirim per jam
export const BATAS_GLOBAL_TIKET_WA_PER_JAM = 30; // Maksimal total tiket WA yang dibuat per jam
export const MAKS_TIKET_BELUM_DICUCI_PER_NOMOR = 5; // Maksimal tiket berstatus 'Belum dicuci' per pelanggan
export const JEDA_MINIMAL_BALASAN_BERUNTUN_MS = 1000; // Jeda minimal antar balasan
export const JEDA_MEDIA_HINT_DETIK = 300; // Jeda minimal (5 menit) sebelum mengirim ulang panduan media

// Konfigurasi Notifikasi Keluar (Phase 6B, FR-24)
export const BATAS_NOTIFIKASI_PER_MENIT = 20; // Batas laju global notifikasi keluar per menit
export const BATAS_NOTIFIKASI_PER_JAM = 300; // Batas laju global notifikasi keluar per jam
export const TIMEOUT_NOTIFIKASI_MS = 5000; // Batas waktu tunggu kirim gateway notifikasi
export const JEDA_ACAK_NOTIFIKASI_MAKS_MS = 2000; // Jeda acak maksimal 2 detik sebelum kirim

// Template pesan notifikasi siap diambil (Phase 6B, FR-24)
// Wajib ketat: hanya kode tiket, status selesai & siap diambil, dan status bayar.
// Tidak boleh memuat nama pelanggan, harga, nama toko, alamat, jam buka, atau tanggal luar data.
export function buatPesanNotifikasiSiapDiambil(
  kodeTiket: string,
  statusBayar: string
): string {
  return `Pesanan dengan kode tiket ${kodeTiket}: sepatu sudah selesai dan siap diambil. Status pembayaran: ${statusBayar}.`;
}

// Jenis & Nilai Serah Terima
export const SERAH_TERIMA_ANTAR_SENDIRI = "antar_sendiri" as const;
export const SERAH_TERIMA_JEMPUT = "jemput" as const;
export type SerahTerima =
  | typeof SERAH_TERIMA_ANTAR_SENDIRI
  | typeof SERAH_TERIMA_JEMPUT;

// Template teks balasan bot WhatsApp
export function buatTeksFormatPemesanan(apakahLid: boolean = false): string {
  if (apakahLid) {
    return `📋 *Format Pemesanan Cuci Sepatu*

Silakan kirim pesan dengan format berikut:

Nama: <Nama Anda>
Barang: <Nomor atau Nama Layanan> | <Jumlah pasang> | <Deskripsi sepatu>
Antar/Jemput: <Antar sendiri / Jemput>
Nomor WA: <Nomor WhatsApp aktif Anda>

_Catatan: Karena akun WhatsApp Anda menggunakan fitur privasi (@lid), mohon sertakan Nomor WA agar kasir kami dapat mencocokkan dan menghubungi Anda untuk pesanan ini._

Contoh:
Nama: Budi Santoso
Barang: 1 | 2 | Sneakers putih Nike Air Force & Ventela hitam
Antar/Jemput: Antar sendiri
Nomor WA: 081234567890

_Catatan: Ketik *1* untuk melihat daftar layanan aktif. Nomor layanan (1, 2, dst) mengacu pada nomor urut pricelist saat ini dan dapat berubah jika katalog diperbarui._`;
  }

  return `📋 *Format Pemesanan Cuci Sepatu*

Silakan kirim pesan dengan format berikut:

Nama: <Nama Anda>
Barang: <Nomor atau Nama Layanan> | <Jumlah pasang> | <Deskripsi sepatu>
Antar/Jemput: <Antar sendiri / Jemput>

Contoh:
Nama: Budi Santoso
Barang: 1 | 2 | Sneakers putih Nike Air Force & Ventela hitam
Antar/Jemput: Antar sendiri

_Catatan: Ketik *1* untuk melihat daftar layanan aktif. Nomor layanan (1, 2, dst) mengacu pada nomor urut pricelist saat ini dan dapat berubah jika katalog diperbarui._`;
}

export const PESAN_BOT = {
  MENU_UTAMA: `Halo! Selamat datang di *Solemate Shoes Clean* 👟

Silakan balas dengan angka atau kata kunci pilihan Anda:
1️⃣ *Daftar Layanan & Harga*
2️⃣ *Format Pemesanan*
3️⃣ *Cek Status Pesanan*

Ketik *MENU* kapan saja untuk kembali ke pilihan ini.`,

  FORMAT_PEMESANAN: buatTeksFormatPemesanan(false),

  MEDIA_DITERIMA: `Halo! Kami telah menerima foto/dokumen Anda. Mohon maaf, saat ini bot belum dapat memproses gambar secara otomatis.

Untuk melihat daftar layanan atau memesan pencucian sepatu, silakan ketik *MENU*.`,

  RATE_LIMIT_PESAN: `Mohon tunggu sebentar. Anda mengirim pesan terlalu cepat. Silakan tunggu beberapa saat sebelum mengirim pesan kembali.`,

  RATE_LIMIT_TIKET_PENGGUNA: `Mohon maaf, Anda telah mencapai batas maksimal pembuatan pesanan baru dalam 1 jam terakhir. Silakan hubungi toko langsung jika memerlukan bantuan mendesak.`,

  RATE_LIMIT_GLOBAL_PENUH: `Mohon maaf, antrean pemesanan WhatsApp toko kami sedang penuh saat ini. Silakan hubungi kasir toko langsung atau coba kembali dalam beberapa saat.`,

  MAKS_TIKET_AKTIF_TERCAPAI: (jumlah: number) =>
    `Mohon maaf, Anda masih memiliki ${jumlah} pesanan aktif yang belum dicuci. Mohon tunggu proses pencucian sebelumnya selesai sebelum membuat pesanan baru.`,

  LID_CEK_PROGRESS_DITOLAK: `Mohon maaf, fitur cek status otomatis melalui pesan ini memerlukan identitas nomor WhatsApp pengirim yang dapat diverifikasi. Akun Anda saat ini menggunakan identitas privasi WhatsApp (@lid). Silakan hubungi kasir toko langsung atau gunakan nomor WhatsApp reguler untuk pengecekan tiket.`,

  LID_ORDER_BUTUH_NOMOR: `Akun Anda menggunakan identitas tersembunyi WhatsApp (@lid). Mohon sertakan baris 'Nomor WA: 08xxxxxxxxxx' pada pesan pemesanan Anda agar kasir dapat mencocokkan pesanan Anda.`,

  TIKET_TIDAK_DITEMUKAN: `Pesanan tidak ditemukan atau tidak terdaftar pada nomor WhatsApp Anda. Pastikan kode tiket sudah benar (contoh: *cek SM-20261108-001*).`,

  TIDAK_ADA_TIKET_AKTIF: `Tidak ditemukan pesanan aktif untuk nomor WhatsApp Anda saat ini. Ketik *2* jika Anda ingin membuat pesanan baru.`,

  NOTIFIKASI_DINONAKTIFKAN: `Notifikasi WhatsApp untuk nomor Anda telah dinonaktifkan. Anda tidak akan menerima notifikasi otomatis saat pesanan siap diambil. Ketik *MULAI* kapan saja untuk mengaktifkan kembali.`,

  NOTIFIKASI_DIAKTIFKAN: `Notifikasi WhatsApp untuk nomor Anda telah diaktifkan kembali. Anda akan menerima notifikasi otomatis saat pesanan siap diambil. Ketik *STOP* kapan saja untuk berhenti.`,

  NOTIFIKASI_LID_PETUNJUK: `Pengaturan notifikasi otomatis hanya dapat diubah melalui nomor WhatsApp reguler atau langsung melalui kasir toko, karena akun Anda menggunakan fitur privasi (@lid).`,
};
