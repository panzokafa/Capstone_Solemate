// Fungsi tunggal normalisasi nomor WhatsApp pelanggan (PRD FR-25) & pembuat tautan wa.me.
// Dipakai bersama oleh pembuatan tiket toko, pengecekan pelanggan, dan bot WhatsApp nantinya.

export type HasilNormalisasiWa =
  | { ok: true; nomor: string }
  | { ok: false; galat: string };

const POLA_WA_BAKU = /^62[0-9]{8,13}$/;

/**
 * Menormalkan nomor WhatsApp ke format baku database `62xxxxxxxxxx` (10-15 digit angka):
 * 1. Hapus spasi dan tanda baca umum: spasi/tab, tanda hubung (-), titik (.), tanda kurung.
 * 2. Ubah awalan `+62` menjadi `62`.
 * 3. Ubah awalan `08` menjadi `628`.
 * 4. Validasi terhadap pola `^62[0-9]{8,13}$`.
 */
export function normalisasiNomorWa(input: unknown): HasilNormalisasiWa {
  if (typeof input !== "string") {
    return { ok: false, galat: "Nomor WhatsApp wajib diisi berupa teks." };
  }

  const bersih = input.trim().replace(/[\s\-().]/g, "");
  if (bersih.length === 0) {
    return { ok: false, galat: "Nomor WhatsApp wajib diisi." };
  }

  let calon = bersih;
  if (calon.startsWith("+62")) {
    calon = "62" + calon.slice(3);
  } else if (calon.startsWith("08")) {
    calon = "628" + calon.slice(2);
  }

  if (!POLA_WA_BAKU.test(calon)) {
    return {
      ok: false,
      galat: "Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx atau 628xxxxxxxxxx (10-15 digit).",
    };
  }

  return { ok: true, nomor: calon };
}

/**
 * Membuat URL click-to-chat WhatsApp yang aman.
 * Isi pesan selalu di-encode dengan encodeURIComponent; pemanggil di komponen UI
 * wajib memasang rel="noopener noreferrer" saat membuka tab eksternal.
 */
export function buatUrlWaMe(nomorWa: string, pesan?: string): string {
  const hasil = normalisasiNomorWa(nomorWa);
  if (!hasil.ok) {
    throw new Error("Nomor WhatsApp untuk tautan wa.me tidak valid.");
  }
  const dasar = `https://wa.me/${hasil.nomor}`;
  if (!pesan || pesan.length === 0) return dasar;
  return `${dasar}?text=${encodeURIComponent(pesan)}`;
}

/**
 * Menyusun pesan awal click-to-chat WhatsApp sesuai status tiket (PRD 7.3 / FR-23).
 * Teks singkat berbahasa Indonesia, tanpa data sensitif (tanpa alasan batal internal / ID akun).
 */
export function buatPesanWaTiket(param: {
  kodeTiket: string;
  namaPelanggan: string;
  statusPesanan: string;
  statusBayar: string;
  totalRupiah: string;
}): string {
  const { kodeTiket, namaPelanggan, statusPesanan, statusBayar, totalRupiah } = param;
  if (statusPesanan === "Siap diambil") {
    return `Halo ${namaPelanggan}, pesanan cucian sepatu Anda di Solemate dengan kode tiket ${kodeTiket} sudah selesai dan siap diambil. Total: ${totalRupiah} (${statusBayar}). Terima kasih.`;
  }
  if (statusPesanan === "Diproses") {
    return `Halo ${namaPelanggan}, pesanan cucian sepatu Anda di Solemate (${kodeTiket}) saat ini sedang diproses. Total: ${totalRupiah} (${statusBayar}).`;
  }
  if (statusPesanan === "Sudah diambil") {
    return `Halo ${namaPelanggan}, pesanan cucian sepatu Anda (${kodeTiket}) tercatat sudah diambil. Terima kasih telah mempercayakan cucian sepatu Anda di Solemate Shoes Clean.`;
  }
  if (statusPesanan === "Dibatalkan") {
    return `Halo ${namaPelanggan}, menginformasikan bahwa tiket pesanan ${kodeTiket} di Solemate berstatus Dibatalkan. Silakan hubungi kami bila ada pertanyaan.`;
  }
  return `Halo ${namaPelanggan}, pesanan cucian sepatu Anda di Solemate telah tercatat dengan kode tiket ${kodeTiket} (status: Belum dicuci). Total: ${totalRupiah} (${statusBayar}). Terima kasih.`;
}
