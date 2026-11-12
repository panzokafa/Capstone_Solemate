// Tes Phase 7B: Rekap Bulanan (FR-50, FR-51, FR-52, FR-03, NFR-07).
// Menegakkan otorisasi owner-only, pintasan bulan_ini & bulan_lalu pada tanggal acuan DB terkendali,
// rentang bebas (366 lolos vs 367 ditolak), pengelompokan service_id, tie-break peringkat,
// baris Lainnya (total & pembulatan tepat 100,0%), XSS escaping, tes silang 7A vs 7B,
// serta 4 bukti gagal-lalu-lulus via kueri pembanding cacat HANYA di berkas tes ini.
//
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/rekap-7b.test.mjs'

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import {
  validasiQueryRekapBulanan,
  hitungRentangPintasanRekap,
  ambilRekapBulanan,
  ambilLaporanHarian,
} from "../src/lib/laporan.ts";
import { hitungPersentaseSatuDesimal, hitungPersentaseLainnya } from "../src/config/laporan.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner 7B ${Date.now()}`;
const KASIR_NAMA = `Kasir 7B ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let adminPool;
let appPool;
let ownerCookie;
let kasirCookie;

let urutWa = 8000;
function waUnik08() {
  urutWa += 1;
  return `08138800${String(urutWa).padStart(4, "0")}`;
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

  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);
});

after(async () => {
  if (adminPool) await adminPool.end();
  if (appPool) await appPool.end();
});

// ---------- 1. Otorisasi, Keamanan Rute, Privasi, & Anti-Cache ----------

test("otorisasi & keamanan rekap bulanan: hanya owner, kasir ditolak, tanpa login redirect, no-store, tanpa ekspor/PII", async () => {
  // API tanpa login -> 307 ke /login
  const apiAnon = await api(null, "GET", "/api/rekap-bulanan");
  assert.equal(apiAnon.res.status, 307);

  // API kasir -> 403
  const apiKasir = await api(kasirCookie, "GET", "/api/rekap-bulanan");
  assert.equal(apiKasir.res.status, 403);
  assert.equal(apiKasir.data?.error, "Akses ditolak");

  // API owner -> 200 + Cache-Control no-store & Vary Cookie + tanpa PII + Laba Rugi belum tersedia
  const apiOwner = await api(ownerCookie, "GET", "/api/rekap-bulanan");
  assert.equal(apiOwner.res.status, 200);
  assert.equal(apiOwner.data?.ok, true);
  assert.equal(apiOwner.data?.data?.laba_rugi?.tersedia, false);
  assert.equal(
    apiOwner.data?.data?.laba_rugi?.pesan,
    "Belum tersedia: sumber data pengeluaran belum ditentukan"
  );

  const cacheCtrl = apiOwner.res.headers.get("cache-control") ?? "";
  assert.match(cacheCtrl, /no-store/i);
  assert.match(cacheCtrl, /no-cache/i);
  assert.match(cacheCtrl, /private/i);
  const vary = apiOwner.res.headers.get("vary") ?? "";
  assert.match(vary, /cookie/i);

  const jsonStr = JSON.stringify(apiOwner.data);
  assert.doesNotMatch(jsonStr, /"nama_pelanggan"/i);
  assert.doesNotMatch(jsonStr, /"nomor_wa"/i);

  // Metode mutasi -> 405
  const postRes = await api(ownerCookie, "POST", "/api/rekap-bulanan", { nominal: 999999 });
  assert.equal(postRes.res.status, 405);
  const patchRes = await api(ownerCookie, "PATCH", "/api/rekap-bulanan", { nominal: 1 });
  assert.equal(patchRes.res.status, 405);
  const delRes = await api(ownerCookie, "DELETE", "/api/rekap-bulanan");
  assert.equal(delRes.res.status, 405);

  // SSR /rekap-bulanan
  const ssrAnon = await ambilHtml(null, "/rekap-bulanan");
  assert.equal(ssrAnon.res.status, 307);

  const ssrKasir = await ambilHtml(kasirCookie, "/rekap-bulanan");
  assert.equal(ssrKasir.res.status, 200);
  assert.match(ssrKasir.html, /Akses Ditolak/i);

  const ssrOwner = await ambilHtml(ownerCookie, "/rekap-bulanan");
  assert.equal(ssrOwner.res.status, 200);
  assert.match(ssrOwner.html, /Rekap Bulanan/i);
  assert.match(ssrOwner.html, /Dihitung otomatis dari data tiket/i);
  assert.match(ssrOwner.html, /Angka dihitung dari data tiket saat ini/i);
  assert.match(ssrOwner.html, /Belum tersedia: sumber data pengeluaran belum ditentukan/i);
  assert.doesNotMatch(ssrOwner.html, /Ekspor Data/i, "Tidak boleh ada tombol ekspor");
});

// ---------- 2. Validasi Parameter Query & Rentang 366 vs 367 Hari ----------

test("validasi query rekap bulanan: parameter asing/ganda, tanggal invalid, dari > sampai, 366 lolos & 367 ditolak", async () => {
  // Parameter asing (termasuk percobaan menyusupkan tanggalAcuan lewat URL)
  const vAsing = validasiQueryRekapBulanan(new URLSearchParams("periode=bulan_ini&tanggalAcuan=2020-01-01"));
  assert.equal(vAsing.ok, false);
  assert.equal(vAsing.kode, 400);

  // Parameter ganda
  const vGanda = validasiQueryRekapBulanan(new URLSearchParams("periode=bulan_ini&periode=bulan_lalu"));
  assert.equal(vGanda.ok, false);
  assert.equal(vGanda.kode, 400);

  // dari/sampai dipakai pada bulan_ini
  const vCampur = validasiQueryRekapBulanan(new URLSearchParams("periode=bulan_ini&dari=2026-08-01"));
  assert.equal(vCampur.ok, false);
  assert.equal(vCampur.kode, 400);

  // Tanggal invalid kalender
  const vKalender = validasiQueryRekapBulanan(
    new URLSearchParams("periode=rentang&dari=2026-02-29&sampai=2026-03-01")
  );
  assert.equal(vKalender.ok, false);
  assert.equal(vKalender.kode, 400);

  // dari > sampai
  const vMundur = validasiQueryRekapBulanan(
    new URLSearchParams("periode=rentang&dari=2026-08-15&sampai=2026-08-10")
  );
  assert.equal(vMundur.ok, false);
  assert.equal(vMundur.kode, 400);

  // Rentang 367 hari ditolak (400 di fungsi dan HTTP API)
  const v367 = validasiQueryRekapBulanan(
    new URLSearchParams("periode=rentang&dari=2025-01-01&sampai=2026-01-03")
  );
  assert.equal(v367.ok, false);
  assert.equal(v367.kode, 400);
  const api367 = await api(
    ownerCookie,
    "GET",
    "/api/rekap-bulanan?periode=rentang&dari=2025-01-01&sampai=2026-01-03"
  );
  assert.equal(api367.res.status, 400);

  // Rentang tepat 366 hari lolos (200 di fungsi dan HTTP API)
  const v366 = validasiQueryRekapBulanan(
    new URLSearchParams("periode=rentang&dari=2025-01-01&sampai=2026-01-02")
  );
  assert.equal(v366.ok, true);
  const api366 = await api(
    ownerCookie,
    "GET",
    "/api/rekap-bulanan?periode=rentang&dari=2025-01-01&sampai=2026-01-02"
  );
  assert.equal(api366.res.status, 200);

  // Rentang 1 hari yang sama (dari === sampai) lolos
  const v1Hari = validasiQueryRekapBulanan(
    new URLSearchParams("dari=2026-08-01&sampai=2026-08-01")
  );
  assert.equal(v1Hari.ok, true);
  if (v1Hari.ok) {
    assert.equal(v1Hari.data.periode, "rentang");
    assert.equal(v1Hari.data.dari, "2026-08-01");
    assert.equal(v1Hari.data.sampai, "2026-08-01");
  }
});

// ---------- 3. Pintasan Bulan Ini & Bulan Lalu pada Tanggal Acuan Database Terkendali ----------

test("pintasan bulan_ini & bulan_lalu akurat pada tanggal acuan: 1 Jan, 1 Mar (kabisat & non), 31 Mar, 30 Apr, tgl 1", async () => {
  // 1 Januari 2026 (juga tanggal 1 -> bulan_ini tepat 1 hari, bulan_lalu = Desember 2025)
  const jan1Ini = await hitungRentangPintasanRekap("bulan_ini", appPool, "2026-01-01");
  const jan1Lalu = await hitungRentangPintasanRekap("bulan_lalu", appPool, "2026-01-01");
  assert.deepEqual(jan1Ini, { dari: "2026-01-01", sampai: "2026-01-01", hari_ini: "2026-01-01" });
  assert.deepEqual(jan1Lalu, { dari: "2025-12-01", sampai: "2025-12-31", hari_ini: "2026-01-01" });

  // 1 Maret 2024 (tahun kabisat -> bulan_lalu s/d 29 Feb 2024; bulan_ini = 1 hari)
  const mar1KabisatIni = await hitungRentangPintasanRekap("bulan_ini", appPool, "2024-03-01");
  const mar1KabisatLalu = await hitungRentangPintasanRekap("bulan_lalu", appPool, "2024-03-01");
  assert.deepEqual(mar1KabisatIni, { dari: "2024-03-01", sampai: "2024-03-01", hari_ini: "2024-03-01" });
  assert.deepEqual(mar1KabisatLalu, { dari: "2024-02-01", sampai: "2024-02-29", hari_ini: "2024-03-01" });

  // 1 Maret 2026 (bukan kabisat -> bulan_lalu s/d 28 Feb 2026)
  const mar1NonKabisatIni = await hitungRentangPintasanRekap("bulan_ini", appPool, "2026-03-01");
  const mar1NonKabisatLalu = await hitungRentangPintasanRekap("bulan_lalu", appPool, "2026-03-01");
  assert.deepEqual(mar1NonKabisatIni, { dari: "2026-03-01", sampai: "2026-03-01", hari_ini: "2026-03-01" });
  assert.deepEqual(mar1NonKabisatLalu, { dari: "2026-02-01", sampai: "2026-02-28", hari_ini: "2026-03-01" });

  // 31 Maret 2026 -> bulan_ini 1..31 Mar, bulan_lalu 1..28 Feb (tidak terpeleset karena date_trunc)
  const mar31Ini = await hitungRentangPintasanRekap("bulan_ini", appPool, "2026-03-31");
  const mar31Lalu = await hitungRentangPintasanRekap("bulan_lalu", appPool, "2026-03-31");
  assert.deepEqual(mar31Ini, { dari: "2026-03-01", sampai: "2026-03-31", hari_ini: "2026-03-31" });
  assert.deepEqual(mar31Lalu, { dari: "2026-02-01", sampai: "2026-02-28", hari_ini: "2026-03-31" });

  // 30 April 2026 -> bulan_ini 1..30 Apr, bulan_lalu 1..31 Mar
  const apr30Ini = await hitungRentangPintasanRekap("bulan_ini", appPool, "2026-04-30");
  const apr30Lalu = await hitungRentangPintasanRekap("bulan_lalu", appPool, "2026-04-30");
  assert.deepEqual(apr30Ini, { dari: "2026-04-01", sampai: "2026-04-30", hari_ini: "2026-04-30" });
  assert.deepEqual(apr30Lalu, { dari: "2026-03-01", sampai: "2026-03-31", hari_ini: "2026-04-30" });
});

// ---------- 4. Fixture Kompleks Bulan Agustus 2026 + Hitungan Manual + Bukti Gagal-Lalu-Lulus ----------

test("rekap bulanan lengkap, tes silang 7A, XSS, layanan kembar nonaktif, >10 layanan, dan 4 bukti gagal-lalu-lulus", async () => {
  async function buatLayanan(nama, harga, estimasi_hari = 2) {
    const { res, data } = await api(ownerCookie, "POST", "/api/katalog", {
      nama,
      harga,
      estimasi_hari,
    });
    assert.equal(res.status, 201, `Gagal buat layanan ${nama}: ${JSON.stringify(data)}`);
    return data.data;
  }

  async function buatTiket(params) {
    const { res, data } = await api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: "Pelanggan Rekap 7B",
      nomor_wa: waUnik08(),
      status_bayar: params.status_bayar ?? "Belum bayar",
      ...(params.metode_bayar ? { metode_bayar: params.metode_bayar } : {}),
      items: params.items,
    });
    assert.equal(res.status, 201, `Buat tiket gagal: ${JSON.stringify(data)}`);
    return data.data;
  }

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

  async function setWaktuAuditLayananAdmin(serviceId, aksi, waktuWib) {
    await adminPool.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_blokir_update`);
    await adminPool.query(
      `UPDATE audit_logs SET waktu = $1::timestamptz
        WHERE entitas = 'services' AND entitas_id = $2 AND aksi = $3`,
      [waktuWib, serviceId, aksi]
    );
    await adminPool.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_blokir_update`);
  }

  // --- Buat 12 Layanan Unik untuk Periode Agustus 2026 (2026-08-01 .. 2026-08-31) ---
  const suf = Date.now();
  const namaAlphaLama = `01 Alpha Lama ${suf}`;
  const s1 = await buatLayanan(namaAlphaLama, 30_000);
  const s2 = await buatLayanan(`02 Beta Boost ${suf}`, 50_000);
  const s3 = await buatLayanan(`03 Charlie Canvas ${suf}`, 25_000);
  const s4 = await buatLayanan(`04 Gamma Wash ${suf}`, 25_000);

  // S5 & S6: Nama sama (case-variant legal di DB 0005), S5 dipakai di tiket lalu dinonaktifkan
  // sebelum S6 dibuat (indeks services_nama_aktif_unik melarang dua nama aktif bersamaan),
  // sehingga S5 (nonaktif) dan S6 (aktif) punya service_id berbeda & wajib tampil DUA baris terpisah.
  // (Catatan skema DB: CONSTRAINT services_uniq_nama di 0001_init menegakkan keunikan tepat case-sensitive pada kolom nama.)
  const s5 = await buatLayanan(`Paket Duplikat ${suf}`, 40_000);
  const t3s5 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: s5.id, deskripsi_barang: "S5 Nonaktif", jumlah: 3 },
    ],
  });
  await setWaktuTiketAdmin(t3s5.id, "2026-08-15 09:00:00+07", "2026-09-02 09:00:00+07");
  const resNonaktifS5 = await api(ownerCookie, "PATCH", `/api/katalog/${s5.id}`, { aktif: false });
  assert.equal(resNonaktifS5.res.status, 200);

  const s6 = await buatLayanan(`paket duplikat ${suf}`, 35_000);

  const s7 = await buatLayanan(`07 Delta Care ${suf}`, 20_000);
  const s8 = await buatLayanan(`08 Echo Care ${suf}`, 19_000);
  const s9 = await buatLayanan(`09 Foxtrot Care ${suf}`, 18_000);
  const s10 = await buatLayanan(`10 Hotel Care ${suf}`, 17_000);
  const s11 = await buatLayanan(`11 India Care ${suf}`, 15_000);
  const s12 = await buatLayanan(`12 Juliet Care ${suf}`, 10_000);

  // --- Tiket 1a: Batas Awal 2026-08-01 00:01 WIB (sebelum S1 diganti nama), Lunas Cash ---
  const t1a = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: s1.id, deskripsi_barang: "S1 Paket A", jumlah: 4 },
      { service_id: s7.id, deskripsi_barang: "S7 Sepatu", jumlah: 2 },
    ],
  });
  await setWaktuTiketAdmin(t1a.id, "2026-08-01 00:01:00+07", "2026-08-01 00:01:00+07");

  // --- Ganti nama S1 pada 2026-08-01 18:00 WIB menjadi mengandung <script>alert('xss')</script> ---
  const namaXss = `<script>alert('xss')</script> Alpha ${suf}`;
  const resRenameS1 = await api(ownerCookie, "PUT", `/api/katalog/${s1.id}`, {
    nama: namaXss,
    harga: 30_000,
    estimasi_hari: 2,
  });
  assert.equal(resRenameS1.res.status, 200);
  await setWaktuAuditLayananAdmin(s1.id, "UBAH_LAYANAN", "2026-08-01 18:00:00+07");

  // --- Tiket 1b: 2026-08-02 10:00 WIB (setelah S1 diganti nama, 2 pasang lagi -> total S1 = 6 pasang across 2 tiket) ---
  const t1b = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: s1.id, deskripsi_barang: "S1 Paket B", jumlah: 2 },
    ],
  });
  await setWaktuTiketAdmin(t1b.id, "2026-08-02 10:00:00+07", "2026-08-02 10:00:00+07");

  // --- Tiket 2a, 2b, 2c: S2 dalam 3 tiket terpisah (2 + 1 + 1 = 4 pasang, 200k) ---
  // Jumlah TIKET S2 (3 tiket) > jumlah TIKET S1 (2 tiket), padahal PASANG S1 (6) > PASANG S2 (4)!
  const t2a = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    items: [
      { service_id: s2.id, deskripsi_barang: "S2 Bag 1", jumlah: 2 },
    ],
  });
  await setWaktuTiketAdmin(t2a.id, "2026-08-05 12:00:00+07", "2026-08-05 12:00:00+07");

  const t2b = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: s2.id, deskripsi_barang: "S2 Bag 2", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t2b.id, "2026-08-06 14:00:00+07");

  const t2c = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: s2.id, deskripsi_barang: "S2 Bag 3", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t2c.id, "2026-08-07 14:00:00+07");

  // --- Tiket 3: Multi-layanan S3 (4 psg), S4 (4 psg), S6 aktif (3 psg) pada 2026-08-15 ---
  // Bersama t3s5 (S5 nonaktif, 3 psg), kedua tiket masuk Agustus tapi dibayar SEPTEMBER (2026-09-02)!
  // Akibatnya: pesanan masuk Agustus berstatus Lunas di live state,
  // namun Pembayaran Diterima (kohort tanggal_bayar) Agustus TIDAK menghitungnya!
  const t3 = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    items: [
      { service_id: s3.id, deskripsi_barang: "S3", jumlah: 4 },
      { service_id: s4.id, deskripsi_barang: "S4", jumlah: 4 },
      { service_id: s6.id, deskripsi_barang: "S6 Aktif", jumlah: 3 },
    ],
  });
  await setWaktuTiketAdmin(t3.id, "2026-08-15 10:00:00+07", "2026-09-02 10:00:00+07");

  // --- Tiket 4: Batas Akhir Inklusif 2026-08-31 23:59 WIB (Belum bayar), berisi S8..S12 ---
  const t4 = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: s8.id, deskripsi_barang: "S8", jumlah: 2 },
      { service_id: s9.id, deskripsi_barang: "S9", jumlah: 2 },
      { service_id: s10.id, deskripsi_barang: "S10", jumlah: 2 },
      { service_id: s11.id, deskripsi_barang: "S11", jumlah: 1 },
      { service_id: s12.id, deskripsi_barang: "S12", jumlah: 1 },
    ],
  });
  await setWaktuTiketAdmin(t4.id, "2026-08-31 23:59:00+07");

  // --- Tiket 5 (Dibatalkan pada Agustus): 5 pasang S12 (harus DIKECUALIKAN di semua angka!) ---
  const t5Batal = await buatTiket({
    status_bayar: "Belum bayar",
    items: [
      { service_id: s12.id, deskripsi_barang: "Batal S12", jumlah: 5 },
    ],
  });
  const resBatal = await api(kasirCookie, "PATCH", `/api/tiket/${t5Batal.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan batal sebelum cuci",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(resBatal.res.status, 200);
  await setWaktuTiketAdmin(t5Batal.id, "2026-08-12 10:00:00+07");

  // --- Tiket 6 (Masuk JULI 2026-07-31 23:59 WIB, dibayar AGUSTUS 2026-08-10 Non-cash) ---
  // Pesanan masuk TIDAK masuk Agustus, tetapi Pembayaran Diterima Non-cash MASUK Agustus!
  const t6JuliBayarAgustus = await buatTiket({
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    items: [
      { service_id: s10.id, deskripsi_barang: "Sepatu Juli", jumlah: 3 },
    ],
  });
  await setWaktuTiketAdmin(
    t6JuliBayarAgustus.id,
    "2026-07-31 23:59:00+07",
    "2026-08-10 10:00:00+07"
  );

  // --- Naikkan harga katalog S1 menjadi 90.000 SETELAH seluruh tiket dibuat ---
  const resHargaS1 = await api(ownerCookie, "PUT", `/api/katalog/${s1.id}`, {
    nama: namaXss,
    harga: 90_000,
    estimasi_hari: 2,
  });
  assert.equal(resHargaS1.res.status, 200);

  // ============ HITUNGAN MANUAL KONSTANTA EKSPEKTASI AGUSTUS 2026 ============
  // Tiket masuk sah di Agustus: T1a, T1b, T2a, T2b, T2c, T3s5, T3, T4 = 8 tiket (T5 batal; T6 Juli)
  const EXPECT_TIKET_MASUK = 8;
  const EXPECT_PASANG_MASUK = (4 + 2) + 2 + 2 + 1 + 1 + (3 + 4 + 4 + 3) + (2 + 2 + 2 + 1 + 1); // 34 pasang
  const nomT1a = 4 * 30_000 + 2 * 20_000; // 160_000
  const nomT1b = 2 * 30_000; // 60_000
  const nomT2a = 2 * 50_000; // 100_000
  const nomT2b = 1 * 50_000; // 50_000
  const nomT2c = 1 * 50_000; // 50_000
  const nomT3 = 3 * 40_000 + 4 * 25_000 + 4 * 25_000 + 3 * 35_000; // 425_000 (T3s5 + T3)
  const nomT4 = 2 * 19_000 + 2 * 18_000 + 2 * 17_000 + 1 * 15_000 + 1 * 10_000; // 133_000
  const EXPECT_NOMINAL_MASUK = nomT1a + nomT1b + nomT2a + nomT2b + nomT2c + nomT3 + nomT4; // 978_000

  // Dari pesanan masuk Agustus: Lunas = T1a, T1b, T2a, T3s5, T3 -> 5 tiket, 24 pasang, 745_000
  const EXPECT_TIKET_LUNAS = 5;
  const EXPECT_PASANG_LUNAS = 6 + 2 + 2 + 14; // 24
  const EXPECT_NOMINAL_LUNAS = nomT1a + nomT1b + nomT2a + nomT3; // 745_000

  // Belum bayar = T2b, T2c, T4 -> 3 tiket, 10 pasang, 233_000
  const EXPECT_TIKET_BELUM = 3;
  const EXPECT_PASANG_BELUM = 1 + 1 + 8; // 10
  const EXPECT_NOMINAL_BELUM = nomT2b + nomT2c + nomT4; // 233_000

  // Pembayaran Diterima menurut tanggal_bayar di Agustus:
  // T1a (Cash, 160_000), T1b (Cash, 60_000), T2a (Non-cash, 100_000), T6JuliBayarAgustus (Non-cash, 3 * 17_000 = 51_000)
  // T3 masuk Agustus tapi dibayar September -> TIDAK masuk pembayaran diterima Agustus!
  const EXPECT_BAYAR_TIKET = 4;
  const EXPECT_CASH_TIKET = 2;
  const EXPECT_CASH_NOMINAL = nomT1a + nomT1b; // 220_000
  const EXPECT_NON_CASH_TIKET = 2;
  const EXPECT_NON_CASH_NOMINAL = nomT2a + 3 * 17_000; // 151_000
  const EXPECT_BAYAR_NOMINAL = EXPECT_CASH_NOMINAL + EXPECT_NON_CASH_NOMINAL; // 371_000

  // Jalankan Rekap Bulanan via rentang tanggal 2026-08-01 .. 2026-08-31
  const rekap = await ambilRekapBulanan(
    { periode: "rentang", dari: "2026-08-01", sampai: "2026-08-31" },
    appPool
  );

  assert.equal(rekap.pesanan_masuk.total_tiket, EXPECT_TIKET_MASUK);
  assert.equal(rekap.pesanan_masuk.total_pasang, EXPECT_PASANG_MASUK);
  assert.equal(rekap.pesanan_masuk.total_nominal, EXPECT_NOMINAL_MASUK);
  assert.equal(rekap.pesanan_masuk.lunas.total_tiket, EXPECT_TIKET_LUNAS);
  assert.equal(rekap.pesanan_masuk.lunas.total_pasang, EXPECT_PASANG_LUNAS);
  assert.equal(rekap.pesanan_masuk.lunas.total_nominal, EXPECT_NOMINAL_LUNAS);
  assert.equal(rekap.pesanan_masuk.belum_bayar.total_tiket, EXPECT_TIKET_BELUM);
  assert.equal(rekap.pesanan_masuk.belum_bayar.total_pasang, EXPECT_PASANG_BELUM);
  assert.equal(rekap.pesanan_masuk.belum_bayar.total_nominal, EXPECT_NOMINAL_BELUM);

  assert.equal(rekap.pembayaran_diterima.total_tiket, EXPECT_BAYAR_TIKET);
  assert.equal(rekap.pembayaran_diterima.total_nominal, EXPECT_BAYAR_NOMINAL);
  assert.equal(rekap.pembayaran_diterima.cash.label, "Cash tercatat di sistem");
  assert.equal(rekap.pembayaran_diterima.cash.total_tiket, EXPECT_CASH_TIKET);
  assert.equal(rekap.pembayaran_diterima.cash.total_nominal, EXPECT_CASH_NOMINAL);
  assert.equal(rekap.pembayaran_diterima.non_cash.total_tiket, EXPECT_NON_CASH_TIKET);
  assert.equal(rekap.pembayaran_diterima.non_cash.total_nominal, EXPECT_NON_CASH_NOMINAL);

  // Verifikasi Layanan Terlaris: 10 teratas + 1 baris "Lainnya" (total 11 baris dari 12 layanan unik)
  const daftar = rekap.layanan_terlaris.daftar;
  assert.equal(rekap.layanan_terlaris.jumlah_layanan_unik, 12);
  assert.equal(daftar.length, 11, "10 teratas + 1 baris Lainnya");

  // Peringkat 1: S1 memakai NAMA BARU (diganti setelah tiket) & NOMINAL LAMA (harga_saat_transaksi 30.000)
  assert.equal(daftar[0].peringkat, 1);
  assert.equal(daftar[0].service_id, s1.id);
  assert.equal(daftar[0].nama_layanan, namaXss);
  assert.equal(daftar[0].jumlah_pasang, 6);
  assert.equal(daftar[0].total_nominal, 180_000);

  // Peringkat 2, 3, 4: Pasang sama (4 psg), urut nominal menurun (200k vs 100k), lalu nama menaik (Charlie vs Gamma)
  assert.equal(daftar[1].service_id, s2.id); // 4 psg, 200k
  assert.equal(daftar[2].service_id, s3.id); // 4 psg, 100k, '03 Charlie...'
  assert.equal(daftar[3].service_id, s4.id); // 4 psg, 100k, '04 Gamma...'

  // Peringkat 5 & 6: S5 (nonaktif) dan S6 (aktif) tetap DUA baris terpisah per service_id!
  assert.equal(daftar[4].service_id, s5.id);
  assert.equal(daftar[4].aktif, false);
  assert.equal(daftar[4].jumlah_pasang, 3);
  assert.equal(daftar[5].service_id, s6.id);
  assert.equal(daftar[5].aktif, true);
  assert.equal(daftar[5].jumlah_pasang, 3);

  // Baris ke-11 adalah "Lainnya" (gabungan S11 + S12) yang total pasang, nominal, & persentasenya tepat 100,0%
  const lainnya = daftar[10];
  assert.equal(lainnya.adalah_lainnya, true);
  assert.equal(lainnya.nama_layanan, "Lainnya");
  assert.equal(lainnya.jumlah_pasang, 2); // S11 (1) + S12 (1)
  assert.equal(lainnya.total_nominal, 25_000); // 15k + 10k

  const jumlahPasangDaftar = daftar.reduce((acc, r) => acc + r.jumlah_pasang, 0);
  const jumlahNominalDaftar = daftar.reduce((acc, r) => acc + r.total_nominal, 0);
  const jumlahTenthsPersen = daftar.reduce((acc, r) => acc + Math.round(r.persentase_pasang * 10), 0);
  assert.equal(jumlahPasangDaftar, EXPECT_PASANG_MASUK, "Total pasang daftar + Lainnya wajib sama");
  assert.equal(jumlahNominalDaftar, EXPECT_NOMINAL_MASUK, "Total nominal daftar + Lainnya wajib sama");
  assert.equal(jumlahTenthsPersen, 1000, "Total persentase Top 10 + Lainnya wajib tepat 100,0%");

  // Verifikasi pintasan bulan_lalu pada tanggal acuan 2026-09-05 juga mengembalikan rekap Agustus persis sama
  const rekapViaPintasan = await ambilRekapBulanan(
    { periode: "bulan_lalu", dari: "", sampai: "" },
    appPool,
    "2026-09-05"
  );
  assert.equal(rekapViaPintasan.rentang.dari, "2026-08-01");
  assert.equal(rekapViaPintasan.rentang.sampai, "2026-08-31");
  assert.deepEqual(rekapViaPintasan.pesanan_masuk, rekap.pesanan_masuk);
  assert.deepEqual(rekapViaPintasan.pembayaran_diterima, rekap.pembayaran_diterima);

  // --- TES SILANG: Rekap Bulanan 7B vs Laporan Harian 7A pada rentang yang sama persis sama ---
  const lap7aAgustus = await ambilLaporanHarian(
    { periode: "rentang", dari: "2026-08-01", sampai: "2026-08-31" },
    appPool
  );
  assert.deepEqual(rekap.pesanan_masuk, lap7aAgustus.pesanan_masuk, "Tes silang 7B vs 7A: pesanan_masuk wajib persis sama");
  assert.deepEqual(rekap.pembayaran_diterima, lap7aAgustus.pembayaran_diterima, "Tes silang 7B vs 7A: pembayaran_diterima wajib persis sama");

  // Rentang 1 hari yang sama (2026-08-01 .. 2026-08-01)
  const rekap1Hari = await ambilRekapBulanan(
    { periode: "rentang", dari: "2026-08-01", sampai: "2026-08-01" },
    appPool
  );
  const lap7a1Hari = await ambilLaporanHarian(
    { periode: "rentang", dari: "2026-08-01", sampai: "2026-08-01" },
    appPool
  );
  assert.deepEqual(rekap1Hari.pesanan_masuk, lap7a1Hari.pesanan_masuk);
  assert.equal(rekap1Hari.pesanan_masuk.total_tiket, 1); // T1a (00:01 WIB 1 Agu)

  // Rentang tanpa data: semua nol & persentase 0 (bukan NaN)
  const rekapKosong = await ambilRekapBulanan(
    { periode: "rentang", dari: "2020-01-01", sampai: "2020-01-31" },
    appPool
  );
  assert.equal(rekapKosong.pesanan_masuk.total_tiket, 0);
  assert.equal(rekapKosong.pesanan_masuk.total_pasang, 0);
  assert.equal(rekapKosong.pesanan_masuk.total_nominal, 0);
  assert.equal(rekapKosong.pembayaran_diterima.total_nominal, 0);
  assert.equal(rekapKosong.layanan_terlaris.daftar.length, 0);
  assert.equal(hitungPersentaseSatuDesimal(0, 0), 0);

  // Verifikasi SSR HTML: XSS <script> aman (di-escape sebagai teks), penanda (nonaktif), & Lainnya tampil
  const ssrAgustus = await ambilHtml(
    ownerCookie,
    "/rekap-bulanan?periode=rentang&dari=2026-08-01&sampai=2026-08-31"
  );
  assert.equal(ssrAgustus.res.status, 200);
  assert.ok(
    !ssrAgustus.html.includes("<script>alert('xss')</script>"),
    "Tag <script> pada nama layanan tidak boleh ter-render sebagai tag HTML mentah"
  );
  assert.match(
    ssrAgustus.html,
    /&lt;script&gt;alert\((&#x27;|&#39;)xss(&#x27;|&#39;)\)&lt;\/script&gt;\s*Alpha/,
    "Nama layanan berisi <script> wajib tampil sebagai teks aman (ter-escape)"
  );
  assert.match(ssrAgustus.html, /\(nonaktif\)/);
  assert.match(ssrAgustus.html, /Lainnya/);

  // ============ 4 BUKTI GAGAL-LALU-LULUS 7B (Kueri Pembanding Cacat di Berkas Tes) ============

  // (a) Nominal memakai services.harga saat ini, bukan order_items.harga_saat_transaksi
  const qCacatA = await appPool.query(
    `SELECT SUM(oi.jumlah * s.harga)::bigint AS nominal_harga_sekarang
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN services s ON s.id = oi.service_id
      WHERE o.status_pesanan <> 'Dibatalkan'
        AND o.tanggal_masuk >= '2026-08-01 00:00:00+07'::timestamptz
        AND o.tanggal_masuk < '2026-09-01 00:00:00+07'::timestamptz
        AND s.id = $1`,
    [s1.id]
  );
  const hasilCacatA = Number(qCacatA.rows[0].nominal_harga_sekarang);
  console.log(`[Bukti 7B-a] manual=180000 | kueri_cacat_services_harga=${hasilCacatA} | produksi=${rekap.layanan_terlaris.daftar[0].total_nominal}`);
  assert.notEqual(hasilCacatA, 180_000, `Bukti-a: kueri harga katalog sekarang (${hasilCacatA}) != manual (180000)`);
  assert.equal(hasilCacatA, 540_000); // 6 * 90.000
  assert.equal(rekap.layanan_terlaris.daftar[0].total_nominal, 180_000);

  // (b) Pengelompokan layanan per nama historis alih-alih service_id memecah S1 yg diganti nama
  // (S1 dibeli sebelum rename di t1a=4 psg & sesudah rename di t1b=2 psg, sehingga GROUP BY nama memecah jadi 2 baris & total grup jadi 13)
  const qCacatB = await appPool.query(
    `WITH nama_historis AS (
       SELECT
         oi.service_id,
         oi.jumlah,
         COALESCE(
           (SELECT CASE
                     WHEN o.tanggal_masuk < al.waktu THEN al.nilai_lama->>'nama'
                     ELSE al.nilai_baru->>'nama'
                   END
              FROM audit_logs al
             WHERE al.entitas = 'services'
               AND al.entitas_id = oi.service_id
               AND al.aksi = 'UBAH_LAYANAN'
             ORDER BY al.waktu ASC
             LIMIT 1),
           s.nama
         ) AS nama_saat_pesan
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN services s ON s.id = oi.service_id
       WHERE o.status_pesanan <> 'Dibatalkan'
         AND o.tanggal_masuk >= '2026-08-01 00:00:00+07'::timestamptz
         AND o.tanggal_masuk < '2026-09-01 00:00:00+07'::timestamptz
     )
     SELECT nama_saat_pesan, SUM(jumlah)::int AS psg
       FROM nama_historis
      GROUP BY nama_saat_pesan
      ORDER BY psg DESC`
  );
  const hasilCacatBGrup = qCacatB.rows.length;
  console.log(`[Bukti 7B-b] manual_layanan_unik=12 | kueri_cacat_grup_nama=${hasilCacatBGrup} (memecah S1) | produksi=${rekap.layanan_terlaris.jumlah_layanan_unik}`);
  assert.notEqual(hasilCacatBGrup, 12, `Bukti-b: pengelompokan nama (${hasilCacatBGrup}) memecah S1 yg diganti nama`);
  assert.equal(hasilCacatBGrup, 13);
  assert.equal(rekap.layanan_terlaris.jumlah_layanan_unik, 12);

  // (c) Mengikutkan tiket Dibatalkan pada peringkat layanan
  const qCacatC = await appPool.query(
    `SELECT COALESCE(SUM(oi.jumlah), 0)::int AS pasang_termasuk_batal
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.tanggal_masuk >= '2026-08-01 00:00:00+07'::timestamptz
        AND o.tanggal_masuk < '2026-09-01 00:00:00+07'::timestamptz`
  );
  const hasilCacatC = qCacatC.rows[0].pasang_termasuk_batal;
  console.log(`[Bukti 7B-c] manual=${EXPECT_PASANG_MASUK} | kueri_cacat_ikut_dibatalkan=${hasilCacatC} | produksi=${rekap.layanan_terlaris.total_pasang}`);
  assert.notEqual(hasilCacatC, EXPECT_PASANG_MASUK, `Bukti-c: ikutkan tiket batal (${hasilCacatC}) != manual (${EXPECT_PASANG_MASUK})`);
  assert.equal(hasilCacatC, 39); // 34 + 5
  assert.equal(rekap.layanan_terlaris.total_pasang, EXPECT_PASANG_MASUK);

  // (d) Peringkat berdasarkan jumlah tiket (COUNT DISTINCT o.id), bukan jumlah pasang
  const qCacatD = await appPool.query(
    `SELECT s.id AS service_id, COUNT(DISTINCT o.id)::int AS jml_tiket
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN services s ON s.id = oi.service_id
      WHERE o.status_pesanan <> 'Dibatalkan'
        AND o.tanggal_masuk >= '2026-08-01 00:00:00+07'::timestamptz
        AND o.tanggal_masuk < '2026-09-01 00:00:00+07'::timestamptz
      GROUP BY s.id
      ORDER BY jml_tiket DESC, s.id ASC
      LIMIT 1`
  );
  const juaraCacatD = qCacatD.rows[0].service_id; // S2 punya 3 tiket, S1 cuma 2 tiket
  console.log(`[Bukti 7B-d] manual_juara_id=${s1.id} | kueri_cacat_per_tiket_id=${juaraCacatD} (${qCacatD.rows[0].jml_tiket} tiket) | produksi_juara_id=${rekap.layanan_terlaris.daftar[0].service_id}`);
  assert.notEqual(juaraCacatD, s1.id, `Bukti-d: urutan berdasar jumlah tiket memilih service_id=${juaraCacatD}, bukan S1 (${s1.id})`);
  assert.equal(juaraCacatD, s2.id);
  assert.equal(rekap.layanan_terlaris.daftar[0].service_id, s1.id);
});

// ---------- 5. Pembulatan Naik Top 10 (>100%) Tidak Pernah Membuat Baris "Lainnya" Negatif ----------

test("baris Lainnya tidak pernah negatif saat pembulatan naik pada 11 layanan melampaui 100%", async () => {
  // Verifikasi fungsi murni: 9 * 10.2 + 8.3 = 100.1% -> tanpa penjagaan menjadi -0.1%
  assert.equal(
    hitungPersentaseLainnya([10.2, 10.2, 10.2, 10.2, 10.2, 10.2, 10.2, 10.2, 10.2, 8.3], 266),
    0
  );

  // Verifikasi ujung-ke-ujung lewat database pada bulan terisolasi 2025-11:
  // 9 layanan x 27 psg (10,2%), 1 layanan x 22 psg (8,3%), 1 layanan x 1 psg -> total 266 psg.
  const suf = `${Date.now()}_nov`;
  const daftarSvc = [];
  for (let i = 1; i <= 11; i++) {
    const resSvc = await api(ownerCookie, "POST", "/api/katalog", {
      nama: `Svc Bulat ${String(i).padStart(2, "0")} ${suf}`,
      harga: 20_000,
      estimasi_hari: 1,
    });
    assert.equal(resSvc.res.status, 201);
    daftarSvc.push(resSvc.data.data);
  }

  const targetPasang = [27, 27, 27, 27, 27, 27, 27, 27, 27, 22, 1];
  for (let i = 0; i < 11; i++) {
    const qty = targetPasang[i];
    const items =
      qty > 20
        ? [
            { service_id: daftarSvc[i].id, deskripsi_barang: `Batch A ${i}`, jumlah: 20 },
            { service_id: daftarSvc[i].id, deskripsi_barang: `Batch B ${i}`, jumlah: qty - 20 },
          ]
        : [{ service_id: daftarSvc[i].id, deskripsi_barang: `Batch ${i}`, jumlah: qty }];

    const resTiket = await api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: "Pelanggan Uji Pembulatan",
      nomor_wa: waUnik08(),
      status_bayar: "Belum bayar",
      items,
    });
    assert.equal(resTiket.res.status, 201);

    await adminPool.query(`ALTER TABLE orders DISABLE TRIGGER orders_proteksi_update`);
    await adminPool.query(
      `UPDATE orders SET tanggal_masuk = '2025-11-15 12:00:00+07'::timestamptz WHERE id = $1`,
      [resTiket.data.data.id]
    );
    await adminPool.query(`ALTER TABLE orders ENABLE TRIGGER orders_proteksi_update`);
  }

  const rekapNov = await ambilRekapBulanan(
    { periode: "rentang", dari: "2025-11-01", sampai: "2025-11-30" },
    appPool
  );
  assert.equal(rekapNov.layanan_terlaris.total_pasang, 266);
  assert.equal(rekapNov.layanan_terlaris.jumlah_layanan_unik, 11);
  assert.equal(rekapNov.layanan_terlaris.daftar.length, 11); // 10 teratas + Lainnya

  const lainnya = rekapNov.layanan_terlaris.daftar[10];
  assert.equal(lainnya.adalah_lainnya, true);
  assert.equal(lainnya.jumlah_pasang, 1);
  assert.ok(
    lainnya.persentase_pasang >= 0,
    `Persentase Lainnya tidak boleh negatif (didapat ${lainnya.persentase_pasang})`
  );
  assert.equal(lainnya.persentase_pasang, 0);
});
