// Validasi murni (tanpa koneksi database) untuk pembuatan tiket, cek pelanggan, ID tiket,
// dan seluruh parameter query Daftar Tiket. Dipakai oleh route handler, halaman, dan tes unit.

import {
  STATUS_PESANAN,
  STATUS_BAYAR,
  METODE_BAYAR,
  type StatusPesanan,
  type StatusBayar,
  type MetodeBayar,
} from "../config/order-status.ts";
import {
  OFFSET_WIB,
  MAKS_ITEM_PER_TIKET,
  MIN_JUMLAH_PASANG,
  MAKS_JUMLAH_PASANG,
  MAKS_DESKRIPSI_BARANG,
  MAKS_NAMA_PELANGGAN,
  MAKS_ALASAN_TIKET,
  MAKS_HARI_MASUK_LAMPAU,
  TOLERANSI_TANGGAL_MASUK_MENIT,
  MAKS_HARI_ESTIMASI_SELESAI,
  PERIODE_FILTER_TIKET,
  MAKS_RENTANG_HARI_FILTER,
  UKURAN_HALAMAN_DEFAULT,
  MAKS_UKURAN_HALAMAN,
  MAKS_HALAMAN,
  MAKS_PANJANG_CARI,
  type PeriodeFilterTiket,
} from "../config/tiket.ts";
import { normalisasiNomorWa } from "./nomor-wa.ts";
import { formatTanggalYmdWib } from "./format.ts";

const BATAS_ID_INT = 2_147_483_647;
const MS_PER_HARI = 86_400_000;

// Karakter terlarang pada input teks pengguna (nama pelanggan, deskripsi barang):
// - Karakter kontrol (0x00-0x1F, 0x7F-0x9F), termasuk tab (\t), baris baru (\r, \n), dan byte nol (\0).
// - Karakter bidi / pembalik arah teks (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069).
// - Karakter lebar-nol / zero-width (U+200B-U+200D, U+2060, U+FEFF).
export const POLA_KARAKTER_TERLARANG =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;

export function mengandungKarakterTerlarang(teks: string): boolean {
  return POLA_KARAKTER_TERLARANG.test(teks);
}

/**
 * Mendeteksi apakah respons fetch dialihkan ke halaman login atau mengembalikan 401
 * akibat sesi autentikasi pengguna telah kedaluwarsa atau hilang.
 */
export function apakahSesiDialihkanKeLogin(res: {
  status?: number;
  redirected?: boolean;
  url?: string;
  headers?: { get: (name: string) => string | null };
}): boolean {
  if (res.redirected && typeof res.url === "string" && res.url.includes("/login")) {
    return true;
  }
  if (res.status === 401) {
    return true;
  }
  const cType =
    res.headers && typeof res.headers.get === "function"
      ? res.headers.get("content-type") ?? ""
      : "";
  if (
    cType.includes("text/html") &&
    (res.status === 302 || res.status === 307 || res.redirected)
  ) {
    return true;
  }
  return false;
}

export type PetaGalatField = Record<string, string>;

/**
 * Pemetaan galat terstruktur dari respons server ke kolom/baris form UI.
 * Menggunakan kode `field` dari server (bukan regex pada teks kalimat error).
 */
export function petakanGalatServer(
  pesan: string,
  field?: string | null
): { peta: PetaGalatField; umum: string | null } {
  const peta: PetaGalatField = {};

  if (field) {
    if (field === "nama_pelanggan") {
      peta.nama_pelanggan = pesan;
      return { peta, umum: pesan };
    }
    if (field === "nomor_wa") {
      peta.nomor_wa = pesan;
      return { peta, umum: pesan };
    }
    if (field === "tanggal_masuk") {
      peta.tanggal_masuk = pesan;
      return { peta, umum: pesan };
    }
    if (field === "estimasi_selesai") {
      peta.estimasi_selesai = pesan;
      return { peta, umum: pesan };
    }
    if (field === "status_bayar") {
      peta.status_bayar = pesan;
      return { peta, umum: pesan };
    }
    if (field === "metode_bayar") {
      peta.metode_bayar = pesan;
      return { peta, umum: pesan };
    }

    // items.N.service_id, items.N.deskripsi_barang, items.N.jumlah, atau items.N
    const itemMatch = field.match(
      /^items\.(\d+)(?:\.(service_id|deskripsi_barang|jumlah))?$/
    );
    if (itemMatch) {
      const idx = Number(itemMatch[1]);
      const sub = itemMatch[2];
      if (sub === "service_id") {
        peta[`item_${idx}_service`] = pesan;
      } else if (sub === "jumlah") {
        peta[`item_${idx}_jumlah`] = pesan;
      } else if (sub === "deskripsi_barang") {
        peta[`item_${idx}_deskripsi`] = pesan;
      } else {
        peta[`item_${idx}_deskripsi`] = pesan;
      }
      return { peta, umum: pesan };
    }
  }

  return { peta, umum: pesan };
}

export type HasilValidasi<T> =
  | { ok: true; data: T }
  | { ok: false; galat: string; field?: string };

export type InputItemTiket = {
  service_id: number;
  deskripsi_barang: string;
  jumlah: number;
};

export type InputBuatTiket = {
  idempotency_key?: string | null;
  nama_pelanggan: string;
  nomor_wa: string;
  konfirmasi_ubah_nama: boolean;
  jangan_kirim_notifikasi_wa?: boolean;
  items: InputItemTiket[];
  tanggal_masuk: Date;
  tanggal_masuk_diisi?: boolean;
  estimasi_selesai: Date | null;
  status_bayar: StatusBayar;
  metode_bayar: MetodeBayar | null;
};

export type FilterDaftarTiket = {
  periode: PeriodeFilterTiket;
  dari: string | null;
  sampai: string | null;
  batas_mulai: Date | null;
  batas_akhir_eksklusif: Date | null;
  belum_bayar_di_atas: boolean;
  belum_diambil_lama?: boolean;
  cari: string;
  halaman: number;
  ukuran: number;
};

export type InputUbahStatusPesanan = {
  jenis: "status_pesanan";
  status_pesanan: Exclude<StatusPesanan, "Dibatalkan">;
  status_sebelumnya: StatusPesanan;
  konfirmasi_belum_bayar: boolean;
};

export type InputUbahPembayaran =
  | {
      jenis: "pembayaran";
      status_bayar: "Lunas";
      metode_bayar: MetodeBayar;
      status_sebelumnya: StatusBayar;
      alasan: null;
    }
  | {
      jenis: "pembayaran";
      status_bayar: "Belum bayar";
      metode_bayar: null;
      status_sebelumnya: StatusBayar;
      alasan: string | null;
    };

export type InputBatalkanTiket = {
  jenis: "batalkan";
  alasan_batal: string;
  konfirmasi_sudah_lunas: boolean;
  status_sebelumnya: StatusPesanan;
};

export type InputUbahTiket =
  | InputUbahStatusPesanan
  | InputUbahPembayaran
  | InputBatalkanTiket;

function objekBiasa(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function kunciAsing(body: Record<string, unknown>, diizinkan: string[]): string | null {
  return Object.keys(body).find((k) => !diizinkan.includes(k)) ?? null;
}

/**
 * Validasi ID tiket dari segmen URL `/tiket/[id]` atau `/api/tiket/[id]`.
 * Hanya menerima bilangan bulat positif murni (tanpa nol di depan, negatif, pecahan, atau huruf).
 */
export function validasiIdTiket(teks: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(teks)) return null;
  const n = Number(teks);
  return n >= 1 && n <= BATAS_ID_INT ? n : null;
}

function uraiTanggalKalender(
  teks: string
): { tahun: number; bulan: number; hari: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks);
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  if (bulan < 1 || bulan > 12 || hari < 1 || hari > 31) return null;
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (
    d.getUTCFullYear() !== tahun ||
    d.getUTCMonth() !== bulan - 1 ||
    d.getUTCDate() !== hari
  ) {
    return null;
  }
  return { tahun, bulan, hari };
}

export function tanggalHariIniWib(sekarang: Date = new Date()): string {
  return formatTanggalYmdWib(sekarang);
}

export function geserHariKalender(tglYmd: string, deltaHari: number): string {
  const k = uraiTanggalKalender(tglYmd);
  if (!k) throw new Error(`Tanggal kalender tidak valid: ${tglYmd}`);
  return new Date(Date.UTC(k.tahun, k.bulan - 1, k.hari + deltaHari))
    .toISOString()
    .slice(0, 10);
}

export function batasAwalHariWib(tglYmd: string): Date {
  return new Date(`${tglYmd}T00:00:00.000${OFFSET_WIB}`);
}

function uraiWaktuInput(
  v: unknown,
  label: string,
  akhirHariJikaTanggalSaja: boolean
): HasilValidasi<Date> {
  if (typeof v !== "string") {
    return { ok: false, galat: `${label} harus berupa teks tanggal/waktu yang valid.` };
  }
  const s = v.trim();
  if (s.length === 0) {
    return { ok: false, galat: `${label} tidak boleh kosong.` };
  }

  // 1. Format tanggal saja: YYYY-MM-DD (diinterpretasikan dalam zona Asia/Jakarta).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (!uraiTanggalKalender(s)) {
      return { ok: false, galat: `${label} bukan tanggal kalender yang valid.` };
    }
    const jam = akhirHariJikaTanggalSaja ? "23:59:59.999" : "00:00:00.000";
    return { ok: true, data: new Date(`${s}T${jam}${OFFSET_WIB}`) };
  }

  // 2. Format datetime lokal tanpa offset (mis. dari input datetime-local): YYYY-MM-DDTHH:mm[:ss[.sss]]
  const mLokal = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(s);
  if (mLokal) {
    if (!uraiTanggalKalender(mLokal[1])) {
      return { ok: false, galat: `${label} bukan tanggal kalender yang valid.` };
    }
    const jam = Number(mLokal[2]);
    const menit = Number(mLokal[3]);
    const detik = mLokal[4] ? Number(mLokal[4]) : 0;
    if (jam > 23 || menit > 59 || detik > 59) {
      return { ok: false, galat: `${label} memiliki jam yang tidak valid.` };
    }
    const dtkTeks = mLokal[4] ?? "00";
    const msTeks = (mLokal[5] ?? "000").padEnd(3, "0");
    const tgl = new Date(`${mLokal[1]}T${mLokal[2]}:${mLokal[3]}:${dtkTeks}.${msTeks}${OFFSET_WIB}`);
    if (Number.isNaN(tgl.getTime())) {
      return { ok: false, galat: `${label} tidak valid.` };
    }
    return { ok: true, data: tgl };
  }

  // 3. Format ISO 8601 lengkap dengan Z atau offset ±HH:MM
  const mIso =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      s
    );
  if (mIso) {
    if (!uraiTanggalKalender(mIso[1])) {
      return { ok: false, galat: `${label} bukan tanggal kalender yang valid.` };
    }
    const jam = Number(mIso[2]);
    const menit = Number(mIso[3]);
    const detik = mIso[4] ? Number(mIso[4]) : 0;
    if (jam > 23 || menit > 59 || detik > 59) {
      return { ok: false, galat: `${label} memiliki jam yang tidak valid.` };
    }
    const tgl = new Date(s);
    if (Number.isNaN(tgl.getTime())) {
      return { ok: false, galat: `${label} tidak valid.` };
    }
    return { ok: true, data: tgl };
  }

  return { ok: false, galat: `${label} harus berformat ISO atau YYYY-MM-DD.` };
}

/**
 * Validasi body `POST /api/pelanggan/cek` (nomor WA dikirim di body JSON, bukan di URL).
 */
export function validasiCekPelanggan(
  body: unknown
): HasilValidasi<{ nomor_wa: string }> {
  if (!objekBiasa(body)) {
    return { ok: false, galat: "Isi permintaan tidak valid." };
  }
  const asing = kunciAsing(body, ["nomor_wa"]);
  if (asing) {
    return { ok: false, galat: `Field tidak dikenal: ${asing}.`, field: asing };
  }
  const wa = normalisasiNomorWa(body.nomor_wa);
  if (!wa.ok) return { ok: false, galat: wa.galat, field: "nomor_wa" };
  return { ok: true, data: { nomor_wa: wa.nomor } };
}

/**
 * Validasi body `POST /api/tiket`.
 * Catatan penting (PRD FR-61 & syarat Zero Trust): field `harga`, `harga_saat_transaksi`,
 * `subtotal`, dan `total` yang mungkin dikirim klien SENGAJA diabaikan tanpa dipakai;
 * server selalu mengambil harga dari tabel `services` aktif di database.
 */
export function validasiBuatTiket(
  body: unknown,
  sekarang: Date = new Date()
): HasilValidasi<InputBuatTiket> {
  if (!objekBiasa(body)) {
    return { ok: false, galat: "Isi permintaan tidak valid." };
  }

  const diizinkanRoot = [
    "idempotency_key",
    "nama_pelanggan",
    "nomor_wa",
    "konfirmasi_ubah_nama",
    "jangan_kirim_notifikasi_wa",
    "items",
    "tanggal_masuk",
    "estimasi_selesai",
    "status_bayar",
    "metode_bayar",
    // Diabaikan secara eksplisit bila klien mengirim nilai palsu:
    "total",
    "harga",
  ];
  const asingRoot = kunciAsing(body, diizinkanRoot);
  if (asingRoot) {
    return { ok: false, galat: `Field tidak dikenal: ${asingRoot}.`, field: asingRoot };
  }

  // 0. Kunci Idempotensi (opsional, maks 100 karakter alfanumerik + strip/garis bawah)
  let idempotencyKey: string | null = null;
  if (body.idempotency_key !== undefined && body.idempotency_key !== null) {
    if (typeof body.idempotency_key !== "string") {
      return {
        ok: false,
        galat: "Idempotency key harus berupa teks.",
        field: "idempotency_key",
      };
    }
    const ik = body.idempotency_key.trim();
    if (ik.length === 0 || ik.length > 100 || !/^[A-Za-z0-9_-]+$/.test(ik)) {
      return {
        ok: false,
        galat: "Idempotency key harus berupa teks alfanumerik (maksimal 100 karakter).",
        field: "idempotency_key",
      };
    }
    idempotencyKey = ik;
  }

  // 1. Nama pelanggan
  if (typeof body.nama_pelanggan !== "string") {
    return { ok: false, galat: "Nama pelanggan wajib diisi.", field: "nama_pelanggan" };
  }
  if (mengandungKarakterTerlarang(body.nama_pelanggan)) {
    return {
      ok: false,
      galat: "Nama pelanggan tidak boleh mengandung karakter kontrol, baris baru, tab, karakter lebar-nol, atau pembalik arah teks.",
      field: "nama_pelanggan",
    };
  }
  const namaPelanggan = body.nama_pelanggan.trim();
  if (namaPelanggan.length === 0) {
    return { ok: false, galat: "Nama pelanggan wajib diisi.", field: "nama_pelanggan" };
  }
  if (namaPelanggan.length > MAKS_NAMA_PELANGGAN) {
    return {
      ok: false,
      galat: `Nama pelanggan maksimal ${MAKS_NAMA_PELANGGAN} karakter.`,
      field: "nama_pelanggan",
    };
  }

  // 2. Nomor WhatsApp
  const wa = normalisasiNomorWa(body.nomor_wa);
  if (!wa.ok) return { ok: false, galat: wa.galat, field: "nomor_wa" };

  // 3. Konfirmasi ubah nama pelanggan lama (opsional)
  if (
    body.konfirmasi_ubah_nama !== undefined &&
    typeof body.konfirmasi_ubah_nama !== "boolean"
  ) {
    return {
      ok: false,
      galat: "Konfirmasi ubah nama harus berupa boolean.",
      field: "konfirmasi_ubah_nama",
    };
  }
  const konfirmasiUbahNama = body.konfirmasi_ubah_nama ?? false;

  // 3b. Jangan kirim notifikasi WhatsApp (opsional, FR-24 / FR-25)
  if (
    body.jangan_kirim_notifikasi_wa !== undefined &&
    typeof body.jangan_kirim_notifikasi_wa !== "boolean"
  ) {
    return {
      ok: false,
      galat: "Pilihan kirim notifikasi WhatsApp harus berupa boolean.",
      field: "jangan_kirim_notifikasi_wa",
    };
  }
  const janganKirimNotifikasiWa = Boolean(body.jangan_kirim_notifikasi_wa);

  // 4. Daftar barang / layanan (1..20 item)
  if (!Array.isArray(body.items)) {
    return { ok: false, galat: "Daftar barang wajib berupa array.", field: "items" };
  }
  if (body.items.length === 0) {
    return { ok: false, galat: "Tiket wajib memiliki minimal 1 barang.", field: "items" };
  }
  if (body.items.length > MAKS_ITEM_PER_TIKET) {
    return {
      ok: false,
      galat: `Maksimal ${MAKS_ITEM_PER_TIKET} barang per tiket.`,
      field: "items",
    };
  }

  const diizinkanItem = [
    "service_id",
    "deskripsi_barang",
    "jumlah",
    // Diabaikan secara eksplisit bila klien mengirim harga/subtotal palsu:
    "harga",
    "harga_saat_transaksi",
    "subtotal",
  ];
  const items: InputItemTiket[] = [];

  for (let i = 0; i < body.items.length; i++) {
    const raw = body.items[i];
    const nomorBaris = i + 1;
    if (!objekBiasa(raw)) {
      return { ok: false, galat: `Barang ke-${nomorBaris} tidak valid.`, field: `items.${i}` };
    }
    const asingItem = kunciAsing(raw, diizinkanItem);
    if (asingItem) {
      return {
        ok: false,
        galat: `Field tidak dikenal pada barang ke-${nomorBaris}: ${asingItem}.`,
        field: `items.${i}`,
      };
    }

    if (
      typeof raw.service_id !== "number" ||
      !Number.isInteger(raw.service_id) ||
      raw.service_id < 1 ||
      raw.service_id > BATAS_ID_INT
    ) {
      return {
        ok: false,
        galat: `Layanan pada barang ke-${nomorBaris} harus berupa ID bilangan bulat positif (angka, bukan teks).`,
        field: `items.${i}.service_id`,
      };
    }

    if (typeof raw.deskripsi_barang !== "string") {
      return {
        ok: false,
        galat: `Deskripsi barang ke-${nomorBaris} wajib diisi.`,
        field: `items.${i}.deskripsi_barang`,
      };
    }
    if (mengandungKarakterTerlarang(raw.deskripsi_barang)) {
      return {
        ok: false,
        galat: `Deskripsi barang ke-${nomorBaris} tidak boleh mengandung karakter kontrol, baris baru, tab, karakter lebar-nol, atau pembalik arah teks.`,
        field: `items.${i}.deskripsi_barang`,
      };
    }
    const deskripsi = raw.deskripsi_barang.trim();
    if (deskripsi.length === 0) {
      return {
        ok: false,
        galat: `Deskripsi barang ke-${nomorBaris} wajib diisi.`,
        field: `items.${i}.deskripsi_barang`,
      };
    }
    if (deskripsi.length > MAKS_DESKRIPSI_BARANG) {
      return {
        ok: false,
        galat: `Deskripsi barang ke-${nomorBaris} maksimal ${MAKS_DESKRIPSI_BARANG} karakter.`,
        field: `items.${i}.deskripsi_barang`,
      };
    }

    if (typeof raw.jumlah !== "number" || !Number.isInteger(raw.jumlah)) {
      return {
        ok: false,
        galat: `Jumlah pasang pada barang ke-${nomorBaris} harus berupa bilangan bulat (angka, bukan teks).`,
        field: `items.${i}.jumlah`,
      };
    }
    if (raw.jumlah < MIN_JUMLAH_PASANG || raw.jumlah > MAKS_JUMLAH_PASANG) {
      return {
        ok: false,
        galat: `Jumlah pasang pada barang ke-${nomorBaris} harus antara ${MIN_JUMLAH_PASANG} sampai ${MAKS_JUMLAH_PASANG}.`,
        field: `items.${i}.jumlah`,
      };
    }

    items.push({
      service_id: raw.service_id,
      deskripsi_barang: deskripsi,
      jumlah: raw.jumlah,
    });
  }

  // 5. Jadwal: tanggal_masuk (default sekarang, tidak boleh di masa depan > 5 menit, tidak boleh > 30 hari ke belakang)
  let tanggalMasuk = sekarang;
  let tanggalMasukDiisi = false;
  if (body.tanggal_masuk !== undefined && body.tanggal_masuk !== null) {
    tanggalMasukDiisi = true;
    const uMasuk = uraiWaktuInput(body.tanggal_masuk, "Tanggal masuk", false);
    if (!uMasuk.ok) return { ok: false, galat: uMasuk.galat, field: "tanggal_masuk" };
    const batasMasaDepan =
      sekarang.getTime() + TOLERANSI_TANGGAL_MASUK_MENIT * 60 * 1000;
    if (uMasuk.data.getTime() > batasMasaDepan) {
      return {
        ok: false,
        galat: "Tanggal masuk tidak boleh di masa depan.",
        field: "tanggal_masuk",
      };
    }
    const batasMasaLampau =
      sekarang.getTime() - MAKS_HARI_MASUK_LAMPAU * 24 * 60 * 60 * 1000;
    if (uMasuk.data.getTime() < batasMasaLampau) {
      return {
        ok: false,
        galat: `Tanggal masuk maksimal ${MAKS_HARI_MASUK_LAMPAU} hari ke belakang.`,
        field: "tanggal_masuk",
      };
    }
    tanggalMasuk = uMasuk.data;
  }

  // 6. Jadwal: estimasi_selesai (opsional; bila diisi harus >= tanggal_masuk dan <= tanggal_masuk + 365 hari)
  let estimasiSelesai: Date | null = null;
  if (body.estimasi_selesai !== undefined && body.estimasi_selesai !== null) {
    const uEst = uraiWaktuInput(body.estimasi_selesai, "Estimasi selesai", true);
    if (!uEst.ok) return { ok: false, galat: uEst.galat, field: "estimasi_selesai" };
    if (uEst.data.getTime() < tanggalMasuk.getTime()) {
      return {
        ok: false,
        galat: "Estimasi selesai tidak boleh sebelum tanggal masuk.",
        field: "estimasi_selesai",
      };
    }
    const batasEstimasi =
      tanggalMasuk.getTime() + MAKS_HARI_ESTIMASI_SELESAI * 24 * 60 * 60 * 1000;
    if (uEst.data.getTime() > batasEstimasi) {
      return {
        ok: false,
        galat: `Estimasi selesai maksimal ${MAKS_HARI_ESTIMASI_SELESAI} hari setelah tanggal masuk.`,
        field: "estimasi_selesai",
      };
    }
    estimasiSelesai = uEst.data;
  }

  // 7. Status pembayaran & metode pembayaran
  if (
    typeof body.status_bayar !== "string" ||
    !(STATUS_BAYAR as readonly string[]).includes(body.status_bayar)
  ) {
    return {
      ok: false,
      galat: "Status pembayaran harus 'Belum bayar' atau 'Lunas'.",
      field: "status_bayar",
    };
  }
  const statusBayar = body.status_bayar as StatusBayar;

  let metodeBayar: MetodeBayar | null = null;
  if (statusBayar === "Lunas") {
    if (
      typeof body.metode_bayar !== "string" ||
      !(METODE_BAYAR as readonly string[]).includes(body.metode_bayar)
    ) {
      return {
        ok: false,
        galat: "Metode pembayaran wajib dipilih ('Cash' atau 'Non-cash') saat status Lunas.",
        field: "metode_bayar",
      };
    }
    metodeBayar = body.metode_bayar as MetodeBayar;
  } else {
    if (body.metode_bayar !== undefined && body.metode_bayar !== null) {
      return {
        ok: false,
        galat: "Metode pembayaran harus kosong saat status Belum bayar.",
        field: "metode_bayar",
      };
    }
  }

  return {
    ok: true,
    data: {
      idempotency_key: idempotencyKey,
      nama_pelanggan: namaPelanggan,
      nomor_wa: wa.nomor,
      konfirmasi_ubah_nama: konfirmasiUbahNama,
      items,
      tanggal_masuk: tanggalMasuk,
      tanggal_masuk_diisi: tanggalMasukDiisi,
      estimasi_selesai: estimasiSelesai,
      status_bayar: statusBayar,
      metode_bayar: metodeBayar,
      jangan_kirim_notifikasi_wa: janganKirimNotifikasiWa,
    },
  };
}

const PARAMETER_DAFTAR_DIIZINKAN = new Set([
  "periode",
  "dari",
  "sampai",
  "belum_bayar",
  "belum_diambil",
  "cari",
  "halaman",
  "ukuran",
]);

/**
 * Validasi seluruh parameter query `GET /api/tiket` dan halaman `/tiket`.
 * Semua parameter query dianggap input pengguna tidak tepercaya.
 */
export function validasiQueryDaftarTiket(
  searchParams: URLSearchParams,
  sekarang: Date = new Date()
): HasilValidasi<FilterDaftarTiket> {
  for (const k of searchParams.keys()) {
    if (!PARAMETER_DAFTAR_DIIZINKAN.has(k)) {
      return { ok: false, galat: `Parameter query tidak dikenal: ${k}.` };
    }
    if (searchParams.getAll(k).length > 1) {
      return { ok: false, galat: `Parameter ${k} tidak boleh dikirim berulang.` };
    }
  }

  const periodeRaw = searchParams.get("periode");
  const dariRaw = searchParams.get("dari");
  const sampaiRaw = searchParams.get("sampai");

  let periode: PeriodeFilterTiket;
  if (periodeRaw === null) {
    periode = dariRaw !== null || sampaiRaw !== null ? "rentang" : "semua";
  } else {
    if (!(PERIODE_FILTER_TIKET as readonly string[]).includes(periodeRaw)) {
      return { ok: false, galat: "Parameter periode tidak valid." };
    }
    periode = periodeRaw as PeriodeFilterTiket;
    if (periode !== "rentang" && (dariRaw !== null || sampaiRaw !== null)) {
      return {
        ok: false,
        galat: "Parameter dari dan sampai hanya boleh dipakai saat periode=rentang.",
      };
    }
  }

  let dari: string | null = null;
  let sampai: string | null = null;
  let batasMulai: Date | null = null;
  let batasAkhirEksklusif: Date | null = null;

  const hariIni = tanggalHariIniWib(sekarang);

  if (periode === "hari_ini") {
    batasMulai = batasAwalHariWib(hariIni);
    batasAkhirEksklusif = batasAwalHariWib(geserHariKalender(hariIni, 1));
  } else if (periode === "kemarin") {
    const kemarin = geserHariKalender(hariIni, -1);
    batasMulai = batasAwalHariWib(kemarin);
    batasAkhirEksklusif = batasAwalHariWib(hariIni);
  } else if (periode === "7_hari") {
    const awal = geserHariKalender(hariIni, -6);
    batasMulai = batasAwalHariWib(awal);
    batasAkhirEksklusif = batasAwalHariWib(geserHariKalender(hariIni, 1));
  } else if (periode === "rentang") {
    if (!dariRaw || !sampaiRaw) {
      return {
        ok: false,
        galat: "Tanggal awal (dari) dan tanggal akhir (sampai) wajib diisi dengan format YYYY-MM-DD.",
      };
    }
    const dKal = uraiTanggalKalender(dariRaw);
    const sKal = uraiTanggalKalender(sampaiRaw);
    if (!dKal || !sKal) {
      return {
        ok: false,
        galat: "Format tanggal harus YYYY-MM-DD yang valid.",
      };
    }
    const dMs = Date.UTC(dKal.tahun, dKal.bulan - 1, dKal.hari);
    const sMs = Date.UTC(sKal.tahun, sKal.bulan - 1, sKal.hari);
    if (dMs > sMs) {
      return {
        ok: false,
        galat: "Tanggal awal tidak boleh melebihi tanggal akhir.",
      };
    }
    const selisihHari = Math.round((sMs - dMs) / MS_PER_HARI);
    if (selisihHari > MAKS_RENTANG_HARI_FILTER) {
      return {
        ok: false,
        galat: `Rentang tanggal maksimal ${MAKS_RENTANG_HARI_FILTER} hari.`,
      };
    }
    dari = dariRaw;
    sampai = sampaiRaw;
    batasMulai = batasAwalHariWib(dariRaw);
    batasAkhirEksklusif = batasAwalHariWib(geserHariKalender(sampaiRaw, 1));
  }

  // Filter / prioritas Belum bayar di atas
  const belumBayarRaw = searchParams.get("belum_bayar");
  let belumBayarDiAtas = false;
  if (belumBayarRaw !== null) {
    if (belumBayarRaw === "true" || belumBayarRaw === "1") {
      belumBayarDiAtas = true;
    } else if (belumBayarRaw === "false" || belumBayarRaw === "0") {
      belumBayarDiAtas = false;
    } else {
      return {
        ok: false,
        galat: "Parameter belum_bayar harus bernilai true, false, 1, atau 0.",
      };
    }
  }

  // Filter tiket lama belum diambil (FR-17: Siap diambil >= MIN_HARI_BELUM_DIAMBIL hari)
  const belumDiambilRaw = searchParams.get("belum_diambil");
  let belumDiambilLama = false;
  if (belumDiambilRaw !== null) {
    if (belumDiambilRaw === "true" || belumDiambilRaw === "1") {
      belumDiambilLama = true;
    } else if (belumDiambilRaw === "false" || belumDiambilRaw === "0") {
      belumDiambilLama = false;
    } else {
      return {
        ok: false,
        galat: "Parameter belum_diambil harus bernilai true, false, 1, atau 0.",
      };
    }
  }

  // Halaman
  let halaman = 1;
  const halamanRaw = searchParams.get("halaman");
  if (halamanRaw !== null) {
    if (!/^[1-9]\d*$/.test(halamanRaw)) {
      return { ok: false, galat: "Nomor halaman harus berupa bilangan bulat positif." };
    }
    const n = Number(halamanRaw);
    if (n < 1 || n > MAKS_HALAMAN) {
      return {
        ok: false,
        galat: `Nomor halaman harus antara 1 sampai ${MAKS_HALAMAN}.`,
      };
    }
    halaman = n;
  }

  // Ukuran halaman
  let ukuran = UKURAN_HALAMAN_DEFAULT;
  const ukuranRaw = searchParams.get("ukuran");
  if (ukuranRaw !== null) {
    if (!/^[1-9]\d*$/.test(ukuranRaw)) {
      return { ok: false, galat: "Ukuran halaman harus berupa bilangan bulat positif." };
    }
    const n = Number(ukuranRaw);
    if (n < 1 || n > MAKS_UKURAN_HALAMAN) {
      return {
        ok: false,
        galat: `Ukuran halaman maksimal ${MAKS_UKURAN_HALAMAN}.`,
      };
    }
    ukuran = n;
  }

  // Kata pencarian: hapus karakter null, trim, potong panjang maksimal 100 karakter
  const cariRaw = searchParams.get("cari") ?? "";
  const cari = cariRaw.replace(/\0/g, "").trim().slice(0, MAKS_PANJANG_CARI);

  return {
    ok: true,
    data: {
      periode,
      dari,
      sampai,
      batas_mulai: batasMulai,
      batas_akhir_eksklusif: batasAkhirEksklusif,
      belum_bayar_di_atas: belumBayarDiAtas,
      belum_diambil_lama: belumDiambilLama,
      cari,
      halaman,
      ukuran,
    },
  };
}

function validasiAlasanTeks(
   mentah: unknown,
  namaField: "alasan" | "alasan_batal",
  label: string
): HasilValidasi<string> {
  if (typeof mentah !== "string") {
    return { ok: false, galat: `${label} wajib diisi.`, field: namaField };
  }
  if (mengandungKarakterTerlarang(mentah)) {
    return {
      ok: false,
      galat: `${label} tidak boleh mengandung karakter kontrol, baris baru, tab, karakter lebar-nol, atau pembalik arah teks.`,
      field: namaField,
    };
  }
  const bersih = mentah.trim();
  if (bersih.length === 0) {
    return { ok: false, galat: `${label} wajib diisi.`, field: namaField };
  }
  if (bersih.length > MAKS_ALASAN_TIKET) {
    return {
      ok: false,
      galat: `${label} maksimal ${MAKS_ALASAN_TIKET} karakter.`,
      field: namaField,
    };
  }
  return { ok: true, data: bersih };
}

/**
 * Validasi body `PATCH /api/tiket/[id]` (Phase 5B).
 * - Wajib menyertakan `jenis` ("status_pesanan" | "pembayaran" | "batalkan").
 * - Wajib menyertakan `status_sebelumnya` pada setiap permintaan mutasi (400 jika hilang/salah).
 * - Menolak seluruh field tak dikenal, termasuk `total` dan `tanggal_bayar` dari klien.
 */
export function validasiUbahTiket(body: unknown): HasilValidasi<InputUbahTiket> {
  if (!objekBiasa(body)) {
    return { ok: false, galat: "Isi permintaan tidak valid." };
  }

  for (const terlarang of ["total", "tanggal_bayar", "tanggal_masuk", "estimasi_selesai", "siap_diambil_pada"]) {
    if (terlarang in body) {
      return {
        ok: false,
        galat: `Server tidak menerima field '${terlarang}' dari klien.`,
        field: terlarang,
      };
    }
  }

  if (
    typeof body.jenis !== "string" ||
    !["status_pesanan", "pembayaran", "batalkan"].includes(body.jenis)
  ) {
    return {
      ok: false,
      galat: "Field 'jenis' wajib bernilai 'status_pesanan', 'pembayaran', atau 'batalkan'.",
      field: "jenis",
    };
  }

  if (body.jenis === "status_pesanan") {
    const asing = kunciAsing(body, [
      "jenis",
      "status_pesanan",
      "status_sebelumnya",
      "konfirmasi_belum_bayar",
    ]);
    if (asing) {
      return { ok: false, galat: `Field tidak dikenal: ${asing}.`, field: asing };
    }

    if (
      typeof body.status_sebelumnya !== "string" ||
      !(STATUS_PESANAN as readonly string[]).includes(body.status_sebelumnya)
    ) {
      return {
        ok: false,
        galat: "Field 'status_sebelumnya' wajib diisi dengan status pesanan yang valid.",
        field: "status_sebelumnya",
      };
    }

    if (
      typeof body.status_pesanan !== "string" ||
      !(STATUS_PESANAN as readonly string[]).includes(body.status_pesanan)
    ) {
      return {
        ok: false,
        galat: "Field 'status_pesanan' wajib diisi dengan status pesanan yang valid.",
        field: "status_pesanan",
      };
    }

    if (body.status_pesanan === "Dibatalkan") {
      return {
        ok: false,
        galat: "Untuk membatalkan tiket, gunakan jenis 'batalkan' disertai alasan_batal.",
        field: "status_pesanan",
      };
    }

    if (
      body.konfirmasi_belum_bayar !== undefined &&
      typeof body.konfirmasi_belum_bayar !== "boolean"
    ) {
      return {
        ok: false,
        galat: "Field 'konfirmasi_belum_bayar' harus berupa boolean.",
        field: "konfirmasi_belum_bayar",
      };
    }

    return {
      ok: true,
      data: {
        jenis: "status_pesanan",
        status_pesanan: body.status_pesanan as Exclude<StatusPesanan, "Dibatalkan">,
        status_sebelumnya: body.status_sebelumnya as StatusPesanan,
        konfirmasi_belum_bayar: body.konfirmasi_belum_bayar ?? false,
      },
    };
  }

  if (body.jenis === "pembayaran") {
    const asing = kunciAsing(body, [
      "jenis",
      "status_bayar",
      "status_sebelumnya",
      "metode_bayar",
      "alasan",
    ]);
    if (asing) {
      return { ok: false, galat: `Field tidak dikenal: ${asing}.`, field: asing };
    }

    if (
      typeof body.status_sebelumnya !== "string" ||
      !(STATUS_BAYAR as readonly string[]).includes(body.status_sebelumnya)
    ) {
      return {
        ok: false,
        galat: "Field 'status_sebelumnya' wajib diisi dengan status pembayaran yang valid.",
        field: "status_sebelumnya",
      };
    }

    if (
      typeof body.status_bayar !== "string" ||
      !(STATUS_BAYAR as readonly string[]).includes(body.status_bayar)
    ) {
      return {
        ok: false,
        galat: "Status pembayaran harus 'Belum bayar' atau 'Lunas'.",
        field: "status_bayar",
      };
    }

    const statusSebelumnya = body.status_sebelumnya as StatusBayar;
    const statusBayar = body.status_bayar as StatusBayar;

    if (statusBayar === "Lunas") {
      if (
        typeof body.metode_bayar !== "string" ||
        !(METODE_BAYAR as readonly string[]).includes(body.metode_bayar)
      ) {
        return {
          ok: false,
          galat: "Metode pembayaran wajib dipilih ('Cash' atau 'Non-cash') saat status Lunas.",
          field: "metode_bayar",
        };
      }
      if (body.alasan !== undefined && body.alasan !== null) {
        return {
          ok: false,
          galat: "Field 'alasan' hanya digunakan saat membalik status Lunas ke Belum bayar.",
          field: "alasan",
        };
      }
      return {
        ok: true,
        data: {
          jenis: "pembayaran",
          status_bayar: "Lunas",
          metode_bayar: body.metode_bayar as MetodeBayar,
          status_sebelumnya: statusSebelumnya,
          alasan: null,
        },
      };
    }

    // statusBayar === "Belum bayar"
    if (body.metode_bayar !== undefined && body.metode_bayar !== null) {
      return {
        ok: false,
        galat: "Metode pembayaran harus kosong saat status Belum bayar.",
        field: "metode_bayar",
      };
    }

    let alasanValid: string | null = null;
    if (body.alasan !== undefined && body.alasan !== null) {
      const cekAlasan = validasiAlasanTeks(
        body.alasan,
        "alasan",
        "Alasan pembalikan pembayaran"
      );
      if (!cekAlasan.ok) return cekAlasan;
      alasanValid = cekAlasan.data;
    } else if (statusSebelumnya === "Lunas") {
      return {
        ok: false,
        galat: "Alasan pembalikan pembayaran wajib diisi saat mengubah status Lunas ke Belum bayar.",
        field: "alasan",
      };
    }

    return {
      ok: true,
      data: {
        jenis: "pembayaran",
        status_bayar: "Belum bayar",
        metode_bayar: null,
        status_sebelumnya: statusSebelumnya,
        alasan: alasanValid,
      },
    };
  }

  // body.jenis === "batalkan"
  const asing = kunciAsing(body, [
    "jenis",
    "alasan_batal",
    "konfirmasi_sudah_lunas",
    "status_sebelumnya",
  ]);
  if (asing) {
    return { ok: false, galat: `Field tidak dikenal: ${asing}.`, field: asing };
  }

  if (
    typeof body.status_sebelumnya !== "string" ||
    !(STATUS_PESANAN as readonly string[]).includes(body.status_sebelumnya)
  ) {
    return {
      ok: false,
      galat: "Field 'status_sebelumnya' wajib diisi dengan status pesanan yang valid.",
      field: "status_sebelumnya",
    };
  }

  const cekAlasanBatal = validasiAlasanTeks(
    body.alasan_batal,
    "alasan_batal",
    "Alasan pembatalan"
  );
  if (!cekAlasanBatal.ok) return cekAlasanBatal;

  if (
    body.konfirmasi_sudah_lunas !== undefined &&
    typeof body.konfirmasi_sudah_lunas !== "boolean"
  ) {
    return {
      ok: false,
      galat: "Field 'konfirmasi_sudah_lunas' harus berupa boolean.",
      field: "konfirmasi_sudah_lunas",
    };
  }

  return {
    ok: true,
    data: {
      jenis: "batalkan",
      alasan_batal: cekAlasanBatal.data,
      konfirmasi_sudah_lunas: body.konfirmasi_sudah_lunas ?? false,
      status_sebelumnya: body.status_sebelumnya as StatusPesanan,
    },
  };
}
