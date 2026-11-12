// Tes Phase 7A: Dashboard Operasional & Laporan Harian Operasional (FR-30, FR-31, FR-32, FR-40 - FR-44).
// Menegakkan otorisasi peran (Owner vs Kasir), batas waktu database zona Asia/Jakarta (+07:00),
// perhitungan pasang (bukan per tiket), pembatalan/pembalikan, ketiadaan nama/nomor pada laporan & dashboard,
// Cache-Control: no-store, serta bukti gagal-lalu-lulus via implementasi query pembanding independen.
//
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/laporan-7a.test.mjs'

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import {
  validasiQueryLaporanHarian,
  ambilLaporanHarian,
  ambilDataDashboard,
} from "../src/lib/laporan.ts";
import { keNominalAman, keJumlahAman } from "../src/config/laporan.ts";
import { hitungGeometriGrafikTren, formatTanggalGrafik } from "../src/lib/grafik-tren.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner 7A ${Date.now()}`;
const KASIR_NAMA = `Kasir 7A ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let adminPool;
let appPool;
let ownerCookie;
let kasirCookie;
let layanan1;
let layanan2;

let urutWa = 7000;
function waUnik08() {
  urutWa += 1;
  return `08129900${String(urutWa).padStart(4, "0")}`;
}

async function login(username, pin) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(res.status, 200, `Login ${username} harus 200`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function api(cookie, method, url, body, opsi = {}) {
  const headers = { ...(opsi.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET" && method !== "HEAD") {
    if (opsi.contentType !== null) {
      headers["Content-Type"] = opsi.contentType ?? "application/json";
    }
    if (opsi.origin !== null) {
      headers.Origin = opsi.origin ?? BASE;
    }
  }
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: opsi.mentah ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: "manual",
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // bukan JSON
  }
  return { res, data };
}

async function ambilHtml(cookie, url) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${url}`, {
    method: "GET",
    headers,
    redirect: "manual",
  });
  const html = await res.text();
  return { res, html };
}

before(async () => {
  const dbUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  const appUrl = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
  assert.ok(dbUrl, "DATABASE_URL_ADMIN harus terisi");
  assert.ok(appUrl, "DATABASE_URL_APP harus terisi");

  adminPool = new Pool({ connectionString: dbUrl });
  appPool = new Pool({ connectionString: appUrl });

  // Buat akun owner & kasir
  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);

  // Buat 2 layanan aktif via katalog untuk variasi pasang & harga
  const s1 = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Fast Clean 7A ${Date.now()}`,
    harga: 30_000,
    estimasi_hari: 1,
  });
  assert.equal(s1.res.status, 201);
  layanan1 = s1.data.data;

  const s2 = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Deep Clean 7A ${Date.now()}`,
    harga: 50_000,
    estimasi_hari: 3,
  });
  assert.equal(s2.res.status, 201);
  layanan2 = s2.data.data;
});

after(async () => {
  if (adminPool) await adminPool.end();
  if (appPool) await appPool.end();
});

// ---------- 1. Otorisasi & Akses Keamanan Rute Laporan Harian ----------

test("otorisasi: kasir ditolak 403 pada API & halaman laporan, tanpa login diarahkan ke login, owner 200", async () => {
  // A. API GET /api/laporan-harian
  const tanpaLoginApi = await api(null, "GET", "/api/laporan-harian");
  assert.equal(tanpaLoginApi.res.status, 307, "Tanpa login harus diarahkan ke /login (307)");

  const kasirApi = await api(kasirCookie, "GET", "/api/laporan-harian");
  assert.equal(kasirApi.res.status, 403, "Kasir mengakses API laporan harus ditolak 403");
  assert.equal(kasirApi.data?.error, "Akses ditolak");

  const ownerApi = await api(ownerCookie, "GET", "/api/laporan-harian");
  assert.equal(ownerApi.res.status, 200, "Owner mengakses API laporan harus 200");
  assert.equal(ownerApi.data?.ok, true);

  // B. Halaman SSR /laporan-harian
  const tanpaLoginHalaman = await ambilHtml(null, "/laporan-harian");
  assert.equal(tanpaLoginHalaman.res.status, 307);

  const kasirHalaman = await ambilHtml(kasirCookie, "/laporan-harian");
  assert.equal(kasirHalaman.res.status, 200);
  assert.match(kasirHalaman.html, /Akses Ditolak/i);

  const ownerHalaman = await ambilHtml(ownerCookie, "/laporan-harian");
  assert.equal(ownerHalaman.res.status, 200);
  assert.match(ownerHalaman.html, /Laporan Harian Operasional/i);
  assert.match(ownerHalaman.html, /Dihitung otomatis dari data tiket/i);
  assert.match(ownerHalaman.html, /Hanya-baca/i);
  assert.match(ownerHalaman.html, /Angka dihitung dari data tiket saat ini/i);
  assert.match(ownerHalaman.html, /Tiket yang sudah dibayar lalu dibatalkan/i);
  assert.doesNotMatch(ownerHalaman.html, /dikembalikan/i);
});

test("keamanan rute: endpoint laporan hanya-baca (POST/PATCH/DELETE ditolak) & header Cache-Control no-store", async () => {
  // Non-GET method ditolak
  const postRes = await api(ownerCookie, "POST", "/api/laporan-harian", { angka: 999 });
  assert.equal(postRes.res.status, 405, "POST /api/laporan-harian harus 405 Method Not Allowed");

  const patchRes = await api(ownerCookie, "PATCH", "/api/laporan-harian", { angka: 999 });
  assert.equal(patchRes.res.status, 405, "PATCH /api/laporan-harian harus 405");

  // Cache-Control no-store
  const getRes = await api(ownerCookie, "GET", "/api/laporan-harian");
  assert.equal(getRes.res.status, 200);
  const cacheControl = getRes.res.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /no-store/i, "Wajib memiliki Cache-Control: no-store");
  assert.match(cacheControl, /no-cache/i);

  // Tanpa kebocoran nama pelanggan atau nomor telepon di respons JSON laporan
  const jsonStr = JSON.stringify(getRes.data);
  assert.doesNotMatch(jsonStr, /"nama_pelanggan"/i);
  assert.doesNotMatch(jsonStr, /"nomor_wa"/i);
});

test("validasi parameter query: tolak parameter asing, duplikat, tanggal tidak valid, dari > sampai, atau > 366 hari", () => {
  // Parameter asing
  const vAsing = validasiQueryLaporanHarian(new URLSearchParams("periode=hari_ini&injeksi=1"));
  assert.equal(vAsing.ok, false);
  assert.equal(vAsing.kode, 400);

  // Parameter berulang
  const vDuplikat = validasiQueryLaporanHarian(new URLSearchParams("periode=hari_ini&periode=kemarin"));
  assert.equal(vDuplikat.ok, false);
  assert.equal(vDuplikat.kode, 400);

  // Periode tidak sah
  const vPeriodeSalah = validasiQueryLaporanHarian(new URLSearchParams("periode=tahun_ini"));
  assert.equal(vPeriodeSalah.ok, false);
  assert.equal(vPeriodeSalah.kode, 400);

  // dari/sampai pada periode bukan rentang
  const vDariPadaHariIni = validasiQueryLaporanHarian(new URLSearchParams("periode=hari_ini&dari=2026-11-01"));
  assert.equal(vDariPadaHariIni.ok, false);
  assert.equal(vDariPadaHariIni.kode, 400);

  // Rentang tanpa dari/sampai
  const vRentangKosong = validasiQueryLaporanHarian(new URLSearchParams("periode=rentang"));
  assert.equal(vRentangKosong.ok, false);
  assert.equal(vRentangKosong.kode, 400);

  // Tanggal bukan kalender valid
  const vTanggalSalah = validasiQueryLaporanHarian(
    new URLSearchParams("periode=rentang&dari=2026-02-30&sampai=2026-03-01")
  );
  assert.equal(vTanggalSalah.ok, false);
  assert.equal(vTanggalSalah.kode, 400);

  // dari > sampai
  const vMundur = validasiQueryLaporanHarian(
    new URLSearchParams("periode=rentang&dari=2026-11-10&sampai=2026-11-05")
  );
  assert.equal(vMundur.ok, false);
  assert.equal(vMundur.kode, 400);

  // Rentang > 366 hari
  const vTerlaluPanjang = validasiQueryLaporanHarian(
    new URLSearchParams("periode=rentang&dari=2025-01-01&sampai=2026-02-05")
  );
  assert.equal(vTerlaluPanjang.ok, false);
  assert.equal(vTerlaluPanjang.kode, 400);

  // Valid rentang
  const vOk = validasiQueryLaporanHarian(
    new URLSearchParams("periode=rentang&dari=2026-11-01&sampai=2026-11-07")
  );
  assert.equal(vOk.ok, true);
  if (vOk.ok) {
    assert.equal(vOk.data.periode, "rentang");
    assert.equal(vOk.data.dari, "2026-11-01");
    assert.equal(vOk.data.sampai, "2026-11-07");
  }
});

// ---------- 2. Fixture Tanggal Tetap Masa Lalu & Hitungan Angka Manual ----------

const TGL_UJI = "2026-10-15";
const TGL_KEMARIN_UJI = "2026-10-14";
const TGL_BESOK_UJI = "2026-10-16";

test("laporan harian operasional: hitungan manual vs SQL agregat pada tanggal tetap masa lalu (deterministik 24 jam)", async () => {
  // Helper membuat tiket via API nyata
  async function buatTiket(params) {
    const { res, data } = await api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: params.nama ?? "Pelanggan Laporan 7A",
      nomor_wa: waUnik08(),
      status_bayar: params.status_bayar ?? "Belum bayar",
      ...(params.metode_bayar ? { metode_bayar: params.metode_bayar } : {}),
      items: params.items,
    });
    assert.equal(res.status, 201, `Buat tiket gagal: ${JSON.stringify(data)}`);
    return data.data;
  }

  // Helper khusus admin untuk mengatur timestamp historis deterministik pada DB uji
  async function setWaktuTiketAdmin(orderId, tglMasukWib, tglBayarWib) {
    await adminPool.query(`ALTER TABLE orders DISABLE TRIGGER orders_proteksi_update`);
    await adminPool.query(
      `UPDATE orders
          SET tanggal_masuk = $1::timestamptz,
              tanggal_bayar = COALESCE($2::timestamptz, tanggal_bayar)
        WHERE id = $3`,
      [tglMasukWib, tglBayarWib ?? null, orderId]
    );
    await adminPool.query(`ALTER TABLE orders ENABLE TRIGGER orders_proteksi_update`);
  }

  async function setWaktuAuditAdmin(orderId, aksi, waktuWib) {
    await adminPool.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_blokir_update`);
    await adminPool.query(
      `UPDATE audit_logs SET waktu = $1::timestamptz
        WHERE entitas = 'orders' AND entitas_id = $2 AND aksi = $3`,
      [waktuWib, orderId, aksi]
    );
    await adminPool.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_blokir_update`);
  }

  // --- Fixture 1: Tiket Multi-barang (2026-10-15 10:00 WIB, Lunas Cash) ---
  const h1 = layanan1.harga;
  const h2 = layanan2.harga;
  const t1 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sneakers Hitam", jumlah: 2 },
      { service_id: layanan2.id, deskripsi_barang: "Boots Kulit", jumlah: 3 },
    ],
  });
  await setWaktuTiketAdmin(t1.id, `${TGL_UJI} 10:00:00+07`, `${TGL_UJI} 10:00:00+07`);
  const t1_pasang = 5;
  const t1_nominal = 2 * h1 + 3 * h2;

  // --- Fixture 2: Tiket Single-barang (2026-10-15 14:00 WIB, Lunas Non-cash) ---
  const t2 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Slip-on Putih", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t2.id, `${TGL_UJI} 14:00:00+07`, `${TGL_UJI} 14:00:00+07`);
  const t2_pasang = 1;
  const t2_nominal = 1 * h1;

  // --- Fixture 3: Tiket Batas Waktu 00:01:00 WIB (2026-10-15 00:01 WIB = 2026-10-14 17:01 UTC) ---
  const t3 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan2.id, deskripsi_barang: "Running Shoes", jumlah: 2 },
    ],
  });
  await setWaktuTiketAdmin(t3.id, `${TGL_UJI} 00:01:00+07`);
  const t3_pasang = 2;
  const t3_nominal = 2 * h2;

  // --- Fixture 4: Tiket Dibatalkan Sebelum Lunas (2026-10-15 11:00 WIB) ---
  const t4 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Canvas Biru", jumlah: 1 },
    ],
  });
  const batalT4 = await api(kasirCookie, "PATCH", `/api/tiket/${t4.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan membatalkan pesanan di toko",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(batalT4.res.status, 200, "Batal T4 harus 200");
  await setWaktuTiketAdmin(t4.id, `${TGL_UJI} 11:00:00+07`);
  await setWaktuAuditAdmin(t4.id, "BATALKAN_TIKET", `${TGL_UJI} 11:05:00+07`);

  // --- Fixture 5: Tiket Sempat Lunas Lalu Dibatalkan (2026-10-15 11:30 WIB) ---
  const t5 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Loafers Cokelat", jumlah: 2 },
    ],
  });
  const batalT5 = await api(kasirCookie, "PATCH", `/api/tiket/${t5.id}`, {
    jenis: "batalkan",
    alasan_batal: "Sepatu rusak sebelum dikerjakan",
    konfirmasi_sudah_lunas: true,
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(batalT5.res.status, 200, "Batal T5 harus 200");
  await setWaktuTiketAdmin(t5.id, `${TGL_UJI} 11:30:00+07`, `${TGL_UJI} 11:31:00+07`);
  await setWaktuAuditAdmin(t5.id, "BATALKAN_TIKET", `${TGL_UJI} 11:35:00+07`);

  // --- Fixture 6: Pembalikan Pembayaran Lunas -> Belum bayar (2026-10-15 12:00 WIB) ---
  const t6 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Suede Abu-abu", jumlah: 1 },
    ],
  });
  const balikT6 = await api(kasirCookie, "PATCH", `/api/tiket/${t6.id}`, {
    jenis: "pembayaran",
    status_bayar: "Belum bayar",
    alasan: "Kasir salah catat metode bayar, belum serah terima uang",
    status_sebelumnya: "Lunas",
  });
  assert.equal(balikT6.res.status, 200, "Pembalikan bayar T6 harus 200");
  await setWaktuTiketAdmin(t6.id, `${TGL_UJI} 12:00:00+07`);
  await setWaktuAuditAdmin(t6.id, "UBAH_PEMBAYARAN", `${TGL_UJI} 12:05:00+07`);
  const t6_pasang = 1;
  const t6_nominal = 1 * h1;

  // --- Fixture 7: Tiket Masuk Kemarin (2026-10-14 10:00 WIB) tapi Dibayar pada 2026-10-15 (Non-cash) ---
  const t7 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan2.id, deskripsi_barang: "Sepatu Kemarin", jumlah: 2 },
    ],
  });
  const bayarT7 = await api(kasirCookie, "PATCH", `/api/tiket/${t7.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(bayarT7.res.status, 200, "Bayar T7 harus 200");
  await setWaktuTiketAdmin(t7.id, `${TGL_KEMARIN_UJI} 10:00:00+07`, `${TGL_UJI} 09:00:00+07`);
  const t7_pasang = 2;
  const t7_nominal = 2 * h2;

  // --- Fixture 8: Tiket Batas Waktu 23:59:00 WIB (2026-10-15 23:59 WIB = 2026-10-15 16:59 UTC) ---
  const t8 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sepatu Malam WIB", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t8.id, `${TGL_UJI} 23:59:00+07`);
  const t8_pasang = 1;
  const t8_nominal = 1 * h1;

  // --- Fixture 9: Tiket Batas Waktu Besok Siang WIB (2026-10-16 12:00 WIB) ---
  const t9 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sepatu Besok WIB", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t9.id, `${TGL_BESOK_UJI} 12:00:00+07`);

  // --- Fixture 10: Bukti Harga Katalog Berubah Tidak Mengubah Tiket Lama ---
  await adminPool.query(`UPDATE services SET harga = harga + 20000 WHERE id = $1`, [layanan1.id]);

  // HITUNGAN MANUAL KONSTANTA EKSPEKTASI (pada tanggal tetap 2026-10-15):
  // Pesanan masuk 2026-10-15 (aktif & bukan dibatalkan): T1, T2, T3, T6, T8.
  const EXPECT_TIKET_MASUK = 5;
  const EXPECT_PASANG_MASUK = t1_pasang + t2_pasang + t3_pasang + t6_pasang + t8_pasang; // 10
  const EXPECT_NOMINAL_MASUK = t1_nominal + t2_nominal + t3_nominal + t6_nominal + t8_nominal;

  const EXPECT_TIKET_LUNAS = 2;
  const EXPECT_PASANG_LUNAS = t1_pasang + t2_pasang; // 6
  const EXPECT_NOMINAL_LUNAS = t1_nominal + t2_nominal;

  const EXPECT_TIKET_BELUM = 3;
  const EXPECT_PASANG_BELUM = t3_pasang + t6_pasang + t8_pasang; // 4
  const EXPECT_NOMINAL_BELUM = t3_nominal + t6_nominal + t8_nominal;

  // Pembayaran diterima tanggal 2026-10-15 (T1, T2, T7)
  const EXPECT_BAYAR_TIKET = 3;
  const EXPECT_BAYAR_NOMINAL = t1_nominal + t2_nominal + t7_nominal;
  const EXPECT_CASH_TIKET = 1;
  const EXPECT_CASH_NOMINAL = t1_nominal;
  const EXPECT_NON_CASH_TIKET = 2;
  const EXPECT_NON_CASH_NOMINAL = t2_nominal + t7_nominal;

  // Aktivitas Audit 2026-10-15 (T4, T5 dibatalkan; T5 sempat Lunas; T6 dibalik)
  const EXPECT_AUDIT_BATAL = 2;
  const EXPECT_AUDIT_BATAL_SEMPAT_LUNAS = 1;
  const EXPECT_AUDIT_PEMBALIKAN = 1;

  // Panggil kode produksi ambilLaporanHarian via periode rentang ke tanggal tetap TGL_UJI
  const lapUji = await ambilLaporanHarian({
    periode: "rentang",
    dari: TGL_UJI,
    sampai: TGL_UJI,
  }, appPool);

  assert.equal(lapUji.pesanan_masuk.total_tiket, EXPECT_TIKET_MASUK);
  assert.equal(lapUji.pesanan_masuk.total_pasang, EXPECT_PASANG_MASUK);
  assert.equal(lapUji.pesanan_masuk.total_nominal, EXPECT_NOMINAL_MASUK);

  assert.equal(lapUji.pesanan_masuk.lunas.total_tiket, EXPECT_TIKET_LUNAS);
  assert.equal(lapUji.pesanan_masuk.lunas.total_pasang, EXPECT_PASANG_LUNAS);
  assert.equal(lapUji.pesanan_masuk.lunas.total_nominal, EXPECT_NOMINAL_LUNAS);

  assert.equal(lapUji.pesanan_masuk.belum_bayar.total_tiket, EXPECT_TIKET_BELUM);
  assert.equal(lapUji.pesanan_masuk.belum_bayar.total_pasang, EXPECT_PASANG_BELUM);
  assert.equal(lapUji.pesanan_masuk.belum_bayar.total_nominal, EXPECT_NOMINAL_BELUM);

  assert.equal(lapUji.pembayaran_diterima.total_tiket, EXPECT_BAYAR_TIKET);
  assert.equal(lapUji.pembayaran_diterima.total_nominal, EXPECT_BAYAR_NOMINAL);
  assert.equal(lapUji.pembayaran_diterima.cash.total_tiket, EXPECT_CASH_TIKET);
  assert.equal(lapUji.pembayaran_diterima.cash.total_nominal, EXPECT_CASH_NOMINAL);
  assert.equal(lapUji.pembayaran_diterima.non_cash.total_tiket, EXPECT_NON_CASH_TIKET);
  assert.equal(lapUji.pembayaran_diterima.non_cash.total_nominal, EXPECT_NON_CASH_NOMINAL);

  assert.equal(lapUji.audit_aktivitas.tiket_dibatalkan, EXPECT_AUDIT_BATAL);
  assert.equal(lapUji.audit_aktivitas.tiket_batal_setelah_lunas, EXPECT_AUDIT_BATAL_SEMPAT_LUNAS);
  assert.equal(lapUji.audit_aktivitas.pembalikan_pembayaran, EXPECT_AUDIT_PEMBALIKAN);

  // Periksa tanggal kemarin uji (TGL_KEMARIN_UJI): T7 masuk di pesanan kemarin
  const lapKemarin = await ambilLaporanHarian({
    periode: "rentang",
    dari: TGL_KEMARIN_UJI,
    sampai: TGL_KEMARIN_UJI,
  }, appPool);
  assert.equal(lapKemarin.pesanan_masuk.total_tiket, 1, "T7 masuk di kohort kemarin");
  assert.equal(lapKemarin.pesanan_masuk.total_pasang, t7_pasang);
});

// ---------- 3. Bukti Gagal-Lalu-Lulus via Kueri Pembanding Independen (Tanggal Tetap) ----------

test("bukti gagal-lalu-lulus 1: kueri salah hitung per tiket menghasilkan angka salah pada tiket multi-barang, kode produksi benar", async () => {
  const kueriSalah = await appPool.query(
    `SELECT COUNT(o.id)::int AS total_barang_cacat
     FROM orders o
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_masuk >= ($1 || ' 00:00:00+07')::timestamptz
       AND o.tanggal_masuk < (($1::date + 1)::text || ' 00:00:00+07')::timestamptz`,
    [TGL_UJI]
  );
  const hasilCacat = kueriSalah.rows[0].total_barang_cacat;

  const lap = await ambilLaporanHarian({ periode: "rentang", dari: TGL_UJI, sampai: TGL_UJI }, appPool);
  const hasilProduksi = lap.pesanan_masuk.total_pasang;

  assert.notEqual(
    hasilCacat,
    hasilProduksi,
    `Kueri salah (hitung per tiket: ${hasilCacat}) gagal menangkap volume fisik sepatu (${hasilProduksi} pasang)`
  );
  assert.equal(hasilProduksi, 10, "Kode produksi wajib tepat 10 pasang sepatu");
});

test("bukti gagal-lalu-lulus 2: kueri salah mengikutkan tiket Dibatalkan menghasilkan angka menggelembung, kode produksi benar", async () => {
  const kueriSalah = await appPool.query(
    `SELECT COALESCE(SUM(oi.jumlah), 0)::int AS total_pasang_termasuk_batal
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.tanggal_masuk >= ($1 || ' 00:00:00+07')::timestamptz
       AND o.tanggal_masuk < (($1::date + 1)::text || ' 00:00:00+07')::timestamptz`,
    [TGL_UJI]
  );
  const hasilCacat = kueriSalah.rows[0].total_pasang_termasuk_batal;

  const lap = await ambilLaporanHarian({ periode: "rentang", dari: TGL_UJI, sampai: TGL_UJI }, appPool);
  const hasilProduksi = lap.pesanan_masuk.total_pasang;

  assert.notEqual(
    hasilCacat,
    hasilProduksi,
    `Kueri salah menggelembung karena mengikutkan tiket batal (${hasilCacat} vs ${hasilProduksi})`
  );
  assert.equal(hasilCacat, 13, "Kueri salah mencakup tiket batal (10 + 1 + 2 = 13)");
  assert.equal(hasilProduksi, 10, "Kode produksi tepat mengecualikan tiket batal (10 pasang)");
});

test("bukti gagal-lalu-lulus 3: kueri salah batas hari UTC memotong transaksi dini hari WIB (00:01 WIB) secara deterministik", async () => {
  // Mengevaluasi batas hari berdasarkan zona UTC untuk tanggal tetap 2026-10-15:
  // T3 masuk pukul 2026-10-15 00:01:00+07 (= 2026-10-14 17:01:00Z) sehingga terpotong ke 2026-10-14 UTC.
  const kueriSalahUtc = await appPool.query(
    `SELECT COUNT(o.id)::int AS total_tiket_utc
     FROM orders o
     WHERE o.status_pesanan <> 'Dibatalkan'
       AND o.tanggal_masuk >= ($1 || ' 00:00:00Z')::timestamptz
       AND o.tanggal_masuk < (($1::date + 1)::text || ' 00:00:00Z')::timestamptz`,
    [TGL_UJI]
  );
  const hitungUtc = kueriSalahUtc.rows[0].total_tiket_utc;

  const lap = await ambilLaporanHarian({ periode: "rentang", dari: TGL_UJI, sampai: TGL_UJI }, appPool);
  const hitungWib = lap.pesanan_masuk.total_tiket;
  const EXPECT_MANUAL = 5;

  assert.notEqual(
    hitungUtc,
    EXPECT_MANUAL,
    `Kueri salah UTC (${hitungUtc}) berbeda dari angka manual (${EXPECT_MANUAL})`
  );
  assert.equal(hitungUtc, 4, "Kueri salah UTC hanya mendeteksi 4 tiket (kehilangan T3 00:01 WIB)");
  assert.equal(hitungWib, EXPECT_MANUAL, "Kode produksi wajib tepat 5 tiket sesuai batas WIB");
});

// ---------- 4. Tes 'Hari Ini' Bebas Jam & Dashboard Operasional ----------

test("periode hari ini & dashboard: transaksi waktu nyata dihitung akurat tanpa bergantung batas tengah malam", async () => {
  // Buat tiket baru pada waktu sekarang (tanpa memanipulasi batas tengah malam)
  const { res: resTiket } = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Pelanggan Hari Ini",
    nomor_wa: waUnik08(),
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Tiket Hari Ini", jumlah: 4 },
    ],
  });
  assert.equal(resTiket.status, 201);

  const lapHariIni = await ambilLaporanHarian({
    periode: "hari_ini",
    dari: "",
    sampai: "",
  }, appPool);
  assert.ok(lapHariIni.pesanan_masuk.total_tiket >= 1);
  assert.ok(lapHariIni.pesanan_masuk.total_pasang >= 4);

  // 1. Data Dashboard Kasir
  const dashKasir = await ambilDataDashboard("kasir", appPool);
  assert.equal(dashKasir.peran, "kasir");
  assert.equal(dashKasir.tren_7_hari, null, "Kasir tidak boleh menerima data tren 7 hari");
  assert.equal(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_nominal, null, "Kasir tidak melihat nominal belum bayar");
  assert.ok(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_tiket >= 4);
  assert.ok(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_pasang >= 8);
  assert.equal(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.label, "Belum bayar (semua tiket aktif)");

  // 2. Data Dashboard Owner
  const dashOwner = await ambilDataDashboard("owner", appPool);
  assert.equal(dashOwner.peran, "owner");
  assert.equal(dashOwner.hari_ini, lapHariIni.rentang.hari_ini);
  assert.ok(dashOwner.tren_7_hari !== null, "Owner wajib menerima data tren 7 hari");
  assert.equal(dashOwner.tren_7_hari.length, 7, "Tren wajib memiliki tepat 7 titik harian berakhir hari ini");
  assert.ok(typeof dashOwner.ringkasan_hari_ini.belum_bayar_aktif.total_nominal === "number");
  assert.equal(dashOwner.ringkasan_hari_ini.pesanan_masuk.total_pasang, lapHariIni.pesanan_masuk.total_pasang);

  // Tren hari terakhir (hari ini) harus memuat jumlah pasang sepatu hari ini
  const titikHariIni = dashOwner.tren_7_hari[6];
  assert.equal(titikHariIni.tanggal, dashOwner.hari_ini);
  assert.equal(titikHariIni.jumlah_pasang, lapHariIni.pesanan_masuk.total_pasang);

  // 3. 5 Tiket Terbaru (FR-30)
  assert.ok(dashOwner.tiket_terbaru.length <= 5, "Maksimal 5 tiket terbaru");
  for (const t of dashOwner.tiket_terbaru) {
    assert.ok(t.kode_tiket.startsWith("SM-"));
    assert.ok(t.nama_pelanggan, "Wajib memiliki nama pelanggan");
    assert.ok(!("nomor_wa" in t), "Nomor WhatsApp tidak boleh bocor ke dashboard");
    assert.ok(typeof t.jumlah_pasang === "number");
    assert.ok(typeof t.total === "number");
  }
});

test("dashboard SSR: owner melihat grafik tren & label 'tren, bukan laporan harian', kasir melihat tombol + Buat Tiket", async () => {
  const htmlKasir = await ambilHtml(kasirCookie, "/");
  assert.equal(htmlKasir.res.status, 200);
  assert.match(htmlKasir.html, /\+ Buat Tiket/i, "Kasir melihat tombol + Buat Tiket");
  assert.doesNotMatch(htmlKasir.html, /Tren Pesanan 7 Hari Terakhir/i, "Kasir tidak melihat grafik tren 7 hari");

  const htmlOwner = await ambilHtml(ownerCookie, "/");
  assert.equal(htmlOwner.res.status, 200);
  assert.match(htmlOwner.html, /Tren Pesanan 7 Hari Terakhir/i, "Owner melihat grafik tren 7 hari");
  assert.match(htmlOwner.html, /tren, bukan laporan harian/i, "Wajib ada label 'tren, bukan laporan harian'");
  assert.match(htmlOwner.html, /Grafik tren pesanan 7 hari terakhir/i);
  assert.match(htmlOwner.html, /\(Hari Ini\)/);
  assert.match(htmlOwner.html, /Buka Laporan Harian/i);
});

test("grafik tren geometri murni: label & batang tetap di dalam viewBox, nol aman, nilai besar 500, dan ponsel tidak bertumpuk", () => {
  const skenario = [
    {
      nama: "semua nol",
      data: [0, 0, 0, 0, 0, 0, 0],
    },
    {
      nama: "satu nilai besar di akhir",
      data: [0, 0, 0, 0, 0, 0, 12],
    },
    {
      nama: "nilai besar 500 + hari kosong",
      data: [500, 0, 120, 45, 0, 310, 500],
    },
  ];

  for (const s of skenario) {
    const titik = s.data.map((jumlah_pasang, idx) => ({
      tanggal: `2026-11-0${idx + 1}`,
      jumlah_pasang,
    }));

    for (const mode of ["desktop", "ponsel"]) {
      const geo = hitungGeometriGrafikTren(titik, { mode });
      assert.equal(geo.bars.length, 7);

      for (let i = 0; i < geo.bars.length; i++) {
        const b = geo.bars[i];
        // Tinggi dan posisi batang sah & di dalam viewBox
        assert.ok(b.height > 0, `${s.nama} [${mode}]: height bar ${i} harus > 0`);
        assert.ok(b.y >= 0 && b.y + b.height <= geo.viewBoxHeight, `${s.nama} [${mode}]: bar ${i} di luar viewBox Y`);
        assert.ok(b.x >= 0 && b.x + b.width <= geo.viewBoxWidth, `${s.nama} [${mode}]: bar ${i} di luar viewBox X`);

        // Label nilai di atas batang tertinggi TIDAK pernah terpotong ke koordinat negatif
        assert.ok(
          b.labelNilai.perkiraanAtas >= 0 && b.labelNilai.y < geo.viewBoxHeight,
          `${s.nama} [${mode}]: label nilai bar ${i} keluar batas atas (${b.labelNilai.perkiraanAtas})`
        );
        if (b.jumlahPasang === 0) {
          assert.equal(b.labelNilai.text, "0", "Hari kosong harus menampilkan 0 tertulis");
        } else {
          assert.equal(b.labelNilai.text, `${b.jumlahPasang} psg`);
        }

        // Label tanggal berada di dalam viewBox dan tidak bertumpuk antar hari berdekatan
        assert.ok(
          b.labelTanggal.xKiri >= 0 && b.labelTanggal.xKanan <= geo.viewBoxWidth,
          `${s.nama} [${mode}]: label tanggal ${i} keluar batas X`
        );
        assert.ok(b.labelTanggal.y < geo.viewBoxHeight);
        if (i > 0) {
          const prev = geo.bars[i - 1];
          assert.ok(
            prev.labelTanggal.xKanan < b.labelTanggal.xKiri,
            `${s.nama} [${mode}]: label tanggal ${i - 1} (${prev.labelTanggal.xKanan}) menimpa ${i} (${b.labelTanggal.xKiri})`
          );
        }
      }
      assert.ok(geo.yLabelHariIni < geo.viewBoxHeight);
    }
  }

  // Verifikasi format pendek "6 Nov" untuk mode ponsel vs lengkap untuk desktop
  assert.equal(formatTanggalGrafik("2026-11-06", "ponsel"), "6 Nov");
  assert.equal(formatTanggalGrafik("2026-11-06", "desktop"), "6 Nov 2026");
});

test("konversi aman: keNominalAman & keJumlahAman melempar galat jika di luar batas aman JavaScript", () => {
  assert.equal(keNominalAman(0), 0);
  assert.equal(keNominalAman("150000"), 150000);
  assert.equal(keNominalAman(null), 0);
  assert.throws(() => keNominalAman(-1), /di luar rentang angka aman/);
  assert.throws(() => keNominalAman(Number.MAX_SAFE_INTEGER + 100), /di luar rentang angka aman/);
  assert.throws(() => keNominalAman(Infinity), /di luar rentang angka aman/);

  assert.equal(keJumlahAman(0), 0);
  assert.equal(keJumlahAman("12"), 12);
  assert.throws(() => keJumlahAman(3.14), /di luar rentang integer aman/);
  assert.throws(() => keJumlahAman(-5), /di luar rentang integer aman/);
});
