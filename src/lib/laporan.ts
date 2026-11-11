// Modul layanan Laporan Harian Operasional & Dashboard (Phase 7A, FR-30, FR-31, FR-32, FR-40 - FR-44).
// Seluruh kalkulasi waktu berakar pada jam database PostgreSQL zona Asia/Jakarta (+07:00).
// Tanpa parameter simulasi bug di kode produksi.

import type { Pool, PoolClient } from "pg";
import { getPool } from "./db.ts";
import {
  PERIODE_LAPORAN,
  type PeriodeLaporan,
  MAKS_RENTANG_HARI_LAPORAN,
  JUMLAH_TIKET_TERBARU_DASHBOARD,
  TEKS_DISCLAIMER_LAPORAN,
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

/**
 * Validasi parameter query untuk Laporan Harian Operasional.
 * Menganggap seluruh parameter dari URL sebagai input pengguna tidak tepercaya.
 */
export function validasiQueryLaporanHarian(
  searchParams: URLSearchParams
): HasilValidasiFilterLaporan {
  for (const k of searchParams.keys()) {
    if (!PARAMETER_LAPORAN_DIIZINKAN.has(k)) {
      return { ok: false, kode: 400, galat: `Parameter query tidak dikenal: ${k}.` };
    }
    if (searchParams.getAll(k).length > 1) {
      return { ok: false, kode: 400, galat: `Parameter ${k} tidak boleh dikirim berulang.` };
    }
  }

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
    dari = dariRaw;
    sampai = sampaiRaw;
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
 * Menghitung Laporan Harian Operasional dari database.
 * Jam acuan hari ini, kemarin, dan batas waktu murni dari database PostgreSQL zona Asia/Jakarta.
 */
export async function ambilLaporanHarian(
  filter: FilterLaporanHarian,
  poolClient?: Pool | PoolClient
): Promise<DataLaporanHarian> {
  const pool = poolClient ?? getPool();

  // 1. Tentukan tanggal acuan dan batas periode dari jam database (Asia/Jakarta)
  const dbWaktuRes = await pool.query(`
    SELECT
      (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_ini_db,
      ((now() AT TIME ZONE 'Asia/Jakarta')::date - 1)::text AS kemarin_db
  `);
  const hariIniDb: string = dbWaktuRes.rows[0].hari_ini_db;
  const kemarinDb: string = dbWaktuRes.rows[0].kemarin_db;

  let dariTgl = filter.dari;
  let sampaiTgl = filter.sampai;

  if (filter.periode === "hari_ini") {
    dariTgl = hariIniDb;
    sampaiTgl = hariIniDb;
  } else if (filter.periode === "kemarin") {
    dariTgl = kemarinDb;
    sampaiTgl = kemarinDb;
  }

  // Batas timestamptz eksak dalam zona Asia/Jakarta
  const batasRes = await pool.query(
    `SELECT
       ($1 || ' 00:00:00+07')::timestamptz AS batas_mulai,
       (($2::date + 1)::text || ' 00:00:00+07')::timestamptz AS batas_akhir_eksklusif`,
    [dariTgl, sampaiTgl]
  );
  const { batas_mulai, batas_akhir_eksklusif } = batasRes.rows[0];

  // 2. Query Komponen a & b: Pesanan Masuk pada Periode (kohort tanggal_masuk)
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
    [batas_mulai, batas_akhir_eksklusif]
  );

  const pm = pesananMasukRes.rows[0] ?? {};

  // 3. Query Komponen c: Pembayaran Diterima pada Periode (kohort tanggal_bayar)
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
    [batas_mulai, batas_akhir_eksklusif]
  );

  const pb = pembayaranDiterimaRes.rows[0] ?? {};

  // 4. Query Komponen d & e: Pembatalan & Pembalikan pada Periode (audit_logs)
  const auditRes = await pool.query(
    `SELECT
       -- Tiket dibatalkan pada periode
       COUNT(DISTINCT al.entitas_id) FILTER (WHERE al.aksi = 'BATALKAN_TIKET')::bigint AS tiket_dibatalkan,
       -- Dibatalkan setelah sempat Lunas (jumlah saja, tanpa nominal)
       COUNT(DISTINCT al.entitas_id) FILTER (
         WHERE al.aksi = 'BATALKAN_TIKET'
           AND (
             al.nilai_lama->>'status_bayar' = 'Lunas'
             OR (al.nilai_baru->>'uang_dikembalikan_di_luar_sistem')::boolean = true
           )
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
      hari_ini: hariIniDb,
    },
    disclaimer: TEKS_DISCLAIMER_LAPORAN,
    pesanan_masuk: {
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
    },
    pembayaran_diterima: {
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
    },
    audit_aktivitas: {
      tiket_dibatalkan: keJumlahAman(au.tiket_dibatalkan),
      tiket_batal_setelah_lunas: keJumlahAman(au.tiket_batal_sempat_lunas),
      pembalikan_pembayaran: keJumlahAman(au.jumlah_pembalikan_bayar),
      catatan_asumsi:
        "Dihitung dari riwayat audit status pada periode ini. Pengembalian dana ditangani di luar sistem (asumsi perlu konfirmasi pemilik).",
    },
  };
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
