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

// ---------- 2. Fixture Nyata & Hitungan Angka Manual ----------

test("laporan harian operasional: hitungan manual vs SQL agregat pada tiket multi-barang, lunas/belum, dibatalkan, dibalik, dan beda tanggal bayar", async () => {
  // Ambil tanggal hari ini dan kemarin dari jam database zona Asia/Jakarta
  const waktuDbRes = await adminPool.query(`
    SELECT
      (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS hari_ini_db,
      ((now() AT TIME ZONE 'Asia/Jakarta')::date - 1)::text AS kemarin_db,
      ((now() AT TIME ZONE 'Asia/Jakarta')::date + 1)::text AS besok_db
  `);
  const { hari_ini_db, kemarin_db, besok_db } = waktuDbRes.rows[0];

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

  // --- Fixture 1: Tiket Multi-barang (Hari Ini, Lunas Cash) ---
  // Layanan 1: 2 pasang x harga1
  // Layanan 2: 3 pasang x harga2
  // Total: 5 pasang
  const h1 = layanan1.harga;
  const h2 = layanan2.harga;
  await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sneakers Hitam", jumlah: 2 },
      { service_id: layanan2.id, deskripsi_barang: "Boots Kulit", jumlah: 3 },
    ],
  });
  const t1_pasang = 5;
  const t1_nominal = 2 * h1 + 3 * h2;

  // --- Fixture 2: Tiket Single-barang (Hari Ini, Lunas Non-cash) ---
  // Layanan 1: 1 pasang x harga1
  await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Slip-on Putih", jumlah: 1 },
    ],
  });
  const t2_pasang = 1;
  const t2_nominal = 1 * h1;

  // Helper khusus admin untuk mengatur tanggal_masuk pada fixture tanggal lampau/depan di DB uji
  async function setTanggalMasukAdmin(orderId, tglWibString) {
    await adminPool.query(`ALTER TABLE orders DISABLE TRIGGER orders_proteksi_update`);
    await adminPool.query(
      `UPDATE orders SET tanggal_masuk = $1::timestamptz WHERE id = $2`,
      [tglWibString, orderId]
    );
    await adminPool.query(`ALTER TABLE orders ENABLE TRIGGER orders_proteksi_update`);
  }

  // --- Fixture 3: Tiket Multi-barang Batas Waktu 00:01:00 WIB Hari Ini ---
  // Masuk 1 menit setelah tengah malam WIB (tanggal berbeda di UTC dan WIB).
  // Di WIB: tanggal hari ini (${hari_ini_db}). Di UTC: tanggal kemarin (${kemarin_db} 17:01:00Z).
  const t3 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan2.id, deskripsi_barang: "Running Shoes", jumlah: 2 },
    ],
  });
  await setTanggalMasukAdmin(t3.id, `${hari_ini_db} 00:01:00+07`);
  const t3_pasang = 2;
  const t3_nominal = 2 * h2;

  // --- Fixture 4: Tiket Dibatalkan Sebelum Lunas (Hari Ini) ---
  // Masuk hari ini lalu dibatalkan. Wajib DIKECUALIKAN dari pesanan masuk & pembayaran!
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

  // --- Fixture 5: Tiket Sempat Lunas Lalu Dibatalkan (Hari Ini) ---
  // Dibayar lunas Cash, lalu dibatalkan dengan konfirmasi lunas.
  // Wajib DIKECUALIKAN dari a-c, tapi tercatat di audit tiket_batal_setelah_lunas (jumlah saja).
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

  // --- Fixture 6: Pembalikan Pembayaran Lunas -> Belum bayar (Hari Ini) ---
  // Dibayar Lunas, lalu dibalik ke Belum bayar dengan alasan.
  // Masuk pesanan hari ini sebagai Belum bayar, tercatat di audit pembalikan_pembayaran.
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
  const t6_pasang = 1;
  const t6_nominal = 1 * h1;

  // --- Fixture 7: Tiket Masuk Kemarin tapi Dibayar Hari Ini (Non-cash) ---
  // Masuk kemarin (diatur via SQL admin), dibayar hari ini via API PATCH.
  // Pesanan masuk masuk ke laporan kemarin, Pembayaran diterima masuk ke laporan hari ini!
  const t7 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan2.id, deskripsi_barang: "Sepatu Kemarin", jumlah: 2 },
    ],
  });
  await setTanggalMasukAdmin(t7.id, `${kemarin_db} 10:00:00+07`);
  // Bayar hari ini
  const bayarT7 = await api(kasirCookie, "PATCH", `/api/tiket/${t7.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(bayarT7.res.status, 200, "Bayar T7 harus 200");
  const t7_pasang = 2;
  const t7_nominal = 2 * h2;

  // --- Fixture 8: Tiket Batas Waktu 23:59:00 WIB Hari Ini ---
  // Masuk 1 menit sebelum pergantian hari WIB
  const t8 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sepatu Malam WIB", jumlah: 1 },
    ],
  });
  await setTanggalMasukAdmin(t8.id, `${hari_ini_db} 23:59:00+07`);
  const t8_pasang = 1;
  const t8_nominal = 1 * h1;

  // --- Fixture 9: Tiket Batas Waktu Besok Siang WIB ---
  // Masuk besok siang di kedua zona (kohort besok)
  const t9 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: layanan1.id, deskripsi_barang: "Sepatu Besok WIB", jumlah: 1 },
    ],
  });
  await setTanggalMasukAdmin(t9.id, `${besok_db} 12:00:00+07`);

  // --- Fixture 10: Bukti Harga Katalog Berubah Tidak Mengubah Tiket Lama ---
  // Perbarui harga layanan1 di katalog menjadi 2x lipat
  await adminPool.query(`UPDATE services SET harga = harga + 20000 WHERE id = $1`, [layanan1.id]);

  // HITUNGAN MANUAL KONSTANTA EKSPEKTASI:
  // Pesanan masuk HARI INI (aktif & bukan dibatalkan):
  // Yang sah masuk hari ini: T1, T2, T3, T6, T8. (T4 & T5 batal; T7 kemarin; T9 besok)
  const EXPECT_TIKET_MASUK = 5;
  const EXPECT_PASANG_MASUK = t1_pasang + t2_pasang + t3_pasang + t6_pasang + t8_pasang; // 5 + 1 + 2 + 1 + 1 = 10
  const EXPECT_NOMINAL_MASUK = t1_nominal + t2_nominal + t3_nominal + t6_nominal + t8_nominal;

  // Dari pesanan masuk hari ini:
  // Lunas: T1 (Cash), T2 (Non-cash)
  const EXPECT_TIKET_LUNAS = 2;
  const EXPECT_PASANG_LUNAS = t1_pasang + t2_pasang; // 5 + 1 = 6
  const EXPECT_NOMINAL_LUNAS = t1_nominal + t2_nominal;

  // Belum bayar: T3, T6, T8
  const EXPECT_TIKET_BELUM = 3;
  const EXPECT_PASANG_BELUM = t3_pasang + t6_pasang + t8_pasang; // 2 + 1 + 1 = 4
  const EXPECT_NOMINAL_BELUM = t3_nominal + t6_nominal + t8_nominal;

  // Pembayaran diterima HARI INI (kohort tanggal_bayar hari ini untuk tiket lunas aktif):
  // T1 (Cash, hari ini), T2 (Non-cash, hari ini), T7 (Non-cash, masuk kemarin tapi bayar hari ini!)
  // (T5 sudah dibatalkan, T6 dibalik jadi tanggal_bayar NULL)
  const EXPECT_BAYAR_TIKET = 3;
  const EXPECT_BAYAR_NOMINAL = t1_nominal + t2_nominal + t7_nominal;
  const EXPECT_CASH_TIKET = 1;
  const EXPECT_CASH_NOMINAL = t1_nominal;
  const EXPECT_NON_CASH_TIKET = 2;
  const EXPECT_NON_CASH_NOMINAL = t2_nominal + t7_nominal;

  // Aktivitas Audit hari ini:
  // Tiket dibatalkan: T4, T5 = 2
  // Batal setelah sempat lunas: T5 = 1 (tanpa nominal)
  // Pembalikan pembayaran: T6 = 1
  const EXPECT_AUDIT_BATAL = 2;
  const EXPECT_AUDIT_BATAL_SEMPAT_LUNAS = 1;
  const EXPECT_AUDIT_PEMBALIKAN = 1;

  // Panggil kode produksi ambilLaporanHarian untuk Hari Ini
  const lapHariIni = await ambilLaporanHarian({
    periode: "hari_ini",
    dari: "",
    sampai: "",
  }, appPool);

  // Penegasan Hasil Kode Produksi vs Konstanta Hitungan Manual
  assert.equal(lapHariIni.pesanan_masuk.total_tiket, EXPECT_TIKET_MASUK, "Total tiket masuk hari ini");
  assert.equal(lapHariIni.pesanan_masuk.total_pasang, EXPECT_PASANG_MASUK, "Total pasang masuk hari ini");
  assert.equal(lapHariIni.pesanan_masuk.total_nominal, EXPECT_NOMINAL_MASUK, "Total nominal masuk hari ini");

  assert.equal(lapHariIni.pesanan_masuk.lunas.total_tiket, EXPECT_TIKET_LUNAS, "Tiket lunas hari ini");
  assert.equal(lapHariIni.pesanan_masuk.lunas.total_pasang, EXPECT_PASANG_LUNAS, "Pasang lunas hari ini");
  assert.equal(lapHariIni.pesanan_masuk.lunas.total_nominal, EXPECT_NOMINAL_LUNAS, "Nominal lunas hari ini");

  assert.equal(lapHariIni.pesanan_masuk.belum_bayar.total_tiket, EXPECT_TIKET_BELUM, "Tiket belum bayar hari ini");
  assert.equal(lapHariIni.pesanan_masuk.belum_bayar.total_pasang, EXPECT_PASANG_BELUM, "Pasang belum bayar hari ini");
  assert.equal(lapHariIni.pesanan_masuk.belum_bayar.total_nominal, EXPECT_NOMINAL_BELUM, "Nominal belum bayar hari ini");

  assert.equal(lapHariIni.pembayaran_diterima.total_tiket, EXPECT_BAYAR_TIKET, "Total tiket bayar hari ini");
  assert.equal(lapHariIni.pembayaran_diterima.total_nominal, EXPECT_BAYAR_NOMINAL, "Total nominal bayar hari ini");
  assert.equal(lapHariIni.pembayaran_diterima.cash.total_tiket, EXPECT_CASH_TIKET, "Tiket cash hari ini");
  assert.equal(lapHariIni.pembayaran_diterima.cash.total_nominal, EXPECT_CASH_NOMINAL, "Nominal cash hari ini");
  assert.equal(lapHariIni.pembayaran_diterima.non_cash.total_tiket, EXPECT_NON_CASH_TIKET, "Tiket non-cash hari ini");
  assert.equal(lapHariIni.pembayaran_diterima.non_cash.total_nominal, EXPECT_NON_CASH_NOMINAL, "Nominal non-cash hari ini");

  assert.equal(lapHariIni.audit_aktivitas.tiket_dibatalkan, EXPECT_AUDIT_BATAL, "Tiket dibatalkan audit");
  assert.equal(lapHariIni.audit_aktivitas.tiket_batal_setelah_lunas, EXPECT_AUDIT_BATAL_SEMPAT_LUNAS, "Batal sempat lunas audit");
  assert.equal(lapHariIni.audit_aktivitas.pembalikan_pembayaran, EXPECT_AUDIT_PEMBALIKAN, "Pembalikan bayar audit");

  // Periksa laporan periode kemarin: T7 harus tercatat di pesanan masuk kemarin
  const lapKemarin = await ambilLaporanHarian({
    periode: "kemarin",
    dari: "",
    sampai: "",
  }, appPool);
  assert.ok(lapKemarin.pesanan_masuk.total_pasang >= t7_pasang, "T7 harus masuk ke laporan kemarin");
});

// ---------- 3. Bukti Gagal-Lalu-Lulus via Kueri Pembanding Independen ----------

test("bukti gagal-lalu-lulus 1: kueri salah hitung per tiket menghasilkan angka salah pada tiket multi-barang, kode produksi benar", async () => {
  // KUERI PEMBANDING CACAT: Menghitung COUNT(orders.id) sebagai jumlah barang/sepatu
  const kueriSalah = await appPool.query(`
    SELECT COUNT(o.id)::int AS total_barang_cacat
    FROM orders o
    WHERE o.status_pesanan <> 'Dibatalkan'
      AND o.tanggal_masuk >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::text || ' 00:00:00+07')::timestamptz
      AND o.tanggal_masuk < (((now() AT TIME ZONE 'Asia/Jakarta')::date + 1)::text || ' 00:00:00+07')::timestamptz
  `);
  const hasilCacat = kueriSalah.rows[0].total_barang_cacat;

  // Kode produksi
  const lap = await ambilLaporanHarian({ periode: "hari_ini", dari: "", sampai: "" }, appPool);
  const hasilProduksi = lap.pesanan_masuk.total_pasang;

  // BUKTI: Kueri cacat menghasilkan 5 (jumlah tiket), padahal terdapat tiket multi-pasang (10 pasang)
  assert.notEqual(
    hasilCacat,
    hasilProduksi,
    `Kueri salah (hitung per tiket: ${hasilCacat}) gagal menangkap volume fisik sepatu multi-barang (${hasilProduksi} pasang)`
  );
  assert.equal(hasilProduksi, 10, "Kode produksi wajib tepat 10 pasang sepatu");
});

test("bukti gagal-lalu-lulus 2: kueri salah mengikutkan tiket Dibatalkan menghasilkan angka menggelembung, kode produksi benar", async () => {
  // KUERI PEMBANDING CACAT: Lupa memfilter status_pesanan <> 'Dibatalkan'
  const kueriSalah = await appPool.query(`
    SELECT COALESCE(SUM(oi.jumlah), 0)::int AS total_pasang_termasuk_batal
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.tanggal_masuk >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::text || ' 00:00:00+07')::timestamptz
      AND o.tanggal_masuk < (((now() AT TIME ZONE 'Asia/Jakarta')::date + 1)::text || ' 00:00:00+07')::timestamptz
  `);
  const hasilCacat = kueriSalah.rows[0].total_pasang_termasuk_batal;

  const lap = await ambilLaporanHarian({ periode: "hari_ini", dari: "", sampai: "" }, appPool);
  const hasilProduksi = lap.pesanan_masuk.total_pasang;

  // BUKTI: Kueri cacat mengikutkan T4 (1 pasang) & T5 (2 pasang) sehingga menjadi 13 pasang
  assert.notEqual(
    hasilCacat,
    hasilProduksi,
    `Kueri salah menggelembung karena mengikutkan tiket batal (${hasilCacat} vs ${hasilProduksi})`
  );
  assert.equal(hasilCacat, 13, "Kueri salah mencakup tiket batal (10 + 1 + 2 = 13)");
  assert.equal(hasilProduksi, 10, "Kode produksi tepat mengecualikan tiket batal (10 pasang)");
});

test("bukti gagal-lalu-lulus 3: kueri salah batas hari UTC memotong transaksi malam WIB, kode produksi benar", async () => {
  // KUERI PEMBANDING CACAT: Mengevaluasi batas hari berdasarkan zona UTC
  // Tiket T3 masuk pukul 00:01 WIB (+07:00), tanggal WIB adalah hari ini (${hari_ini_db}),
  // tetapi tanggal UTC adalah kemarin (${kemarin_db} 17:01 UTC).
  // Tiket T8 masuk pukul 23:59 WIB (+07:00), tanggal WIB hari ini dan tanggal UTC hari ini (16:59 UTC).
  // Kueri berbasis UTC kehilangan transaksi dini hari WIB (00:01 WIB) karena terpotong ke tanggal kemarin UTC.
  const kueriSalahUtc = await appPool.query(`
    SELECT COUNT(o.id)::int AS total_tiket_utc
    FROM orders o
    WHERE o.status_pesanan <> 'Dibatalkan'
      AND o.tanggal_masuk >= ((now() AT TIME ZONE 'UTC')::date::text || ' 00:00:00Z')::timestamptz
      AND o.tanggal_masuk < (((now() AT TIME ZONE 'UTC')::date + 1)::text || ' 00:00:00Z')::timestamptz
  `);
  const hitungUtc = kueriSalahUtc.rows[0].total_tiket_utc;

  const lap = await ambilLaporanHarian({ periode: "hari_ini", dari: "", sampai: "" }, appPool);
  const hitungWib = lap.pesanan_masuk.total_tiket;
  const EXPECT_MANUAL = 5; // T1, T2, T3 (00:01 WIB), T6, T8 (23:59 WIB)

  // BUKTI: Kueri cacat UTC menghasilkan 4 tiket (kehilangan tiket 00:01 WIB), berbeda dari angka manual (5 tiket).
  // Kode produksi menghasilkan tepat angka manual (5 tiket) karena konsisten menggunakan batas Asia/Jakarta.
  assert.notEqual(
    hitungUtc,
    EXPECT_MANUAL,
    `Kueri salah UTC (${hitungUtc}) berbeda dari angka manual (${EXPECT_MANUAL}) karena transaksi 00:01 WIB terlempar ke tanggal kemarin di UTC`
  );
  assert.equal(hitungUtc, 4, "Kueri salah UTC hanya mendeteksi 4 tiket");
  assert.equal(hitungWib, EXPECT_MANUAL, "Kode produksi wajib tepat 5 tiket sesuai hitungan manual zona WIB");
});

// ---------- 4. Dashboard Operasional (Kasir vs Owner, Tren 7 Hari, 5 Tiket Terbaru) ----------

test("dashboard: kasir tidak melihat nominal belum bayar & tren 7 hari null; owner melihat nominal & tren 7 hari (pasang per hari)", async () => {
  // 1. Data Dashboard Kasir
  const dashKasir = await ambilDataDashboard("kasir", appPool);
  assert.equal(dashKasir.peran, "kasir");
  assert.equal(dashKasir.tren_7_hari, null, "Kasir tidak boleh menerima data tren 7 hari");
  assert.equal(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_nominal, null, "Kasir tidak melihat nominal belum bayar");
  assert.ok(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_tiket >= 3);
  assert.ok(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.total_pasang >= 4);
  assert.equal(dashKasir.ringkasan_hari_ini.belum_bayar_aktif.label, "Belum bayar (semua tiket aktif)");

  // 2. Data Dashboard Owner
  const dashOwner = await ambilDataDashboard("owner", appPool);
  assert.equal(dashOwner.peran, "owner");
  assert.ok(dashOwner.tren_7_hari !== null, "Owner wajib menerima data tren 7 hari");
  assert.equal(dashOwner.tren_7_hari.length, 7, "Tren wajib memiliki tepat 7 titik harian berakhir hari ini");
  assert.ok(typeof dashOwner.ringkasan_hari_ini.belum_bayar_aktif.total_nominal === "number");

  // Tren hari terakhir (hari ini) harus memuat jumlah pasang sepatu hari ini
  const titikHariIni = dashOwner.tren_7_hari[6];
  assert.equal(titikHariIni.tanggal, dashOwner.hari_ini);
  assert.ok(titikHariIni.jumlah_pasang >= 10, "Tren hari ini menggunakan JUMLAH PASANG per hari");

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
  assert.match(htmlOwner.html, /Buka Laporan Harian/i);
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
