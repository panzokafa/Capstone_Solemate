// Validasi input katalog layanan. Murni (tanpa database), dipakai route dan tes.
// Semua nilai dari browser dianggap tidak tepercaya; angka harus bertipe number (bukan teks).

export const BATAS_HARGA = 100_000_000;
export const BATAS_ESTIMASI_HARI = 365;
export const BATAS_NAMA = 100;
const BATAS_ID = 2_147_483_647; // batas kolom integer PostgreSQL

export type InputLayanan = { nama: string; harga: number; estimasi_hari: number };
export type InputTambah = InputLayanan & { aktif: boolean };

export type HasilValidasi<T> = { ok: true; data: T } | { ok: false; galat: string };

function objekBiasa(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function kunciAsing(body: Record<string, unknown>, diizinkan: string[]): string | null {
  return Object.keys(body).find((k) => !diizinkan.includes(k)) ?? null;
}

function cekNama(v: unknown): HasilValidasi<string> {
  if (typeof v !== "string") return { ok: false, galat: "Nama layanan wajib diisi." };
  const nama = v.trim();
  if (nama.length === 0) return { ok: false, galat: "Nama layanan wajib diisi." };
  if (nama.length > BATAS_NAMA) {
    return { ok: false, galat: `Nama layanan maksimal ${BATAS_NAMA} karakter.` };
  }
  return { ok: true, data: nama };
}

function cekAngka(v: unknown, label: string, maks: number): HasilValidasi<number> {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { ok: false, galat: `${label} harus berupa bilangan bulat (angka, bukan teks).` };
  }
  if (v < 0) return { ok: false, galat: `${label} tidak boleh negatif.` };
  if (v > maks) {
    return { ok: false, galat: `${label} maksimal ${maks.toLocaleString("id-ID")}.` };
  }
  return { ok: true, data: v };
}

function cekInti(body: unknown, diizinkan: string[]): HasilValidasi<InputLayanan> {
  if (!objekBiasa(body)) return { ok: false, galat: "Isi permintaan tidak valid." };
  const asing = kunciAsing(body, diizinkan);
  if (asing) return { ok: false, galat: `Field tidak dikenal: ${asing}.` };

  const nama = cekNama(body.nama);
  if (!nama.ok) return nama;
  const harga = cekAngka(body.harga, "Harga", BATAS_HARGA);
  if (!harga.ok) return harga;
  const hari = cekAngka(body.estimasi_hari, "Estimasi hari", BATAS_ESTIMASI_HARI);
  if (!hari.ok) return hari;

  return { ok: true, data: { nama: nama.data, harga: harga.data, estimasi_hari: hari.data } };
}

// POST: nama, harga, estimasi_hari wajib; aktif opsional (default true).
export function validasiTambah(body: unknown): HasilValidasi<InputTambah> {
  const inti = cekInti(body, ["nama", "harga", "estimasi_hari", "aktif"]);
  if (!inti.ok) return inti;
  const aktif = (body as Record<string, unknown>).aktif;
  if (aktif !== undefined && typeof aktif !== "boolean") {
    return { ok: false, galat: "Status aktif harus true atau false." };
  }
  return { ok: true, data: { ...inti.data, aktif: aktif ?? true } };
}

// PUT: nama, harga, estimasi_hari wajib semua. Status aktif diubah lewat PATCH.
export function validasiUbah(body: unknown): HasilValidasi<InputLayanan> {
  return cekInti(body, ["nama", "harga", "estimasi_hari"]);
}

// PATCH: target eksplisit { aktif: true|false } (idempoten, bukan "balik status").
export function validasiStatus(body: unknown): HasilValidasi<{ aktif: boolean }> {
  if (!objekBiasa(body)) return { ok: false, galat: "Isi permintaan tidak valid." };
  const asing = kunciAsing(body, ["aktif"]);
  if (asing) return { ok: false, galat: `Field tidak dikenal: ${asing}.` };
  if (typeof body.aktif !== "boolean") {
    return { ok: false, galat: "Status aktif harus true atau false." };
  }
  return { ok: true, data: { aktif: body.aktif } };
}

// ID dari URL: hanya digit, dalam rentang integer database.
export function validasiId(teks: string): number | null {
  if (!/^\d{1,10}$/.test(teks)) return null;
  const n = Number(teks);
  return n >= 1 && n <= BATAS_ID ? n : null;
}
