// Modul layanan Laporan Harian Operasional & Dashboard (Phase 7A, FR-30, FR-31, FR-32, FR-40 - FR-44).
// Seluruh kalkulasi waktu berakar pada jam database PostgreSQL zona Asia/Jakarta (+07:00).
// Tanpa parameter simulasi bug di kode produksi.

import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import { formatTanggal } from "./format.ts";
import {
  PERIODE_LAPORAN,
  type PeriodeLaporan,
  PERIODE_REKAP_BULANAN,
  type PeriodeRekapBulanan,
  FORMAT_EKSPOR_REKAP,
  type FormatEksporRekap,
  MAKS_RENTANG_HARI_LAPORAN,
  MAKS_LAYANAN_TERLARIS,
  JUMLAH_TIKET_TERBARU_DASHBOARD,
  TEKS_DISCLAIMER_LAPORAN,
  TEKS_CATATAN_PEMBULATAN_LAYANAN,
  TEKS_LABA_RUGI_BELUM_TERSEDIA,
  hitungPersentaseSatuDesimal,
  keNominalAman,
  keJumlahAman,
} from "../config/laporan.ts";

export type FilterLaporanHarian = {
  periode: PeriodeLaporan;
  dari: string; // YYYY-MM-DD
  sampai: string; // YYYY-MM-DD
};

export type HasilValidasiFilterLaporan =
  | { ok: true; data: FilterLaporanHarian }
  | { ok: false; kode: 400; galat: string };

export type FilterRekapBulanan = {
  periode: PeriodeRekapBulanan;
  dari: string; // YYYY-MM-DD
  sampai: string; // YYYY-MM-DD
};

export type HasilValidasiFilterRekap =
  | { ok: true; data: FilterRekapBulanan }
  | { ok: false; kode: 400; galat: string };

export type FilterEksporRekap = {
  format: FormatEksporRekap;
  filter: FilterRekapBulanan;
};

export type HasilValidasiEksporRekap =
  | { ok: true; data: FilterEksporRekap }
  | { ok: false; kode: 400; galat: string };

export type BarisLayananTerlaris = {
  peringkat: number | null;
  service_id: number | null;
  nama_layanan: string;
  aktif: boolean;
  jumlah_pasang: number;
  persentase_pasang: number;
  total_nominal: number;
  adalah_lainnya: boolean;
};

export type DataRekapBulanan = {
  periode: PeriodeRekapBulanan;
  rentang: {
    dari: string; // YYYY-MM-DD
    sampai: string; // YYYY-MM-DD
    hari_ini: string; // YYYY-MM-DD (jam database WIB)
  };
  disclaimer: string;
  pesanan_masuk: DataLaporanHarian["pesanan_masuk"];
  pembayaran_diterima: DataLaporanHarian["pembayaran_diterima"];
  layanan_terlaris: {
    total_pasang: number;
    total_nominal: number;
    jumlah_layanan_unik: number;
    daftar: BarisLayananTerlaris[];
    catatan_pembulatan: string;
  };
  laba_rugi: {
    tersedia: false;
    pesan: string;
  };
};

export type DataLaporanHarian = {
  periode: PeriodeLaporan;
  rentang: {
    dari: string; // YYYY-MM-DD
    sampai: string; // YYYY-MM-DD
    hari_ini: string; // YYYY-MM-DD (jam database WIB)
  };
  disclaimer: string;
  pesanan_masuk: {
    total_tiket: number;
    total_pasang: number;
    total_nominal: number;
    lunas: {
      total_tiket: number;
      total_pasang: number;
      total_nominal: number;
    };
    belum_bayar: {
      total_tiket: number;
      total_pasang: number;
      total_nominal: number;
    };
  };
  pembayaran_diterima: {
    total_tiket: number;
    total_nominal: number;
    cash: {
      total_tiket: number;
      total_nominal: number;
      label: string; // "Cash tercatat di sistem"
    };
    non_cash: {
      total_tiket: number;
      total_nominal: number;
    };
  };
  audit_aktivitas: {
    tiket_dibatalkan: number;
    tiket_batal_setelah_lunas: number; // Jumlah saja, tanpa nominal
    pembalikan_pembayaran: number; // Lunas -> Belum bayar
    catatan_asumsi: string;
  };
};

export type TitikTrenDashboard = {
  tanggal: string; // YYYY-MM-DD
  jumlah_pasang: number; // Menggunakan jumlah pasang per hari
};

export type TiketRingkasDashboard = {
  id: number;
  kode_tiket: string;
  nama_pelanggan: string;
  sumber: "wa" | "toko";
  jumlah_pasang: number;
  status_pesanan: string;
  status_bayar: string;
  total: number;
  tanggal_masuk: string;
};

export type DataDashboard = {
  hari_ini: string; // YYYY-MM-DD (jam database)
  peran: "owner" | "kasir";
  ringkasan_hari_ini: {
    pesanan_masuk: {
      total_tiket: number;
      total_pasang: number;
    };
    belum_bayar_aktif: {
      label: string; // "Belum bayar (semua tiket aktif)"
      total_tiket: number;
      total_pasang: number;
      total_nominal: number | null; // null untuk kasir, angka untuk owner
    };
  };
  tren_7_hari: TitikTrenDashboard[] | null; // null untuk kasir, 7 titik untuk owner
  tiket_terbaru: TiketRingkasDashboard[];
};

const PARAMETER_LAPORAN_DIIZINKAN = new Set(["periode", "dari", "sampai"]);
const PARAMETER_EKSPOR_REKAP_DIIZINKAN = new Set(["periode", "dari", "sampai", "format"]);

function uraiTanggalKalender(teks: string): { tahun: number; bulan: number; hari: number } | null {
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

function validasiPasanganRentangTanggal(
  dariRaw: string | null,
  sampaiRaw: string | null
): { ok: true; dari: string; sampai: string } | { ok: false; kode: 400; galat: string } {
  if (!dariRaw || !sampaiRaw) {
    return {
      ok: false,
      kode: 400,
      galat: "Tanggal awal (dari) dan tanggal akhir (sampai) wajib diisi untuk periode rentang.",
    };
  }
  const dKal = uraiTanggalKalender(dariRaw);
  const sKal = uraiTanggalKalender(sampaiRaw);
  if (!dKal || !sKal) {
    return {
      ok: false,
      kode: 400,
      galat: "Format tanggal harus YYYY-MM-DD yang valid.",
    };
  }
  const dMs = Date.UTC(dKal.tahun, dKal.bulan - 1, dKal.hari);
  const sMs = Date.UTC(sKal.tahun, sKal.bulan - 1, sKal.hari);
  if (dMs > sMs) {
    return {
      ok: false,
      kode: 400,
      galat: "Tanggal awal tidak boleh melebihi tanggal akhir.",
    };
  }
  const selisihHari = Math.round((sMs - dMs) / (24 * 60 * 60 * 1000));
  if (selisihHari > MAKS_RENTANG_HARI_LAPORAN) {
    return {
      ok: false,
      kode: 400,
      galat: `Rentang tanggal maksimal ${MAKS_RENTANG_HARI_LAPORAN} hari.`,
    };
  }
  return { ok: true, dari: dariRaw, sampai: sampaiRaw };
}

function cekKunciParameterLaporan(
  searchParams: URLSearchParams,
  diizinkan: ReadonlySet<string> = PARAMETER_LAPORAN_DIIZINKAN
): { ok: true } | { ok: false; kode: 400; galat: string } {
  for (const k of searchParams.keys()) {
    if (!diizinkan.has(k)) {
      return { ok: false, kode: 400, galat: `Parameter query tidak dikenal: ${k}.` };
    }
    if (searchParams.getAll(k).length > 1) {
      return { ok: false, kode: 400, galat: `Parameter ${k} tidak boleh dikirim berulang.` };
    }
  }
  return { ok: true };
}

/**
 * Validasi parameter query untuk Laporan Harian Operasional.
 * Menganggap seluruh parameter dari URL sebagai input pengguna tidak tepercaya.
 */
export function validasiQueryLaporanHarian(
  searchParams: URLSearchParams
): HasilValidasiFilterLaporan {
  const cekKunci = cekKunciParameterLaporan(searchParams);
  if (!cekKunci.ok) return cekKunci;

  const periodeRaw = searchParams.get("periode");
  const dariRaw = searchParams.get("dari");
  const sampaiRaw = searchParams.get("sampai");

  let periode: PeriodeLaporan = "hari_ini";
  if (periodeRaw !== null) {
    if (!(PERIODE_LAPORAN as readonly string[]).includes(periodeRaw)) {
      return { ok: false, kode: 400, galat: "Parameter periode tidak valid." };
    }
    periode = periodeRaw as PeriodeLaporan;
  }

  if (periode !== "rentang" && (dariRaw !== null || sampaiRaw !== null)) {
    return {
      ok: false,
      kode: 400,
      galat: "Parameter dari dan sampai hanya boleh dipakai saat periode=rentang.",
    };
  }

  let dari = "";
  let sampai = "";

  if (periode === "rentang") {
    const r = validasiPasanganRentangTanggal(dariRaw, sampaiRaw);
    if (!r.ok) return r;
    dari = r.dari;
    sampai = r.sampai;
  }

  return {
    ok: true,
    data: {
      periode,
      dari,
      sampai,
    },
  };
}

function validasiBagianPeriodeRekap(searchParams: URLSearchParams): HasilValidasiFilterRekap {
  const periodeRaw = searchParams.get("periode");
  const dariRaw = searchParams.get("dari");
  const sampaiRaw = searchParams.get("sampai");

  let periode: PeriodeRekapBulanan = "bulan_ini";
  if (periodeRaw !== null) {
    if (!(PERIODE_REKAP_BULANAN as readonly string[]).includes(periodeRaw)) {
      return { ok: false, kode: 400, galat: "Parameter periode tidak valid." };
    }
    periode = periodeRaw as PeriodeRekapBulanan;
  } else if (dariRaw !== null || sampaiRaw !== null) {
    periode = "rentang";
  }

  if (periode !== "rentang" && (dariRaw !== null || sampaiRaw !== null)) {
    return {
      ok: false,
      kode: 400,
      galat: "Parameter dari dan sampai hanya boleh dipakai saat periode=rentang.",
    };
  }

  let dari = "";
  let sampai = "";

  if (periode === "rentang") {
    const r = validasiPasanganRentangTanggal(dariRaw, sampaiRaw);
    if (!r.ok) return r;
    dari = r.dari;
    sampai = r.sampai;
  }

  return {
    ok: true,
    data: {
      periode,
      dari,
      sampai,
    },
  };
}

/**
 * Validasi parameter query untuk Rekap Bulanan (FR-50).
 * Mendukung ?periode=bulan_ini | ?periode=bulan_lalu | ?periode=rentang&dari=...&sampai=...
 * atau langsung ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD.
 */
export function validasiQueryRekapBulanan(
  searchParams: URLSearchParams
): HasilValidasiFilterRekap {
  const cekKunci = cekKunciParameterLaporan(searchParams);
  if (!cekKunci.ok) return cekKunci;
  return validasiBagianPeriodeRekap(searchParams);
}

/**
 * Validasi parameter query untuk Ekspor Rekap Bulanan (FR-53).
 * Wajib menyertakan ?format=xlsx atau ?format=pdf; menolak parameter asing/duplikat.
 */
export function validasiQueryEksporRekap(
  searchParams: URLSearchParams
): HasilValidasiEksporRekap {
  const cekKunci = cekKunciParameterLaporan(searchParams, PARAMETER_EKSPOR_REKAP_DIIZINKAN);
  if (!cekKunci.ok) return cekKunci;

  const formatRaw = searchParams.get("format");
  if (!formatRaw || !(FORMAT_EKSPOR_REKAP as readonly string[]).includes(formatRaw)) {
    return {
      ok: false,
      kode: 400,
      galat: "Parameter format ekspor wajib diisi dengan xlsx atau pdf.",
    };
  }

  const hasilPeriode = validasiBagianPeriodeRekap(searchParams);
  if (!hasilPeriode.ok) return hasilPeriode;

  return {
    ok: true,
    data: {
      format: formatRaw as FormatEksporRekap,
      filter: hasilPeriode.data,
    },
  };
}

type WaktuAcuanWib = {
  hari_ini: string;
  kemarin: string;
  bulan_ini_awal: string;
  bulan_ini_akhir: string;
  bulan_lalu_awal: string;
  bulan_lalu_akhir: string;
};

async function ambilWaktuAcuanWib(
  pool: Pool | PoolClient,
  tanggalAcuanWib?: string
): Promise<WaktuAcuanWib> {
  if (tanggalAcuanWib !== undefined) {
    if (!uraiTanggalKalender(tanggalAcuanWib)) {
      throw new Error(`Tanggal acuan WIB tidak valid: ${tanggalAcuanWib}`);
    }
  }
  const res = await pool.query(
    `WITH acuan AS (
       SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Jakarta')::date) AS tgl
     )
     SELECT
       tgl::text AS hari_ini,
       (tgl - 1)::text AS kemarin,
       date_trunc('month', tgl)::date::text AS bulan_ini_awal,
       tgl::text AS bulan_ini_akhir,
       (date_trunc('month', tgl) - interval '1 month')::date::text AS bulan_lalu_awal,
       (date_trunc('month', tgl) - interval '1 day')::date::text AS bulan_lalu_akhir
     FROM acuan`,
    [tanggalAcuanWib ?? null]
  );
  return res.rows[0];
}

async function hitungBatasWaktuWib(
  pool: Pool | PoolClient,
  dariTgl: string,
  sampaiTgl: string
): Promise<{ batas_mulai: unknown; batas_akhir_eksklusif: unknown }> {
  const batasRes = await pool.query(
    `SELECT
       ($1 || ' 00:00:00+07')::timestamptz AS batas_mulai,
       (($2::date + 1)::text || ' 00:00:00+07')::timestamptz AS batas_akhir_eksklusif`,
    [dariTgl, sampaiTgl]
  );
  return batasRes.rows[0];
}

/**
 * Query bersama ringkasan pesanan masuk (kohort tanggal_masuk) — dipakai Laporan Harian & Rekap Bulanan.
 */
async function queryRingkasanPesananMasuk(
  pool: Pool | PoolClient,
  batasMulai: unknown,
  batasAkhirEksklusif: unknown
): Promise<DataLaporanHarian["pesanan_masuk"]> {
  const pesananMasukRes = await pool.query(
    `WITH item_agg AS (
       SELECT
         order_id,
         SUM(jumlah)::bigint AS total_pasang,
         SUM(jumlah * harga_saat_transaksi)::bigint AS total_nominal
       FROM order_items
       GROUP BY order_id
     )
     SELECT
       COUNT(*)::bigint AS total_tiket_masuk,
       COALESCE(SUM(ia.total_pasang), 0)::bigint AS total_pasang_masuk,
       COALESCE(SUM(ia.total_nominal), 0)::bigint AS total_nominal_masuk,
       -- Dari pesanan masuk: Sudah Lunas
       COUNT(*) FILTER (WHERE o.status_bayar = 'Lunas')::bigint AS tiket_lunas,
       COALESCE(SUM(ia.total_pasang) FILTER (WHERE o.status_bayar = 'Lunas'), 0)::bigint AS pasang_lunas,
       COALESCE(SUM(ia.total_nominal) FILTER (WHERE o.status_bayar = 'Lunas'), 0)::bigint AS nominal_lunas,
       -- Dari pesanan masuk: Belum bayar (utang)
       COUNT(*) FILTER (WHERE o.status_bayar = 'Belum bayar')::bigint AS tiket_belum_bayar,
       COALESCE(SUM(ia.total_pasang) FILTER (WHERE o.status_bayar = 'Belum bayar'), 0)::bigint AS pasang_belum_bayar,
       COALESCE(SUM(ia.total_nominal) FILTER (WHERE o.status_bayar = 'Belum bayar'), 0)::bigint AS nominal_belum_bayar
     FROM orders o
     JOIN item_agg ia ON ia.order_id = o.id
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_masuk >= $1
       AND o.tanggal_masuk < $2`,
    [batasMulai, batasAkhirEksklusif]
  );

  const pm = pesananMasukRes.rows[0] ?? {};
  return {
    total_tiket: keJumlahAman(pm.total_tiket_masuk),
    total_pasang: keJumlahAman(pm.total_pasang_masuk),
    total_nominal: keNominalAman(pm.total_nominal_masuk),
    lunas: {
      total_tiket: keJumlahAman(pm.tiket_lunas),
      total_pasang: keJumlahAman(pm.pasang_lunas),
      total_nominal: keNominalAman(pm.nominal_lunas),
    },
    belum_bayar: {
      total_tiket: keJumlahAman(pm.tiket_belum_bayar),
      total_pasang: keJumlahAman(pm.pasang_belum_bayar),
      total_nominal: keNominalAman(pm.nominal_belum_bayar),
    },
  };
}

/**
 * Query bersama ringkasan pembayaran diterima (kohort tanggal_bayar) — dipakai Laporan Harian & Rekap Bulanan.
 */
async function queryRingkasanPembayaranDiterima(
  pool: Pool | PoolClient,
  batasMulai: unknown,
  batasAkhirEksklusif: unknown
): Promise<DataLaporanHarian["pembayaran_diterima"]> {
  const pembayaranDiterimaRes = await pool.query(
    `WITH item_agg AS (
       SELECT
         order_id,
         SUM(jumlah * harga_saat_transaksi)::bigint AS total_nominal
       FROM order_items
       GROUP BY order_id
     )
     SELECT
       COUNT(*)::bigint AS total_tiket_bayar,
       COALESCE(SUM(ia.total_nominal), 0)::bigint AS total_nominal_bayar,
       -- Cash ("Cash tercatat di sistem")
       COUNT(*) FILTER (WHERE o.metode_bayar = 'Cash')::bigint AS tiket_cash,
       COALESCE(SUM(ia.total_nominal) FILTER (WHERE o.metode_bayar = 'Cash'), 0)::bigint AS nominal_cash,
       -- Non-cash
       COUNT(*) FILTER (WHERE o.metode_bayar = 'Non-cash')::bigint AS tiket_non_cash,
       COALESCE(SUM(ia.total_nominal) FILTER (WHERE o.metode_bayar = 'Non-cash'), 0)::bigint AS nominal_non_cash
     FROM orders o
     JOIN item_agg ia ON ia.order_id = o.id
     WHERE o.status_bayar = 'Lunas'
       AND o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_bayar >= $1
       AND o.tanggal_bayar < $2`,
    [batasMulai, batasAkhirEksklusif]
  );

  const pb = pembayaranDiterimaRes.rows[0] ?? {};
  return {
    total_tiket: keJumlahAman(pb.total_tiket_bayar),
    total_nominal: keNominalAman(pb.total_nominal_bayar),
    cash: {
      total_tiket: keJumlahAman(pb.tiket_cash),
      total_nominal: keNominalAman(pb.nominal_cash),
      label: "Cash tercatat di sistem",
    },
    non_cash: {
      total_tiket: keJumlahAman(pb.tiket_non_cash),
      total_nominal: keNominalAman(pb.nominal_non_cash),
    },
  };
}

/**
 * Menghitung rentang tanggal pintasan Rekap Bulanan ('bulan_ini' atau 'bulan_lalu')
 * berdasarkan jam database PostgreSQL zona Asia/Jakarta atau tanggal acuan opsional (parameter fungsi).
 */
export async function hitungRentangPintasanRekap(
  periode: "bulan_ini" | "bulan_lalu",
  poolClient?: Pool | PoolClient,
  tanggalAcuanWib?: string
): Promise<{ dari: string; sampai: string; hari_ini: string }> {
  const pool = poolClient ?? getPool();
  const waktu = await ambilWaktuAcuanWib(pool, tanggalAcuanWib);
  if (periode === "bulan_ini") {
    return {
      dari: waktu.bulan_ini_awal,
      sampai: waktu.bulan_ini_akhir,
      hari_ini: waktu.hari_ini,
    };
  }
  return {
    dari: waktu.bulan_lalu_awal,
    sampai: waktu.bulan_lalu_akhir,
    hari_ini: waktu.hari_ini,
  };
}

/**
 * Menghitung Laporan Harian Operasional dari database.
 * Jam acuan hari ini, kemarin, dan batas waktu murni dari database PostgreSQL zona Asia/Jakarta.
 */
export async function ambilLaporanHarian(
  filter: FilterLaporanHarian,
  poolClient?: Pool | PoolClient
): Promise<DataLaporanHarian> {
  const pool = poolClient ?? getPool();

  // 1. Tentukan tanggal acuan dan batas periode dari jam database (Asia/Jakarta)
  const waktu = await ambilWaktuAcuanWib(pool);

  let dariTgl = filter.dari;
  let sampaiTgl = filter.sampai;

  if (filter.periode === "hari_ini") {
    dariTgl = waktu.hari_ini;
    sampaiTgl = waktu.hari_ini;
  } else if (filter.periode === "kemarin") {
    dariTgl = waktu.kemarin;
    sampaiTgl = waktu.kemarin;
  }

  const { batas_mulai, batas_akhir_eksklusif } = await hitungBatasWaktuWib(
    pool,
    dariTgl,
    sampaiTgl
  );

  // 2 & 3. Ringkasan Pesanan Masuk & Pembayaran Diterima (query bersama)
  const pesanan_masuk = await queryRingkasanPesananMasuk(pool, batas_mulai, batas_akhir_eksklusif);
  const pembayaran_diterima = await queryRingkasanPembayaranDiterima(
    pool,
    batas_mulai,
    batas_akhir_eksklusif
  );

  // 4. Query Komponen d & e: Pembatalan & Pembalikan pada Periode (audit_logs)
  const auditRes = await pool.query(
    `SELECT
       -- Tiket dibatalkan pada periode
       COUNT(DISTINCT al.entitas_id) FILTER (WHERE al.aksi = 'BATALKAN_TIKET')::bigint AS tiket_dibatalkan,
       -- Dibatalkan setelah sempat Lunas (jumlah saja, tanpa nominal)
       COUNT(DISTINCT al.entitas_id) FILTER (
         WHERE al.aksi = 'BATALKAN_TIKET'
           AND al.nilai_lama->>'status_bayar' = 'Lunas'
       )::bigint AS tiket_batal_sempat_lunas,
       -- Pembalikan pembayaran dari Lunas ke Belum bayar
       COUNT(*) FILTER (
         WHERE al.aksi = 'UBAH_PEMBAYARAN'
           AND al.nilai_lama->>'status_bayar' = 'Lunas'
           AND al.nilai_baru->>'status_bayar' = 'Belum bayar'
       )::bigint AS jumlah_pembalikan_bayar
     FROM audit_logs al
     WHERE al.entitas = 'orders'
       AND al.waktu >= $1
       AND al.waktu < $2`,
    [batas_mulai, batas_akhir_eksklusif]
  );

  const au = auditRes.rows[0] ?? {};

  return {
    periode: filter.periode,
    rentang: {
      dari: dariTgl,
      sampai: sampaiTgl,
      hari_ini: waktu.hari_ini,
    },
    disclaimer: TEKS_DISCLAIMER_LAPORAN,
    pesanan_masuk,
    pembayaran_diterima,
    audit_aktivitas: {
      tiket_dibatalkan: keJumlahAman(au.tiket_dibatalkan),
      tiket_batal_setelah_lunas: keJumlahAman(au.tiket_batal_sempat_lunas),
      pembalikan_pembayaran: keJumlahAman(au.jumlah_pembalikan_bayar),
      catatan_asumsi:
        "Dihitung dari riwayat audit status pada periode ini (asumsi perlu konfirmasi pemilik).",
    },
  };
}

/**
 * Menghitung Rekap Bulanan dari database (Phase 7B, FR-50, FR-51, FR-52).
 * Memakai query bersama yang identik dengan Laporan Harian 7A untuk ringkasan pesanan & pembayaran.
 */
export async function ambilRekapBulanan(
  filter: FilterRekapBulanan,
  poolClient?: Pool | PoolClient,
  tanggalAcuanWib?: string
): Promise<DataRekapBulanan> {
  const pool = poolClient ?? getPool();
  const waktu = await ambilWaktuAcuanWib(pool, tanggalAcuanWib);

  let dariTgl = filter.dari;
  let sampaiTgl = filter.sampai;

  if (filter.periode === "bulan_ini") {
    dariTgl = waktu.bulan_ini_awal;
    sampaiTgl = waktu.bulan_ini_akhir;
  } else if (filter.periode === "bulan_lalu") {
    dariTgl = waktu.bulan_lalu_awal;
    sampaiTgl = waktu.bulan_lalu_akhir;
  }

  const { batas_mulai, batas_akhir_eksklusif } = await hitungBatasWaktuWib(
    pool,
    dariTgl,
    sampaiTgl
  );

  const pesanan_masuk = await queryRingkasanPesananMasuk(pool, batas_mulai, batas_akhir_eksklusif);
  const pembayaran_diterima = await queryRingkasanPembayaranDiterima(
    pool,
    batas_mulai,
    batas_akhir_eksklusif
  );

  // Layanan Terlaris: dikelompokkan per service_id, urut pasang menurun, nominal menurun, nama menaik
  const layananRes = await pool.query(
    `SELECT
       s.id AS service_id,
       s.nama AS nama_layanan,
       s.aktif,
       SUM(oi.jumlah)::bigint AS jumlah_pasang,
       SUM(oi.jumlah * oi.harga_saat_transaksi)::bigint AS total_nominal
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN services s ON s.id = oi.service_id
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_masuk >= $1
       AND o.tanggal_masuk < $2
     GROUP BY s.id, s.nama, s.aktif
     ORDER BY jumlah_pasang DESC, total_nominal DESC, LOWER(s.nama) ASC, s.nama ASC, s.id ASC`,
    [batas_mulai, batas_akhir_eksklusif]
  );

  const totalPasang = pesanan_masuk.total_pasang;
  const semuaBaris = layananRes.rows.map((r) => ({
    service_id: Number(r.service_id),
    nama_layanan: String(r.nama_layanan),
    aktif: Boolean(r.aktif),
    jumlah_pasang: keJumlahAman(r.jumlah_pasang),
    total_nominal: keNominalAman(r.total_nominal),
  }));

  const daftarTerbatas: BarisLayananTerlaris[] = semuaBaris
    .slice(0, MAKS_LAYANAN_TERLARIS)
    .map((item, idx) => ({
      peringkat: idx + 1,
      service_id: item.service_id,
      nama_layanan: item.nama_layanan,
      aktif: item.aktif,
      jumlah_pasang: item.jumlah_pasang,
      persentase_pasang: hitungPersentaseSatuDesimal(item.jumlah_pasang, totalPasang),
      total_nominal: item.total_nominal,
      adalah_lainnya: false,
    }));

  if (semuaBaris.length > MAKS_LAYANAN_TERLARIS) {
    const sisa = semuaBaris.slice(MAKS_LAYANAN_TERLARIS);
    const sisaPasang = sisa.reduce((acc, item) => acc + item.jumlah_pasang, 0);
    const sisaNominal = sisa.reduce((acc, item) => acc + item.total_nominal, 0);
    // Pembulatan jujur: baris Lainnya dibulatkan dari porsi pasang aslinya terhadap total pasang
    const persentaseLainnya = hitungPersentaseSatuDesimal(sisaPasang, totalPasang);

    daftarTerbatas.push({
      peringkat: null,
      service_id: null,
      nama_layanan: "Lainnya",
      aktif: true,
      jumlah_pasang: sisaPasang,
      persentase_pasang: persentaseLainnya,
      total_nominal: sisaNominal,
      adalah_lainnya: true,
    });
  }

  return {
    periode: filter.periode,
    rentang: {
      dari: dariTgl,
      sampai: sampaiTgl,
      hari_ini: waktu.hari_ini,
    },
    disclaimer: TEKS_DISCLAIMER_LAPORAN,
    pesanan_masuk,
    pembayaran_diterima,
    layanan_terlaris: {
      total_pasang: totalPasang,
      total_nominal: pesanan_masuk.total_nominal,
      jumlah_layanan_unik: semuaBaris.length,
      daftar: daftarTerbatas,
      catatan_pembulatan: TEKS_CATATAN_PEMBULATAN_LAYANAN,
    },
    laba_rugi: {
      tersedia: false,
      pesan: TEKS_LABA_RUGI_BELUM_TERSEDIA,
    },
  };
}

/**
 * Mengambil cap waktu pembuatan laporan dari jam database zona Asia/Jakarta (WIB).
 */
export async function ambilJamBuatDbWib(poolClient?: Pool | PoolClient): Promise<string> {
  const pool = poolClient ?? getPool();
  const res = await pool.query(`
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS waktu_utc
  `);
  const formatted = formatTanggal(res.rows[0]?.waktu_utc, { denganWaktu: true });
  return formatted === "-" ? "" : formatted;
}

/**
 * Mengambil data Dashboard untuk kasir dan owner (FR-30, FR-31, FR-32).
 * Kasir: ringkasan masuk hari ini, belum bayar (hanya tiket & pasang, tanpa nominal), 5 tiket terbaru.
 * Owner: ringkasan masuk hari ini, belum bayar (lengkap dengan nominal), tren 7 hari (pasang per hari), 5 tiket terbaru.
 */
export async function ambilDataDashboard(
  peran: "owner" | "kasir",
  poolClient?: Pool | PoolClient
): Promise<DataDashboard> {
  const pool = poolClient ?? getPool();

  // 1. Tanggal hari ini dan batas awal/akhir hari ini (Asia/Jakarta)
  const waktuRes = await pool.query(`
    SELECT
      (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_ini_db,
      ((now() AT TIME ZONE 'Asia/Jakarta')::date::text || ' 00:00:00+07')::timestamptz AS batas_mulai_hari_ini,
      (((now() AT TIME ZONE 'Asia/Jakarta')::date + 1)::text || ' 00:00:00+07')::timestamptz AS batas_akhir_hari_ini
  `);
  const { hari_ini_db, batas_mulai_hari_ini, batas_akhir_hari_ini } = waktuRes.rows[0];

  // 2. Ringkasan Pesanan Masuk Hari Ini
  const masukHariIniRes = await pool.query(
    `WITH item_agg AS (
       SELECT order_id, SUM(jumlah)::bigint AS total_pasang
       FROM order_items
       GROUP BY order_id
     )
     SELECT
       COUNT(*)::bigint AS total_tiket,
       COALESCE(SUM(ia.total_pasang), 0)::bigint AS total_pasang
     FROM orders o
     JOIN item_agg ia ON ia.order_id = o.id
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_masuk >= $1
       AND o.tanggal_masuk < $2`,
    [batas_mulai_hari_ini, batas_akhir_hari_ini]
  );
  const mh = masukHariIniRes.rows[0] ?? {};

  // 3. Ringkasan Belum Bayar ("Belum bayar (semua tiket aktif)")
  const belumBayarRes = await pool.query(
    `WITH item_agg AS (
       SELECT
         order_id,
         SUM(jumlah)::bigint AS total_pasang,
         SUM(jumlah * harga_saat_transaksi)::bigint AS total_nominal
       FROM order_items
       GROUP BY order_id
     )
     SELECT
       COUNT(*)::bigint AS total_tiket,
       COALESCE(SUM(ia.total_pasang), 0)::bigint AS total_pasang,
       COALESCE(SUM(ia.total_nominal), 0)::bigint AS total_nominal
     FROM orders o
     JOIN item_agg ia ON ia.order_id = o.id
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.status_bayar = 'Belum bayar'`
  );
  const bb = belumBayarRes.rows[0] ?? {};

  // 4. Tren 7 Hari Terakhir (HANYA OWNER — FR-31): menggunakan JUMLAH PASANG per hari
  let tren7Hari: TitikTrenDashboard[] | null = null;
  if (peran === "owner") {
    const trenRes = await pool.query(
      `SELECT
         d.tgl::date::text AS tanggal,
         COALESCE(SUM(oi.jumlah), 0)::bigint AS jumlah_pasang
       FROM generate_series(
         (now() AT TIME ZONE 'Asia/Jakarta')::date - 6,
         (now() AT TIME ZONE 'Asia/Jakarta')::date,
         '1 day'::interval
       ) AS d(tgl)
       LEFT JOIN orders o ON
         (o.tanggal_masuk AT TIME ZONE 'Asia/Jakarta')::date = d.tgl::date
         AND o.status_pesanan <> 'Dibatalkan'
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY d.tgl
       ORDER BY d.tgl ASC`
    );
    tren7Hari = trenRes.rows.map((r) => ({
      tanggal: r.tanggal,
      jumlah_pasang: keJumlahAman(r.jumlah_pasang),
    }));
  }

  // 5. 5 Tiket Terbaru Masuk (FR-30): tanpa nomor WhatsApp demi privasi
  const tiketTerbaruRes = await pool.query(
    `SELECT
       o.id,
       o.kode_tiket,
       o.sumber,
       o.tanggal_masuk,
       o.status_pesanan,
       o.status_bayar,
       o.total,
       c.nama AS nama_pelanggan,
       COALESCE(SUM(oi.jumlah), 0)::bigint AS jumlah_pasang
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id, c.nama
     ORDER BY o.tanggal_masuk DESC, o.id DESC
     LIMIT $1`,
    [JUMLAH_TIKET_TERBARU_DASHBOARD]
  );

  const tiketTerbaru: TiketRingkasDashboard[] = tiketTerbaruRes.rows.map((row) => ({
    id: row.id,
    kode_tiket: row.kode_tiket,
    nama_pelanggan: row.nama_pelanggan,
    sumber: row.sumber as "wa" | "toko",
    jumlah_pasang: keJumlahAman(row.jumlah_pasang),
    status_pesanan: row.status_pesanan,
    status_bayar: row.status_bayar,
    total: keNominalAman(row.total),
    tanggal_masuk: row.tanggal_masuk instanceof Date ? row.tanggal_masuk.toISOString() : String(row.tanggal_masuk),
  }));

  return {
    hari_ini: hari_ini_db,
    peran,
    ringkasan_hari_ini: {
      pesanan_masuk: {
        total_tiket: keJumlahAman(mh.total_tiket),
        total_pasang: keJumlahAman(mh.total_pasang),
      },
      belum_bayar_aktif: {
        label: "Belum bayar (semua tiket aktif)",
        total_tiket: keJumlahAman(bb.total_tiket),
        total_pasang: keJumlahAman(bb.total_pasang),
        total_nominal: peran === "owner" ? keNominalAman(bb.total_nominal) : null,
      },
    },
    tren_7_hari: tren7Hari,
    tiket_terbaru: tiketTerbaru,
  };
}
