// Tes Phase 5A Langkah 1 (Backend Tiket Pesanan: migrasi 0007, lib, API, hak DB, privasi)
// dijalankan terhadap database sementara `solemate_test`.
//
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test tests/tiket.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import { normalisasiNomorWa, buatUrlWaMe } from "../src/lib/nomor-wa.ts";
import {
  validasiIdTiket,
  validasiBuatTiket,
  validasiCekPelanggan,
  validasiQueryDaftarTiket,
  tanggalHariIniWib,
  geserHariKalender,
} from "../src/lib/tiket-validasi.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner Tiket ${Date.now()}`;
const KASIR_NAMA = `Kasir Tiket ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let admin;
let app;
let ownerCookie;
let kasirCookie;
let layananA; // Rp 30.000, 2 hari, aktif
let layananB; // Rp 75.000, 5 hari, aktif
let layananNonaktif; // Rp 20.000, 1 hari, nonaktif

let urutWa = 1000;
function waUnik08() {
  urutWa += 1;
  return `08139900${String(urutWa).padStart(4, "0")}`;
}

async function login(username, pin) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(res.status, 200, `login ${username} harus 200, dapat ${res.status}`);
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
    // respons bukan JSON (mis. redirect)
  }
  return { res, data };
}

before(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  app = new Pool({ connectionString: process.env.DATABASE_URL_APP });

  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);

  const s1 = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Deep Clean Uji ${Date.now()}`,
    harga: 30_000,
    estimasi_hari: 2,
  });
  assert.equal(s1.res.status, 201);
  layananA = s1.data.data;

  const s2 = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Unyellowing Uji ${Date.now()}`,
    harga: 75_000,
    estimasi_hari: 5,
  });
  assert.equal(s2.res.status, 201);
  layananB = s2.data.data;

  const s3 = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Nonaktif Uji ${Date.now()}`,
    harga: 20_000,
    estimasi_hari: 1,
    aktif: false,
  });
  assert.equal(s3.res.status, 201);
  layananNonaktif = s3.data.data;
});

after(async () => {
  await app.end();
  await admin.end();
});

// ---------- 1. Peran & Akses Endpoint ----------

test("tanpa login semua API tiket mengarahkan ke /login; stub /api/buat-tiket sudah dihapus", async () => {
  for (const [metode, rute] of [
    ["GET", "/api/tiket"],
    ["POST", "/api/tiket"],
    ["GET", "/api/tiket/1"],
    ["POST", "/api/pelanggan/cek"],
  ]) {
    const { res } = await api("", metode, rute, metode === "POST" ? {} : undefined);
    assert.ok(
      res.status === 302 || res.status === 307,
      `${metode} ${rute} tanpa sesi harus redirect, dapat ${res.status}`
    );
    assert.ok(
      (res.headers.get("location") ?? "").includes("/login"),
      `${metode} ${rute} harus mengarah ke /login`
    );
  }

  const stubLama = await api(kasirCookie, "POST", "/api/buat-tiket", {});
  assert.equal(stubLama.res.status, 404, "stub /api/buat-tiket harus sudah terhapus");
});

test("kasir bisa membuat tiket & cek pelanggan; owner ditolak membuat/mengubah tetapi boleh melihat daftar & detail", async () => {
  const wa = waUnik08();
  const payload = {
    nama_pelanggan: "Raka Pratama",
    nomor_wa: wa,
    items: [
      { service_id: layananA.id, deskripsi_barang: "Nike Dunk Panda", jumlah: 1 },
    ],
    status_bayar: "Belum bayar",
  };

  // Owner ditolak di POST /api/tiket dan POST /api/pelanggan/cek (403)
  const tolakBuat = await api(ownerCookie, "POST", "/api/tiket", payload);
  assert.equal(tolakBuat.res.status, 403);
  assert.equal(tolakBuat.data?.error, "Akses ditolak");

  const tolakCek = await api(ownerCookie, "POST", "/api/pelanggan/cek", { nomor_wa: wa });
  assert.equal(tolakCek.res.status, 403);

  // Kasir berhasil membuat tiket (201)
  const buat = await api(kasirCookie, "POST", "/api/tiket", payload);
  assert.equal(buat.res.status, 201);
  assert.equal(buat.data.ok, true);
  const tiketId = buat.data.data.id;
  assert.match(buat.data.data.kode_tiket, /^SM-\d{8}-\d{3,}$/);

  // Owner bisa melihat daftar dan detail (hanya baca)
  const daftarOwner = await api(ownerCookie, "GET", "/api/tiket");
  assert.equal(daftarOwner.res.status, 200);
  assert.ok(daftarOwner.data.data.some((t) => t.id === tiketId));

  const detailOwner = await api(ownerCookie, "GET", `/api/tiket/${tiketId}`);
  assert.equal(detailOwner.res.status, 200);
  assert.equal(detailOwner.data.data.kode_tiket, buat.data.data.kode_tiket);

  // Tidak ada metode mutasi lain (PUT/PATCH/DELETE) di /api/tiket maupun /api/tiket/[id]
  for (const m of ["PUT", "PATCH", "DELETE"]) {
    const r1 = await api(ownerCookie, m, "/api/tiket", {});
    assert.equal(r1.res.status, 405, `${m} /api/tiket harus 405`);
    const r2 = await api(ownerCookie, m, `/api/tiket/${tiketId}`, {});
    assert.equal(r2.res.status, 405, `${m} /api/tiket/[id] harus 405`);
  }
});

// ---------- 2. Request-Guard (Content-Type & Origin) ----------

test("POST /api/tiket dan POST /api/pelanggan/cek menolak Content-Type bukan JSON (415) dan Origin salah/hilang (403)", async () => {
  const payload = {
    nama_pelanggan: "Uji Guard",
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: "Vans Old Skool", jumlah: 1 }],
    status_bayar: "Belum bayar",
  };
  const mentah = JSON.stringify(payload);

  for (const rute of ["/api/tiket", "/api/pelanggan/cek"]) {
    const teks = await api(kasirCookie, "POST", rute, undefined, {
      contentType: "text/plain",
      mentah,
    });
    assert.equal(teks.res.status, 415, `${rute} text/plain harus 415`);

    const tanpaCt = await api(kasirCookie, "POST", rute, undefined, {
      contentType: null,
      mentah,
    });
    assert.equal(tanpaCt.res.status, 415, `${rute} tanpa Content-Type harus 415`);

    const originAsing = await api(kasirCookie, "POST", rute, payload, {
      origin: "http://penyerang.example",
    });
    assert.equal(originAsing.res.status, 403, `${rute} Origin asing harus 403`);

    const tanpaOrigin = await api(kasirCookie, "POST", rute, payload, {
      origin: null,
    });
    assert.equal(tanpaOrigin.res.status, 403, `${rute} tanpa Origin harus 403`);
  }
});

// ---------- 3. Zero Trust Harga & Total + Multi-item + Layanan Nonaktif ----------

test("server menghitung sendiri harga_saat_transaksi dan total dari katalog aktif walau klien mengirim nilai palsu", async () => {
  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Siti Aminah",
    nomor_wa: waUnik08(),
    harga: 1,
    total: 500, // palsu, harus diabaikan
    items: [
      {
        service_id: layananA.id, // Rp 30.000
        deskripsi_barang: "New Balance 530 Putih",
        jumlah: 2,
        harga: 100, // palsu
        harga_saat_transaksi: 100, // palsu
        subtotal: 200, // palsu
      },
      {
        service_id: layananB.id, // Rp 75.000
        deskripsi_barang: "Adidas Samba Hitam",
        jumlah: 3,
        harga: 0, // palsu
      },
    ],
    status_bayar: "Lunas",
    metode_bayar: "Cash",
  });

  assert.equal(buat.res.status, 201);
  const t = buat.data.data;
  // 2 * 30.000 + 3 * 75.000 = 60.000 + 225.000 = 285.000
  assert.equal(t.total, 285_000);
  assert.equal(t.jumlah_item, 2);
  assert.equal(t.jumlah_pasang, 5);
  assert.equal(t.status_pesanan, "Belum dicuci");
  assert.equal(t.status_bayar, "Lunas");
  assert.equal(t.metode_bayar, "Cash");
  assert.ok(t.tanggal_bayar, "tanggal_bayar harus diisi server saat Lunas");
  assert.equal(t.items[0].harga_saat_transaksi, 30_000);
  assert.equal(t.items[0].subtotal, 60_000);
  assert.equal(t.items[1].harga_saat_transaksi, 75_000);
  assert.equal(t.items[1].subtotal, 225_000);

  // Estimasi selesai default mengikuti max(estimasi_hari) = 5 hari dari layananB
  const selisihMs =
    new Date(t.estimasi_selesai).getTime() - new Date(t.tanggal_masuk).getTime();
  assert.equal(selisihMs, 5 * 86_400_000);
});

test("layanan nonaktif atau tidak ada ditolak (400) tanpa membuat tiket", async () => {
  const sebelum = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);

  const nonaktif = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Pelanggan Nonaktif",
    nomor_wa: waUnik08(),
    items: [{ service_id: layananNonaktif.id, deskripsi_barang: "Converse", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(nonaktif.res.status, 400);
  assert.match(nonaktif.data?.error ?? "", /nonaktif/i);

  const tidakAda = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Pelanggan Hantu",
    nomor_wa: waUnik08(),
    items: [{ service_id: 999_888, deskripsi_barang: "Converse", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(tidakAda.res.status, 400);

  const sesudah = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  assert.equal(sesudah, sebelum, "tidak boleh ada tiket terbuat");
});

// ---------- 4. Batas Total Tiket Rp 1.000.000.000 ----------

test("batas atas total tiket: tepat Rp 1.000.000.000 diterima, di atas Rp 1.000.000.000 ditolak 400 dengan pesan jelas", async () => {
  const sMahal = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Layanan Maks ${Date.now()}`,
    harga: 100_000_000,
    estimasi_hari: 3,
  });
  assert.equal(sMahal.res.status, 201);
  const idMahal = sMahal.data.data.id;

  const sSatuRupiah = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Layanan Satu Rupiah ${Date.now()}`,
    harga: 1,
    estimasi_hari: 1,
  });
  assert.equal(sSatuRupiah.res.status, 201);
  const idSatu = sSatuRupiah.data.data.id;

  // Tepat di batas: 10 pasang * Rp 100.000.000 = Rp 1.000.000.000 -> diterima (201)
  const tepat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Batas Tepat",
    nomor_wa: waUnik08(),
    items: [{ service_id: idMahal, deskripsi_barang: "Koleksi Sepatu", jumlah: 10 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(tepat.res.status, 201);
  assert.equal(tepat.data.data.total, 1_000_000_000);

  // Lewat 1 rupiah: Rp 1.000.000.001 -> ditolak 400
  const sebelum = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  const lewatSatu = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Lewat Satu",
    nomor_wa: waUnik08(),
    items: [
      { service_id: idMahal, deskripsi_barang: "Koleksi A", jumlah: 10 },
      { service_id: idSatu, deskripsi_barang: "Tali", jumlah: 1 },
    ],
    status_bayar: "Belum bayar",
  });
  assert.equal(lewatSatu.res.status, 400);
  assert.match(lewatSatu.data?.error ?? "", /1\.000\.000\.000/);

  // Jauh di atas batas (dan melampaui integer 32-bit bila 22 pasang): 11 pasang = 1,1 miliar -> ditolak 400
  const lewatBanyak = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Lewat Banyak",
    nomor_wa: waUnik08(),
    items: [{ service_id: idMahal, deskripsi_barang: "Koleksi Besar", jumlah: 11 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(lewatBanyak.res.status, 400);
  assert.match(lewatBanyak.data?.error ?? "", /1\.000\.000\.000/);

  const sesudah = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  assert.equal(sesudah, sebelum, "tiket yang melebihi batas total tidak boleh tersimpan");
});

// ---------- 5. Validasi Input Lengkap & Jadwal (Toleransi 5 Menit) ----------

test("validasi input menolak seluruh muatan tidak sah (400) dan menerima toleransi tanggal_masuk <= 5 menit", async () => {
  const itemValid = {
    service_id: layananA.id,
    deskripsi_barang: "Sepatu Lari",
    jumlah: 1,
  };
  const dasar = {
    nama_pelanggan: "Budi",
    nomor_wa: waUnik08(),
    items: [itemValid],
    status_bayar: "Belum bayar",
  };

  const masaDepan10Menit = new Date(Date.now() + 10 * 60_000).toISOString();
  const kemarinIso = new Date(Date.now() - 86_400_000).toISOString();
  const duaHariLaluIso = new Date(Date.now() - 2 * 86_400_000).toISOString();

  const kasusBuruk = [
    ["nama kosong", { ...dasar, nama_pelanggan: "   " }],
    ["nama > 100", { ...dasar, nama_pelanggan: "x".repeat(101) }],
    ["nomor WA salah", { ...dasar, nomor_wa: "08123" }],
    ["nomor WA huruf", { ...dasar, nomor_wa: "0812abcd9999" }],
    ["nomor WA negara lain", { ...dasar, nomor_wa: "+14155552671" }],
    ["nomor WA angka bukan string", { ...dasar, nomor_wa: 6281234567890 }],
    ["items kosong", { ...dasar, items: [] }],
    ["items > 20", { ...dasar, items: Array.from({ length: 21 }, () => itemValid) }],
    ["jumlah 0", { ...dasar, items: [{ ...itemValid, jumlah: 0 }] }],
    ["jumlah 21", { ...dasar, items: [{ ...itemValid, jumlah: 21 }] }],
    ["jumlah pecahan", { ...dasar, items: [{ ...itemValid, jumlah: 1.5 }] }],
    ["jumlah sebagai teks", { ...dasar, items: [{ ...itemValid, jumlah: "2" }] }],
    ["service_id sebagai teks", { ...dasar, items: [{ ...itemValid, service_id: String(layananA.id) }] }],
    ["deskripsi kosong", { ...dasar, items: [{ ...itemValid, deskripsi_barang: "  " }] }],
    ["deskripsi > 200", { ...dasar, items: [{ ...itemValid, deskripsi_barang: "s".repeat(201) }] }],
    ["Lunas tanpa metode", { ...dasar, status_bayar: "Lunas" }],
    ["Lunas metode salah", { ...dasar, status_bayar: "Lunas", metode_bayar: "QRIS" }],
    ["Belum bayar disertai metode", { ...dasar, status_bayar: "Belum bayar", metode_bayar: "Cash" }],
    ["estimasi sebelum tanggal_masuk", { ...dasar, tanggal_masuk: kemarinIso, estimasi_selesai: duaHariLaluIso }],
    ["tanggal_masuk > 5 menit di masa depan", { ...dasar, tanggal_masuk: masaDepan10Menit }],
    ["tanggal_masuk kalender tidak sah", { ...dasar, tanggal_masuk: "2026-02-30" }],
    ["field asing status_pesanan", { ...dasar, status_pesanan: "Sudah diambil" }],
    ["field asing sumber", { ...dasar, sumber: "wa" }],
  ];

  const sebelum = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  for (const [label, body] of kasusBuruk) {
    const { res } = await api(kasirCookie, "POST", "/api/tiket", body);
    assert.equal(res.status, 400, `${label} harus 400, dapat ${res.status}`);
  }
  const jsonRusak = await api(kasirCookie, "POST", "/api/tiket", undefined, {
    mentah: "{rusak",
  });
  assert.equal(jsonRusak.res.status, 400);
  const sesudah = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  assert.equal(sesudah, sebelum, "input gagal validasi tidak boleh menambah orders");

  // Tanggal masuk +3 menit (masih dalam toleransi 5 menit) diterima
  const tigaMenitDepan = new Date(Date.now() + 3 * 60_000).toISOString();
  const okToleransi = await api(kasirCookie, "POST", "/api/tiket", {
    ...dasar,
    nomor_wa: waUnik08(),
    tanggal_masuk: tigaMenitDepan,
  });
  assert.equal(okToleransi.res.status, 201, "toleransi <= 5 menit harus diterima");
});

// ---------- 6. Pelanggan Lama, Peringatan Beda Nama, & Konkurensi Pelanggan Baru ----------

test("pelanggan lama dipakai ulang tanpa duplikat; nama berbeda tidak ditimpa diam-diam kecuali dikonfirmasi", async () => {
  const digitAkhir = String(++urutWa).padStart(4, "0");
  const waFormat08 = `0813-9900-${digitAkhir}`;
  const waFormatPlus = `+62 813.9900.${digitAkhir}`;
  const waBaku = `628139900${digitAkhir}`;

  // Tiket pertama membuat pelanggan baru
  const t1 = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Andi Saputra",
    nomor_wa: waFormat08,
    items: [{ service_id: layananA.id, deskripsi_barang: "Puma Suede", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(t1.res.status, 201);
  assert.equal(t1.data.peringatan, null);
  assert.equal(t1.data.data.pelanggan.nomor_wa, waBaku);
  const custId = t1.data.data.pelanggan.id;

  // POST /api/pelanggan/cek menemukan pelanggan dengan format nomor berbeda
  const cek = await api(kasirCookie, "POST", "/api/pelanggan/cek", {
    nomor_wa: waFormatPlus,
  });
  assert.equal(cek.res.status, 200);
  assert.equal(cek.data.ditemukan, true);
  assert.equal(cek.data.data.id, custId);
  assert.equal(cek.data.data.nama, "Andi Saputra");

  // Tiket kedua dengan nama berbeda TANPA konfirmasi: jangan timpa, beri peringatan
  const t2 = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Andi Wijaya",
    nomor_wa: waFormatPlus,
    items: [{ service_id: layananA.id, deskripsi_barang: "Reebok Classic", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(t2.res.status, 201);
  assert.equal(t2.data.data.pelanggan.id, custId, "pelanggan harus dipakai ulang");
  assert.equal(t2.data.data.pelanggan.nama, "Andi Saputra", "nama lama harus tetap dipakai");
  assert.equal(t2.data.peringatan?.kode, "NAMA_PELANGGAN_BERBEDA");
  assert.equal(t2.data.peringatan?.nama_tersimpan, "Andi Saputra");
  assert.equal(t2.data.peringatan?.nama_dikirim, "Andi Wijaya");

  // Pastikan di DB tetap 1 baris dan nama belum berubah
  const dbCust1 = await admin.query(
    `SELECT id, nama FROM customers WHERE nomor_wa = $1`,
    [waBaku]
  );
  assert.equal(dbCust1.rowCount, 1);
  assert.equal(dbCust1.rows[0].nama, "Andi Saputra");

  // Tiket ketiga DENGAN konfirmasi_ubah_nama: true -> nama diperbarui & tercatat di audit_logs
  const t3 = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Andi Wijaya",
    nomor_wa: waBaku,
    konfirmasi_ubah_nama: true,
    items: [{ service_id: layananA.id, deskripsi_barang: "Asics Gel", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(t3.res.status, 201);
  assert.equal(t3.data.peringatan, null);
  assert.equal(t3.data.data.pelanggan.nama, "Andi Wijaya");

  const dbCust2 = await admin.query(
    `SELECT id, nama FROM customers WHERE nomor_wa = $1`,
    [waBaku]
  );
  assert.equal(dbCust2.rowCount, 1);
  assert.equal(dbCust2.rows[0].nama, "Andi Wijaya");
});

test("dua tiket serentak dengan nomor WA baru yang sama: keduanya berhasil (201) dan hanya satu baris customers", async () => {
  const waBaru = waUnik08();
  const norm = normalisasiNomorWa(waBaru);
  assert.equal(norm.ok, true);

  const [r1, r2] = await Promise.all([
    api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: "Pelanggan Serentak",
      nomor_wa: waBaru,
      items: [{ service_id: layananA.id, deskripsi_barang: "Sepatu Kiri", jumlah: 1 }],
      status_bayar: "Belum bayar",
    }),
    api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: "Pelanggan Serentak",
      nomor_wa: waBaru,
      items: [{ service_id: layananB.id, deskripsi_barang: "Sepatu Kanan", jumlah: 1 }],
      status_bayar: "Belum bayar",
    }),
  ]);

  assert.equal(r1.res.status, 201, `tiket 1 harus 201, dapat ${r1.res.status}`);
  assert.equal(r2.res.status, 201, `tiket 2 harus 201, dapat ${r2.res.status}`);
  assert.notEqual(r1.data.data.kode_tiket, r2.data.data.kode_tiket);
  assert.equal(r1.data.data.pelanggan.id, r2.data.data.pelanggan.id);

  const hitung = await admin.query(
    `SELECT COUNT(*)::int AS n FROM customers WHERE nomor_wa = $1`,
    [norm.nomor]
  );
  assert.equal(hitung.rows[0].n, 1, "hanya boleh ada tepat 1 baris customers");
});

// ---------- 7. Kode Tiket Serentak & Tanggal Terbit ----------

test("pembuatan banyak tiket serentak menghasilkan kode_tiket unik dan memakai tanggal terbit Asia/Jakarta", async () => {
  const kemarinIso = new Date(Date.now() - 86_400_000).toISOString();
  const hasil = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      api(kasirCookie, "POST", "/api/tiket", {
        nama_pelanggan: `Serentak Kode ${i}`,
        nomor_wa: waUnik08(),
        tanggal_masuk: kemarinIso, // walau tanggal_masuk kemarin, kode tiket pakai tanggal terbit hari ini
        items: [{ service_id: layananA.id, deskripsi_barang: `Sepatu ${i}`, jumlah: 1 }],
        status_bayar: "Belum bayar",
      })
    )
  );

  for (const h of hasil) {
    assert.equal(h.res.status, 201);
  }
  const daftarKode = hasil.map((h) => h.data.data.kode_tiket);
  const unik = new Set(daftarKode);
  assert.equal(unik.size, 6, `semua kode tiket harus unik: ${daftarKode.join(", ")}`);

  const tglTerbitWib = tanggalHariIniWib(new Date()).replace(/-/g, "");
  for (const kode of daftarKode) {
    assert.ok(
      kode.startsWith(`SM-${tglTerbitWib}-`),
      `kode tiket (${kode}) harus memakai tanggal terbit WIB (${tglTerbitWib}), bukan tanggal_masuk`
    );
  }
});

// ---------- 8. Satu Transaksi Atomik + Audit ----------

test("kegagalan penulisan audit_logs membatalkan seluruh pembuatan tiket (orders, items, customers, ticket_counters)", async () => {
  const waGagal = waUnik08();
  const norm = normalisasiNomorWa(waGagal);
  assert.equal(norm.ok, true);

  const ordSebelum = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  const itemSebelum = Number((await admin.query(`SELECT COUNT(*) FROM order_items`)).rows[0].count);
  const ctrSebelum = await admin.query(
    `SELECT COALESCE(SUM(terakhir), 0)::int AS total FROM ticket_counters`
  );

  await admin.query(`
    CREATE OR REPLACE FUNCTION tes_audit_tiket_gagal() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'simulasi audit gagal'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER tes_audit_tiket_gagal BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION tes_audit_tiket_gagal();
  `);
  try {
    const gagal = await api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: "Pelanggan Batal Audit",
      nomor_wa: waGagal,
      items: [{ service_id: layananA.id, deskripsi_barang: "Sepatu Rollback", jumlah: 2 }],
      status_bayar: "Lunas",
      metode_bayar: "Non-cash",
    });
    assert.equal(gagal.res.status, 500);
  } finally {
    await admin.query(`
      DROP TRIGGER IF EXISTS tes_audit_tiket_gagal ON audit_logs;
      DROP FUNCTION IF EXISTS tes_audit_tiket_gagal();
    `);
  }

  const ordSesudah = Number((await admin.query(`SELECT COUNT(*) FROM orders`)).rows[0].count);
  const itemSesudah = Number((await admin.query(`SELECT COUNT(*) FROM order_items`)).rows[0].count);
  const custSesudah = await admin.query(
    `SELECT COUNT(*)::int AS n FROM customers WHERE nomor_wa = $1`,
    [norm.nomor]
  );
  const ctrSesudah = await admin.query(
    `SELECT COALESCE(SUM(terakhir), 0)::int AS total FROM ticket_counters`
  );

  assert.equal(ordSesudah, ordSebelum, "orders harus ter-rollback");
  assert.equal(itemSesudah, itemSebelum, "order_items harus ter-rollback");
  assert.equal(custSesudah.rows[0].n, 0, "pelanggan baru harus ter-rollback");
  assert.equal(
    ctrSesudah.rows[0].total,
    ctrSebelum.rows[0].total,
    "counter kode tiket harian harus ikut ter-rollback"
  );
});

// ---------- 9. Perubahan Harga Katalog Setelah Tiket Dibuat (FR-61) ----------

test("perubahan harga layanan di katalog setelah tiket dibuat tidak mengubah harga_saat_transaksi maupun total tiket lama", async () => {
  const sUji = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Layanan FR61 ${Date.now()}`,
    harga: 40_000,
    estimasi_hari: 2,
  });
  assert.equal(sUji.res.status, 201);
  const svc = sUji.data.data;

  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Pelanggan FR61",
    nomor_wa: waUnik08(),
    items: [{ service_id: svc.id, deskripsi_barang: "Jordan 4", jumlah: 2 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(buat.res.status, 201);
  const tiketId = buat.data.data.id;
  assert.equal(buat.data.data.total, 80_000);

  // Owner menaikkan harga katalog menjadi Rp 65.000
  const ubah = await api(ownerCookie, "PUT", `/api/katalog/${svc.id}`, {
    nama: svc.nama,
    harga: 65_000,
    estimasi_hari: 2,
  });
  assert.equal(ubah.res.status, 200);

  const detail = await api(kasirCookie, "GET", `/api/tiket/${tiketId}`);
  assert.equal(detail.res.status, 200);
  assert.equal(detail.data.data.items[0].harga_saat_transaksi, 40_000);
  assert.equal(detail.data.data.items[0].subtotal, 80_000);
  assert.equal(detail.data.data.total, 80_000);
});

// ---------- 10. Filter Tanggal Asia/Jakarta di Sekitar Tengah Malam ----------

test("filter tanggal Daftar Tiket memakai tanggal_masuk zona Asia/Jakarta secara akurat di sekitar tengah malam", async () => {
  // Tanggal uji masa lalu yang tidak terpengaruh jam saat tes dijalankan:
  // 2026-03-10 23:55 WIB = 2026-03-10T16:55:00Z (masuk 10 Maret WIB)
  // 2026-03-11 00:05 WIB = 2026-03-10T17:05:00Z (di UTC masih 10 Maret, tetapi di WIB sudah 11 Maret!)
  // 2026-03-11 23:55 WIB = 2026-03-11T16:55:00Z (masuk 11 Maret WIB)
  // 2026-03-12 00:05 WIB = 2026-03-11T17:05:00Z (masuk 12 Maret WIB)
  const penanda = `MIDNIGHT_${Date.now()}`;
  const jadwalUji = [
    ["M10_AKHIR", "2026-03-10T23:55:00+07:00"],
    ["M11_AWAL", "2026-03-11T00:05:00+07:00"],
    ["M11_AKHIR", "2026-03-11T23:55:00+07:00"],
    ["M12_AWAL", "2026-03-12T00:05:00+07:00"],
  ];

  for (const [kode, tglMasuk] of jadwalUji) {
    const r = await api(kasirCookie, "POST", "/api/tiket", {
      nama_pelanggan: `${penanda}_${kode}`,
      nomor_wa: waUnik08(),
      tanggal_masuk: tglMasuk,
      items: [{ service_id: layananA.id, deskripsi_barang: kode, jumlah: 1 }],
      status_bayar: "Belum bayar",
    });
    assert.equal(r.res.status, 201);
  }

  const f11 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?periode=rentang&dari=2026-03-11&sampai=2026-03-11&cari=${encodeURIComponent(penanda)}`
  );
  assert.equal(f11.res.status, 200);
  const nama11 = f11.data.data.map((t) => t.pelanggan.nama).sort();
  assert.deepEqual(nama11, [`${penanda}_M11_AKHIR`, `${penanda}_M11_AWAL`]);

  const f10 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?periode=rentang&dari=2026-03-10&sampai=2026-03-10&cari=${encodeURIComponent(penanda)}`
  );
  assert.equal(f10.res.status, 200);
  assert.deepEqual(
    f10.data.data.map((t) => t.pelanggan.nama),
    [`${penanda}_M10_AKHIR`]
  );

  // Uji juga periode=hari_ini dan periode=kemarin relatif terhadap hari ini di WIB
  const hariIni = tanggalHariIniWib(new Date());
  const kemarin = geserHariKalender(hariIni, -1);
  const penandaRel = `RELWIB_${Date.now()}`;

  const rKemarinAkhir = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${penandaRel}_KEMARIN_2359`,
    nomor_wa: waUnik08(),
    tanggal_masuk: `${kemarin}T23:59:00+07:00`,
    items: [{ service_id: layananA.id, deskripsi_barang: "Kemarin Malam", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(rKemarinAkhir.res.status, 201);

  const rHariIniAwal = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${penandaRel}_HARIINI_0000`,
    nomor_wa: waUnik08(),
    tanggal_masuk: `${hariIni}T00:00:01+07:00`,
    items: [{ service_id: layananA.id, deskripsi_barang: "Dini Hari Ini", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(rHariIniAwal.res.status, 201);

  const resHariIni = await api(
    kasirCookie,
    "GET",
    `/api/tiket?periode=hari_ini&cari=${encodeURIComponent(penandaRel)}`
  );
  assert.equal(resHariIni.res.status, 200);
  assert.deepEqual(
    resHariIni.data.data.map((t) => t.pelanggan.nama),
    [`${penandaRel}_HARIINI_0000`]
  );

  const resKemarin = await api(
    kasirCookie,
    "GET",
    `/api/tiket?periode=kemarin&cari=${encodeURIComponent(penandaRel)}`
  );
  assert.equal(resKemarin.res.status, 200);
  assert.deepEqual(
    resKemarin.data.data.map((t) => t.pelanggan.nama),
    [`${penandaRel}_KEMARIN_2359`]
  );
});

// ---------- 11. Urutan "Belum Bayar di Atas" di SQL Sebelum LIMIT/OFFSET ----------

test("urutan Belum bayar dilakukan di SQL sebelum LIMIT/OFFSET dengan pembeda id (tiket belum bayar lintas halaman tetap muncul lebih dulu)", async () => {
  const penanda = `URUTBB_${Date.now()}`;

  // Buat 1 tiket Belum bayar paling TUA, lalu 3 tiket Lunas yang lebih BARU:
  // Tanpa filter belum_bayar, pada ukuran=2 tiket Belum bayar jatuh ke halaman 2!
  const daftarInput = [
    ["BB_TUA", "2026-04-01T08:00:00+07:00", "Belum bayar", undefined],
    ["LUNAS_1", "2026-04-02T08:00:00+07:00", "Lunas", "Cash"],
    ["LUNAS_2", "2026-04-03T08:00:00+07:00", "Lunas", "Non-cash"],
    ["LUNAS_3", "2026-04-04T08:00:00+07:00", "Lunas", "Cash"],
  ];

  for (const [label, tgl, sb, mb] of daftarInput) {
    const body = {
      nama_pelanggan: `${penanda}_${label}`,
      nomor_wa: waUnik08(),
      tanggal_masuk: tgl,
      items: [{ service_id: layananA.id, deskripsi_barang: label, jumlah: 1 }],
      status_bayar: sb,
      ...(mb ? { metode_bayar: mb } : {}),
    };
    const r = await api(kasirCookie, "POST", "/api/tiket", body);
    assert.equal(r.res.status, 201);
  }

  // Tanpa belum_bayar: halaman 1 (ukuran=2) berisi LUNAS_3 dan LUNAS_2; BB_TUA di halaman 2
  const normalHal1 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(penanda)}&ukuran=2&halaman=1`
  );
  assert.deepEqual(
    normalHal1.data.data.map((t) => t.pelanggan.nama),
    [`${penanda}_LUNAS_3`, `${penanda}_LUNAS_2`]
  );

  // Dengan belum_bayar=true: BB_TUA yang tadinya di halaman 2 ditarik ke baris pertama halaman 1!
  const prioHal1 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(penanda)}&belum_bayar=true&ukuran=2&halaman=1`
  );
  assert.deepEqual(
    prioHal1.data.data.map((t) => t.pelanggan.nama),
    [`${penanda}_BB_TUA`, `${penanda}_LUNAS_3`]
  );

  // Tambahkan 2 tiket Belum bayar lagi dengan tanggal_masuk SAMA PERSIS (menguji pembeda id DESC
  // dan memastikan tiket Belum bayar ke-3 di halaman kedua tetap mendahului semua tiket Lunas!)
  const rSama1 = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${penanda}_BB_SAMA_1`,
    nomor_wa: waUnik08(),
    tanggal_masuk: "2026-04-05T10:00:00+07:00",
    items: [{ service_id: layananA.id, deskripsi_barang: "Sama 1", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  const rSama2 = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${penanda}_BB_SAMA_2`,
    nomor_wa: waUnik08(),
    tanggal_masuk: "2026-04-05T10:00:00+07:00",
    items: [{ service_id: layananA.id, deskripsi_barang: "Sama 2", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(rSama1.res.status, 201);
  assert.equal(rSama2.res.status, 201);
  assert.ok(rSama2.data.data.id > rSama1.data.data.id);

  // Total 3 Belum bayar + 3 Lunas, ukuran=2:
  // Halaman 1: BB_SAMA_2, BB_SAMA_1 (pembeda id DESC)
  // Halaman 2: BB_TUA, LUNAS_3 (tiket Belum bayar di halaman ke-2 tetap muncul lebih dulu!)
  const hal1 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(penanda)}&belum_bayar=true&ukuran=2&halaman=1`
  );
  const hal2 = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(penanda)}&belum_bayar=true&ukuran=2&halaman=2`
  );
  assert.deepEqual(
    hal1.data.data.map((t) => t.pelanggan.nama),
    [`${penanda}_BB_SAMA_2`, `${penanda}_BB_SAMA_1`]
  );
  assert.deepEqual(
    hal2.data.data.map((t) => t.pelanggan.nama),
    [`${penanda}_BB_TUA`, `${penanda}_LUNAS_3`]
  );
});

// ---------- 12. Validasi Query Daftar Tiket, Keamanan SQL, & Validasi ID ----------

test("parameter query tidak valid ditolak (400), kata pencarian berisi kutip/karakter SQL aman, dan ID /api/tiket/[id] divalidasi ketat", async () => {
  const queryBuruk = [
    "periode=bulanan",
    "periode=rentang&dari=2026-01-01",
    "periode=rentang&dari=01-01-2026&sampai=02-01-2026",
    "periode=rentang&dari=2026-02-29&sampai=2026-03-01",
    "periode=rentang&dari=2026-05-10&sampai=2026-05-09",
    "periode=rentang&dari=2025-01-01&sampai=2026-01-03", // 367 hari > 366
    "periode=hari_ini&dari=2026-01-01&sampai=2026-01-02",
    "halaman=0",
    "halaman=-2",
    "halaman=abc",
    "halaman=10001",
    "ukuran=0",
    "ukuran=51",
    "ukuran=1.5",
    "belum_bayar=mungkin",
    "asing=1",
  ];

  for (const q of queryBuruk) {
    const { res } = await api(kasirCookie, "GET", `/api/tiket?${q}`);
    assert.equal(res.status, 400, `query ?${q} harus 400, dapat ${res.status}`);
  }

  // Rentang tepat 366 hari diterima (200)
  const tepat366 = await api(
    kasirCookie,
    "GET",
    "/api/tiket?periode=rentang&dari=2025-01-01&sampai=2026-01-02"
  );
  assert.equal(tepat366.res.status, 200);

  // Pencarian berisi tanda kutip, %, _, \, dan injeksi SQL tidak merusak query
  const namaKutip = `O'Connor "100%_Clean" \\ Uji ${Date.now()}`;
  const buatKutip = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: namaKutip,
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: "Sepatu Kutip", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(buatKutip.res.status, 201);

  for (const cariUji of [
    `' OR 1=1; DROP TABLE orders; --`,
    `%"_\\`,
    "x".repeat(250), // dipotong jadi 100 karakter tanpa error
  ]) {
    const { res } = await api(
      kasirCookie,
      "GET",
      `/api/tiket?cari=${encodeURIComponent(cariUji)}`
    );
    assert.equal(res.status, 200);
  }

  const cariTepat = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(`O'Connor "100%_Clean"`)}`
  );
  assert.equal(cariTepat.res.status, 200);
  assert.equal(cariTepat.data.data.length, 1);
  assert.equal(cariTepat.data.data[0].pelanggan.nama, namaKutip);

  // Validasi ID di /api/tiket/[id]: bukan bilangan bulat positif -> 400; tidak ada -> 404
  for (const idSalah of ["0", "-1", "abc", "1.5", "01", "99999999999"]) {
    const { res } = await api(kasirCookie, "GET", `/api/tiket/${idSalah}`);
    assert.equal(res.status, 400, `ID "${idSalah}" harus 400, dapat ${res.status}`);
  }
  const tidakAda = await api(kasirCookie, "GET", "/api/tiket/999999");
  assert.equal(tidakAda.res.status, 404);
});

// ---------- 13. Privasi NFR-06: Nomor WA Tidak Bocor ke Log & Audit ----------

test("nomor WA acak unik pada POST cek pelanggan & buat tiket tidak bocor ke file log aplikasi maupun audit_logs", async (t) => {
  const logPath = process.env.SERVER_LOG_PATH;
  assert.ok(logPath, "SERVER_LOG_PATH harus tersedia dari with-test-db.mjs");

  const acak9 = String(Math.floor(Math.random() * 900_000_000) + 100_000_000);
  const waPost08 = `0859${acak9}`;
  const waPostBaku = `62859${acak9}`;

  // 1. Cek pelanggan via POST JSON (nomor tidak di URL)
  const rCek = await api(kasirCookie, "POST", "/api/pelanggan/cek", {
    nomor_wa: waPost08,
  });
  assert.equal(rCek.res.status, 200);

  // 2. Buat tiket via POST JSON
  const rBuat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Pelanggan Privasi",
    nomor_wa: waPost08,
    items: [{ service_id: layananA.id, deskripsi_barang: "Sepatu Privasi", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(rBuat.res.status, 201);

  // Periksa seluruh audit_logs: tidak boleh memuat nomor WA
  const auditRows = await admin.query(`SELECT nilai_lama, nilai_baru FROM audit_logs`);
  const teksAudit = JSON.stringify(auditRows.rows);
  assert.ok(!teksAudit.includes(waPost08), "nomor WA format 08 tidak boleh ada di audit_logs");
  assert.ok(!teksAudit.includes(waPostBaku), "nomor WA baku tidak boleh ada di audit_logs");
  assert.ok(!teksAudit.includes(acak9), "digit unik nomor WA tidak boleh ada di audit_logs");

  // Periksa file log server untuk POST: tidak boleh memuat nomor WA
  const isiLog = fs.readFileSync(logPath, "utf8");
  assert.ok(!isiLog.includes(waPost08), "nomor WA POST tidak boleh muncul di log server");
  assert.ok(!isiLog.includes(waPostBaku), "nomor WA baku POST tidak boleh muncul di log server");

  // 3. Uji pencarian daftar lewat URL (GET /api/tiket?cari=...) dengan nomor acak terpisah
  const acakCari9 = String(Math.floor(Math.random() * 900_000_000) + 100_000_000);
  const waCariBaku = `62858${acakCari9}`;
  const rCari = await api(
    kasirCookie,
    "GET",
    `/api/tiket?cari=${encodeURIComponent(waCariBaku)}`
  );
  assert.equal(rCari.res.status, 200);

  const auditSesudahCari = await admin.query(`SELECT nilai_lama, nilai_baru FROM audit_logs`);
  assert.ok(
    !JSON.stringify(auditSesudahCari.rows).includes(acakCari9),
    "pencarian nomor WA tidak boleh masuk ke audit_logs"
  );

  const isiLogSesudahCari = fs.readFileSync(logPath, "utf8");
  const munculDiAccessLog = isiLogSesudahCari.includes(waCariBaku);
  t.diagnostic(
    `GET /api/tiket?cari=<nomor_wa> muncul di SERVER_LOG_PATH (access log next dev): ${munculDiAccessLog}`
  );
});

// ---------- 14. Teks <script>, Tautan wa.me, Hak solemate_app & Trigger order_items ----------

test("nama/deskripsi berisi <script> disimpan sebagai teks apa adanya dan buatUrlWaMe meng-encode pesan dengan encodeURIComponent", async () => {
  const xss = "<script>alert('xss')</script>";
  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${xss} Pelanggan`,
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: `${xss} Sepatu`, jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(buat.res.status, 201);
  assert.equal(buat.data.data.pelanggan.nama, `${xss} Pelanggan`);
  assert.equal(buat.data.data.items[0].deskripsi_barang, `${xss} Sepatu`);

  const url = buatUrlWaMe("0812-3456-7890", `Halo ${xss} & #SM-001`);
  assert.equal(
    url,
    `https://wa.me/6281234567890?text=${encodeURIComponent(`Halo ${xss} & #SM-001`)}`
  );
});

test("hak database: solemate_app ditolak DELETE & TRUNCATE pada orders, order_items, dan ticket_counters; trigger order_items memblokir admin juga", async () => {
  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: "Uji Hak DB",
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: "Sepatu Hak DB", jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(buat.res.status, 201);
  const orderId = buat.data.data.id;
  const itemId = buat.data.data.items[0].id;

  // 1. Cek katalog hak PostgreSQL untuk solemate_app
  for (const tabel of ["orders", "order_items", "ticket_counters"]) {
    const priv = await admin.query(
      `SELECT
         has_table_privilege('solemate_app', $1, 'DELETE') AS del,
         has_table_privilege('solemate_app', $1, 'TRUNCATE') AS trunc`,
      [`public.${tabel}`]
    );
    assert.equal(priv.rows[0].del, false, `solemate_app tidak boleh punya DELETE pada ${tabel}`);
    assert.equal(priv.rows[0].trunc, false, `solemate_app tidak boleh punya TRUNCATE pada ${tabel}`);
  }

  // 2. Percobaan nyata sebagai solemate_app -> permission denied
  await assert.rejects(
    app.query(`DELETE FROM order_items WHERE id = $1`, [itemId]),
    /permission denied/i
  );
  await assert.rejects(app.query(`TRUNCATE order_items`), /permission denied/i);
  await assert.rejects(
    app.query(`DELETE FROM orders WHERE id = $1`, [orderId]),
    /permission denied/i
  );
  await assert.rejects(app.query(`TRUNCATE orders`), /permission denied/i);
  await assert.rejects(app.query(`DELETE FROM ticket_counters`), /permission denied/i);
  await assert.rejects(app.query(`TRUNCATE ticket_counters`), /permission denied/i);

  // 3. Percobaan sebagai admin pun diblokir oleh trigger migrasi 0007 pada order_items
  await assert.rejects(
    admin.query(`DELETE FROM order_items WHERE id = $1`, [itemId]),
    /Item tiket tidak boleh dihapus/
  );
  await assert.rejects(
    admin.query(`TRUNCATE order_items CASCADE`),
    /Item tiket tidak boleh dihapus/
  );
});

// ---------- 15. Unit Test Murni Validasi & Normalisasi ----------

test("unit murni: normalisasiNomorWa, validasiIdTiket, validasiCekPelanggan, validasiBuatTiket, validasiQueryDaftarTiket", () => {
  assert.deepEqual(normalisasiNomorWa("0812-3456-7890"), {
    ok: true,
    nomor: "6281234567890",
  });
  assert.deepEqual(normalisasiNomorWa(" +62 (812) 3456.7890 "), {
    ok: true,
    nomor: "6281234567890",
  });
  assert.equal(normalisasiNomorWa("08123").ok, false);
  assert.equal(normalisasiNomorWa("+60123456789").ok, false);

  assert.equal(validasiIdTiket("1"), 1);
  assert.equal(validasiIdTiket("2147483647"), 2_147_483_647);
  for (const s of ["0", "-5", "01", "1.2", "abc", "", "2147483648"]) {
    assert.equal(validasiIdTiket(s), null, `ID "${s}" harus ditolak`);
  }

  assert.equal(validasiCekPelanggan({ nomor_wa: "081234567890" }).ok, true);
  assert.equal(validasiCekPelanggan({ nomor_wa: "081234567890", ekstra: 1 }).ok, false);

  const skr = new Date("2026-11-07T08:00:00.000Z"); // 15:00 WIB
  assert.equal(
    validasiBuatTiket(
      {
        nama_pelanggan: "Tes",
        nomor_wa: "081234567890",
        items: [{ service_id: 1, deskripsi_barang: "Sepatu", jumlah: 2 }],
        status_bayar: "Belum bayar",
      },
      skr
    ).ok,
    true
  );

  const qOk = validasiQueryDaftarTiket(
    new URLSearchParams("periode=7_hari&belum_bayar=1&halaman=2&ukuran=50&cari=SM-"),
    skr
  );
  assert.equal(qOk.ok, true);
  if (qOk.ok) {
    assert.equal(qOk.data.belum_bayar_di_atas, true);
    assert.equal(qOk.data.halaman, 2);
    assert.equal(qOk.data.ukuran, 50);
  }
});

// ---------- 16. SSR / HTML Halaman UI Phase 5A ----------

test("SSR /buat-tiket: kasir bisa membuka form, owner ditolak (Akses Ditolak), tanpa login diarahkan ke /login, tidak ada elemen di luar PRD", async () => {
  const tanpaLogin = await fetch(`${BASE}/buat-tiket`, { redirect: "manual" });
  assert.ok([302, 307].includes(tanpaLogin.status));
  assert.ok((tanpaLogin.headers.get("location") ?? "").includes("/login"));

  const resOwner = await fetch(`${BASE}/buat-tiket`, {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(resOwner.status, 200);
  const htmlOwner = await resOwner.text();
  assert.match(htmlOwner, /Akses Ditolak/i, "owner harus melihat Akses Ditolak di /buat-tiket");
  assert.doesNotMatch(htmlOwner, /Simpan Tiket/i, "form buat tiket tidak boleh tampil untuk owner");

  const resKasir = await fetch(`${BASE}/buat-tiket`, {
    headers: { Cookie: kasirCookie },
  });
  assert.equal(resKasir.status, 200);
  const htmlKasir = await resKasir.text();
  assert.match(htmlKasir, /Buat Tiket Baru/);
  assert.match(htmlKasir, /Data Pelanggan/);
  assert.match(htmlKasir, /Cek Nomor/);
  assert.match(htmlKasir, /Barang &amp; Layanan/);
  assert.match(htmlKasir, /Perkiraan/);
  assert.match(htmlKasir, /Simpan Tiket/);
  assert.ok(
    htmlKasir.includes(layananA.nama),
    "pilihan layanan aktif harus tampil di halaman /buat-tiket"
  );
  assert.ok(
    !htmlKasir.includes(layananNonaktif.nama),
    "layanan nonaktif tidak boleh tampil sebagai opsi di /buat-tiket"
  );

  // Pastikan tidak ada elemen di luar PRD / Phase 5B
  for (const polaTerlarang of [
    /QRIS/i,
    /alamat\s*jemput/i,
    /kurir/i,
    /ekspor/i,
    /cetak\s*resi/i,
    /batalkan\s*tiket/i,
  ]) {
    assert.doesNotMatch(
      htmlKasir,
      polaTerlarang,
      `halaman /buat-tiket tidak boleh memuat kontrol di luar PRD (${polaTerlarang})`
    );
  }
});

test("SSR /tiket dan /tiket/[id]: kasir vs owner (owner hanya lihat tanpa kontrol ubah atau wa.me), wa.me memakai encodeURIComponent & rel=noopener noreferrer, tidak ada tombol di luar PRD", async () => {
  const namaKhusus = `Rina & Dito ${Date.now()}`;
  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: namaKhusus,
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: "Loafers Cokelat", jumlah: 2 }],
    status_bayar: "Lunas",
    metode_bayar: "Cash",
  });
  assert.equal(buat.res.status, 201);
  const tiket = buat.data.data;

  // 1. Kasir membuka Daftar Tiket (/tiket) dengan filter cari
  const daftarKasir = await fetch(
    `${BASE}/tiket?cari=${encodeURIComponent(tiket.kode_tiket)}`,
    { headers: { Cookie: kasirCookie } }
  );
  assert.equal(daftarKasir.status, 200);
  const htmlDaftarKasir = await daftarKasir.text();
  assert.ok(htmlDaftarKasir.includes(tiket.kode_tiket), "kode tiket harus tampil di /tiket");
  assert.ok(htmlDaftarKasir.includes("Rp 60.000"), "total berformat Rupiah harus tampil");
  assert.ok(htmlDaftarKasir.includes("Buat Tiket Baru"), "kasir melihat tombol Buat Tiket Baru");
  assert.ok(htmlDaftarKasir.includes("https://wa.me/"), "kasir melihat tautan wa.me");
  assert.ok(
    htmlDaftarKasir.includes(encodeURIComponent("Rina & Dito")),
    "pesan wa.me harus di-encode dengan encodeURIComponent"
  );
  assert.ok(
    htmlDaftarKasir.includes('rel="noopener noreferrer"'),
    "tautan wa.me wajib memakai rel=\"noopener noreferrer\""
  );
  assert.doesNotMatch(
    htmlDaftarKasir,
    /<select\b/i,
    "daftar tiket Phase 5A hanya menampilkan badge status hanya-baca tanpa dropdown ubah status"
  );

  // 2. Owner membuka Daftar Tiket (/tiket): hanya lihat, tidak ada Buat Tiket Baru / wa.me / kontrol ubah
  const daftarOwner = await fetch(
    `${BASE}/tiket?cari=${encodeURIComponent(tiket.kode_tiket)}`,
    { headers: { Cookie: ownerCookie } }
  );
  assert.equal(daftarOwner.status, 200);
  const htmlDaftarOwner = await daftarOwner.text();
  assert.ok(htmlDaftarOwner.includes(tiket.kode_tiket), "owner dapat melihat daftar tiket");
  assert.ok(htmlDaftarOwner.includes("Hanya lihat"), "owner melihat penanda Hanya lihat");
  assert.ok(
    !htmlDaftarOwner.includes("https://wa.me/"),
    "owner tidak boleh melihat tombol aksi wa.me"
  );
  assert.ok(
    !htmlDaftarOwner.includes("Buat Tiket Baru"),
    "owner tidak boleh melihat tombol Buat Tiket Baru"
  );
  assert.doesNotMatch(htmlDaftarOwner, /<select\b/i);

  // 3. Query tidak valid di /tiket menampilkan keadaan galat yang rapi
  const daftarGalat = await fetch(`${BASE}/tiket?periode=bulanan`, {
    headers: { Cookie: kasirCookie },
  });
  assert.equal(daftarGalat.status, 200);
  const htmlDaftarGalat = await daftarGalat.text();
  assert.match(htmlDaftarGalat, /Filter Tidak Dapat Diproses/);
  assert.match(htmlDaftarGalat, /Parameter periode tidak valid/);

  // 4. Kasir & Owner membuka Detail Tiket (/tiket/[id])
  const detailKasir = await fetch(`${BASE}/tiket/${tiket.id}`, {
    headers: { Cookie: kasirCookie },
  });
  assert.equal(detailKasir.status, 200);
  const htmlDetailKasir = await detailKasir.text();
  assert.ok(htmlDetailKasir.includes(tiket.kode_tiket));
  assert.ok(htmlDetailKasir.includes("Loafers Cokelat"));
  assert.ok(htmlDetailKasir.includes("Rp 30.000"));
  assert.ok(htmlDetailKasir.includes("Rp 60.000"));
  assert.ok(htmlDetailKasir.includes("Riwayat Perubahan (Log Audit)"));
  assert.ok(htmlDetailKasir.includes("Tiket dibuat"));
  assert.ok(htmlDetailKasir.includes("https://wa.me/"));
  assert.ok(htmlDetailKasir.includes('rel="noopener noreferrer"'));

  const detailOwner = await fetch(`${BASE}/tiket/${tiket.id}`, {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(detailOwner.status, 200);
  const htmlDetailOwner = await detailOwner.text();
  assert.ok(htmlDetailOwner.includes(tiket.kode_tiket));
  assert.ok(htmlDetailOwner.includes("Hanya lihat"));
  assert.ok(htmlDetailOwner.includes("Riwayat Perubahan (Log Audit)"));
  assert.ok(
    !htmlDetailOwner.includes("https://wa.me/"),
    "owner hanya lihat di detail tiket tanpa tombol wa.me"
  );

  // Tidak ada elemen di luar PRD di Daftar maupun Detail Tiket
  for (const htmlUji of [
    htmlDaftarKasir,
    htmlDaftarOwner,
    htmlDetailKasir,
    htmlDetailOwner,
  ]) {
    for (const polaTerlarang of [
      /QRIS/i,
      /alamat\s*jemput/i,
      /kurir/i,
      /ekspor/i,
      /cetak\s*resi/i,
      /batalkan\s*tiket/i,
      /hapus\s*tiket/i,
    ]) {
      assert.doesNotMatch(htmlUji, polaTerlarang);
    }
  }
});

test("SSR /tiket/[id] dengan ID tidak valid atau tidak ada menghasilkan 404 rapi; /detail-tiket mengalihkan dengan benar", async () => {
  const tanpaLogin = await fetch(`${BASE}/tiket/1`, { redirect: "manual" });
  assert.ok([302, 307].includes(tanpaLogin.status));
  assert.ok((tanpaLogin.headers.get("location") ?? "").includes("/login"));

  for (const idBuruk of ["0", "-3", "abc", "1.5", "01", "999999"]) {
    const res404 = await fetch(`${BASE}/tiket/${idBuruk}`, {
      headers: { Cookie: kasirCookie },
    });
    assert.equal(res404.status, 404, `/tiket/${idBuruk} harus menghasilkan HTTP 404`);
    const html404 = await res404.text();
    assert.match(html404, /Tiket Tidak Ditemukan/);
    assert.match(html404, /Kembali ke Daftar Tiket/);
  }

  // Pengalihan stub /detail-tiket
  const stubTanpaLogin = await fetch(`${BASE}/detail-tiket`, { redirect: "manual" });
  assert.ok([302, 307].includes(stubTanpaLogin.status));
  assert.ok((stubTanpaLogin.headers.get("location") ?? "").includes("/login"));

  const stubKeDaftar = await fetch(`${BASE}/detail-tiket`, {
    headers: { Cookie: kasirCookie },
    redirect: "manual",
  });
  assert.ok([302, 307, 308].includes(stubKeDaftar.status));
  assert.ok((stubKeDaftar.headers.get("location") ?? "").endsWith("/tiket"));

  const stubKeId = await fetch(`${BASE}/detail-tiket?id=12`, {
    headers: { Cookie: kasirCookie },
    redirect: "manual",
  });
  assert.ok([302, 307, 308].includes(stubKeId.status));
  assert.ok((stubKeId.headers.get("location") ?? "").endsWith("/tiket/12"));
});

test("SSR keamanan XSS & komponen UI baru: teks <script> tampil sebagai teks ter-escape dan tidak ada dangerouslySetInnerHTML", async () => {
  const muatanXssPelanggan = "<script>alert('xss-pelanggan')</script>";
  const muatanXssBarang = "<script>alert('xss-barang')</script>";

  const buat = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: `${muatanXssPelanggan} Uji`,
    nomor_wa: waUnik08(),
    items: [{ service_id: layananA.id, deskripsi_barang: muatanXssBarang, jumlah: 1 }],
    status_bayar: "Belum bayar",
  });
  assert.equal(buat.res.status, 201);
  const tiket = buat.data.data;

  const resDaftar = await fetch(
    `${BASE}/tiket?cari=${encodeURIComponent(tiket.kode_tiket)}`,
    { headers: { Cookie: kasirCookie } }
  );
  assert.equal(resDaftar.status, 200);
  const htmlDaftar = await resDaftar.text();
  assert.ok(
    htmlDaftar.includes("&lt;script&gt;alert(&#x27;xss-pelanggan&#x27;)&lt;/script&gt;") ||
      htmlDaftar.includes("&lt;script&gt;alert('xss-pelanggan')&lt;/script&gt;"),
    "nama pelanggan berisi <script> harus ter-escape di halaman /tiket"
  );
  assert.ok(!htmlDaftar.includes(muatanXssPelanggan), "tag <script> mentah tidak boleh ada di /tiket");

  const resDetail = await fetch(`${BASE}/tiket/${tiket.id}`, {
    headers: { Cookie: kasirCookie },
  });
  assert.equal(resDetail.status, 200);
  const htmlDetail = await resDetail.text();
  assert.ok(
    htmlDetail.includes("&lt;script&gt;alert(&#x27;xss-pelanggan&#x27;)&lt;/script&gt;") ||
      htmlDetail.includes("&lt;script&gt;alert('xss-pelanggan')&lt;/script&gt;"),
    "nama pelanggan berisi <script> harus ter-escape di halaman /tiket/[id]"
  );
  assert.ok(
    htmlDetail.includes("&lt;script&gt;alert(&#x27;xss-barang&#x27;)&lt;/script&gt;") ||
      htmlDetail.includes("&lt;script&gt;alert('xss-barang')&lt;/script&gt;"),
    "deskripsi barang berisi <script> harus ter-escape di halaman /tiket/[id]"
  );
  assert.ok(!htmlDetail.includes(muatanXssPelanggan));
  assert.ok(!htmlDetail.includes(muatanXssBarang));

  // Pastikan seluruh file UI baru ada dan tidak memakai dangerouslySetInnerHTML
  const berkasUiBaru = [
    "src/components/ui/skeleton.tsx",
    "src/components/ui/empty-state.tsx",
    "src/components/ui/data-table.tsx",
    "src/components/ui/filter-bar.tsx",
    "src/components/ui/pagination.tsx",
    "src/app/(app)/buat-tiket/page.tsx",
    "src/app/(app)/buat-tiket/buat-tiket-client.tsx",
    "src/app/(app)/tiket/page.tsx",
    "src/app/(app)/tiket/daftar-tiket-client.tsx",
    "src/app/(app)/tiket/[id]/page.tsx",
    "src/app/(app)/tiket/[id]/not-found.tsx",
    "src/app/(app)/detail-tiket/page.tsx",
  ];

  for (const rel of berkasUiBaru) {
    const abs = path.resolve(process.cwd(), rel);
    assert.ok(fs.existsSync(abs), `berkas ${rel} harus tersedia`);
    const isi = fs.readFileSync(abs, "utf8");
    assert.doesNotMatch(
      isi,
      /dangerouslySetInnerHTML/,
      `${rel} dilarang memakai dangerouslySetInnerHTML`
    );
  }
});
