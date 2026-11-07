// Tes Phase 4 (Katalog Layanan dan Harga) terhadap database solemate_test.
//   - hak akses: kasir ditolak (halaman dan API), owner boleh, tanpa login dialihkan
//   - owner tambah/ubah/nonaktifkan/aktifkan + audit_logs (nilai lama dan baru)
//   - validasi server (nama, harga, estimasi, batas atas, angka-sebagai-teks, field asing)
//   - nama kembar (tanpa beda huruf besar/kecil), termasuk dua request serentak dan aktivasi ulang
//   - Content-Type dan Origin pada endpoint mutasi
//   - perubahan layanan dan audit satu transaksi (audit gagal -> perubahan dibatalkan)
//   - toggle idempoten, tanpa DELETE (hak database solemate_app), harga tiket lama tidak berubah
//   - nama berisi <script> tampil sebagai teks
//
// Jalankan lewat server tes (lihat potongan script "test:katalog" di laporan):
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test tests/katalog.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import {
  validasiTambah,
  validasiUbah,
  validasiStatus,
  validasiId,
} from "../src/lib/katalog-validasi.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner Katalog ${Date.now()}`;
const KASIR_NAMA = `Kasir Katalog ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let admin; // koneksi admin (DATABASE_URL): menyiapkan dan memeriksa data
let app; // koneksi solemate_app (DATABASE_URL_APP): hak yang sama dengan aplikasi
let ownerId;
let ownerCookie;
let kasirCookie;
let n = 0;
const nama = (awalan = "Layanan") => `${awalan} Uji ${++n} ${Math.random().toString(36).slice(2, 7)}`;

async function login(username, pin) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(res.status, 200, `login ${username} harus berhasil, dapat ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

// Permintaan JSON yang sah (Content-Type dan Origin sesuai). Bisa ditimpa per tes.
async function api(cookie, method, url, body, opsi = {}) {
  const headers = { Cookie: cookie, ...(opsi.headers ?? {}) };
  if (opsi.contentType !== null) headers["Content-Type"] = opsi.contentType ?? "application/json";
  if (opsi.origin !== null) headers.Origin = opsi.origin ?? BASE;
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

const buat = (cookie, isi) => api(cookie, "POST", "/api/katalog", isi);
const dbLayanan = async (id) =>
  (await admin.query(`SELECT * FROM services WHERE id = $1`, [id])).rows[0];
const jumlahLayananNama = async (nm) =>
  Number((await admin.query(`SELECT count(*) FROM services WHERE nama = $1`, [nm])).rows[0].count);
const jumlahAudit = async (aksi, id) =>
  Number(
    (
      await admin.query(
        `SELECT count(*) FROM audit_logs WHERE entitas='services' AND aksi=$1 AND entitas_id=$2`,
        [aksi, id]
      )
    ).rows[0].count
  );

before(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  app = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  ownerId = await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);
  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);
});

after(async () => {
  await admin.end();
  await app.end();
});

// ---------- Hak akses ----------

test("kasir ditolak mengubah katalog: API (403) dan halaman (Akses Ditolak), data tidak berubah", async () => {
  const nm = nama();
  const dibuat = await buat(ownerCookie, { nama: nm, harga: 10000, estimasi_hari: 2 });
  const id = dibuat.data.data.id;

  const sebelumAudit = Number((await admin.query(`SELECT count(*) FROM audit_logs`)).rows[0].count);
  const nmBaru = nama();

  const hasil = [
    await api(kasirCookie, "GET", "/api/katalog"),
    await buat(kasirCookie, { nama: nmBaru, harga: 1, estimasi_hari: 1 }),
    await api(kasirCookie, "PUT", `/api/katalog/${id}`, { nama: nm, harga: 99999, estimasi_hari: 9 }),
    await api(kasirCookie, "PATCH", `/api/katalog/${id}`, { aktif: false }),
  ];
  for (const h of hasil) assert.equal(h.res.status, 403, "kasir harus 403 di semua endpoint katalog");

  const baris = await dbLayanan(id);
  assert.equal(baris.harga, 10000, "harga tidak boleh berubah oleh kasir");
  assert.equal(baris.aktif, true, "status tidak boleh berubah oleh kasir");
  assert.equal(await jumlahLayananNama(nmBaru), 0, "kasir tidak boleh menambah layanan");
  const sesudahAudit = Number((await admin.query(`SELECT count(*) FROM audit_logs`)).rows[0].count);
  assert.equal(sesudahAudit, sebelumAudit, "tidak ada audit baru dari permintaan kasir yang ditolak");

  const halaman = await fetch(`${BASE}/katalog`, { headers: { Cookie: kasirCookie }, redirect: "manual" });
  const html = await halaman.text();
  assert.match(html, /Akses Ditolak/, "halaman katalog harus menampilkan Akses Ditolak untuk kasir");
  assert.ok(!html.includes(nm), "halaman untuk kasir tidak boleh memuat data katalog");
});

test("tanpa login: endpoint mutasi dialihkan ke /login dan tidak mengubah data", async () => {
  const nm = nama();
  const { res } = await api("", "POST", "/api/katalog", { nama: nm, harga: 1, estimasi_hari: 1 });
  assert.ok([302, 307].includes(res.status), `harus dialihkan ke login, dapat ${res.status}`);
  assert.equal(await jumlahLayananNama(nm), 0);
});

// ---------- Owner: tambah, ubah, nonaktifkan, aktifkan + audit ----------

test("owner bisa tambah, ubah, nonaktifkan, aktifkan; audit mencatat nilai lama dan baru", async () => {
  const nm = nama("Deep Clean");
  const t = await buat(ownerCookie, { nama: `  ${nm}  `, harga: 25000, estimasi_hari: 3 });
  assert.equal(t.res.status, 201);
  const id = t.data.data.id;
  assert.equal(t.data.data.nama, nm, "nama disimpan tanpa spasi pinggir");
  assert.equal(t.data.data.aktif, true);

  const tambahAudit = (
    await admin.query(
      `SELECT * FROM audit_logs WHERE entitas='services' AND entitas_id=$1 AND aksi='TAMBAH_LAYANAN'`,
      [id]
    )
  ).rows;
  assert.equal(tambahAudit.length, 1);
  assert.equal(tambahAudit[0].nilai_lama, null);
  assert.equal(tambahAudit[0].nilai_baru.harga, 25000);
  assert.equal(tambahAudit[0].user_id, ownerId);

  const u = await api(ownerCookie, "PUT", `/api/katalog/${id}`, { nama: nm, harga: 30000, estimasi_hari: 4 });
  assert.equal(u.res.status, 200);
  assert.equal(u.data.data.harga, 30000);
  const ubahAudit = (
    await admin.query(
      `SELECT * FROM audit_logs WHERE entitas='services' AND entitas_id=$1 AND aksi='UBAH_LAYANAN'`,
      [id]
    )
  ).rows;
  assert.equal(ubahAudit.length, 1);
  assert.equal(ubahAudit[0].nilai_lama.harga, 25000);
  assert.equal(ubahAudit[0].nilai_lama.estimasi_hari, 3);
  assert.equal(ubahAudit[0].nilai_baru.harga, 30000);
  assert.equal(ubahAudit[0].nilai_baru.estimasi_hari, 4);
  assert.equal(ubahAudit[0].user_id, ownerId);

  const nonaktif = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: false });
  assert.equal(nonaktif.res.status, 200);
  assert.equal((await dbLayanan(id)).aktif, false);
  const na = (
    await admin.query(
      `SELECT * FROM audit_logs WHERE entitas='services' AND entitas_id=$1 AND aksi='NONAKTIFKAN_LAYANAN'`,
      [id]
    )
  ).rows;
  assert.equal(na.length, 1);
  assert.equal(na[0].nilai_lama.aktif, true);
  assert.equal(na[0].nilai_baru.aktif, false);

  const aktifkan = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: true });
  assert.equal(aktifkan.res.status, 200);
  assert.equal((await dbLayanan(id)).aktif, true);
  assert.equal(await jumlahAudit("AKTIFKAN_LAYANAN", id), 1);

  // Daftar owner memuat layanan ini.
  const daftar = await api(ownerCookie, "GET", "/api/katalog");
  assert.equal(daftar.res.status, 200);
  assert.ok(daftar.data.data.some((l) => l.id === id));
});

test("layanan nonaktif tidak muncul untuk kasir; endpoint aktif hanya mengembalikan id, nama, harga, estimasi_hari", async () => {
  const nmAktif = nama("Tampil");
  const nmOff = nama("Sembunyi");
  const a = await buat(ownerCookie, { nama: nmAktif, harga: 11000, estimasi_hari: 1 });
  const b = await buat(ownerCookie, { nama: nmOff, harga: 12000, estimasi_hari: 1 });
  await api(ownerCookie, "PATCH", `/api/katalog/${b.data.data.id}`, { aktif: false });

  const { res, data } = await api(kasirCookie, "GET", "/api/katalog/aktif");
  assert.equal(res.status, 200);
  const namaTampil = data.data.map((l) => l.nama);
  assert.ok(namaTampil.includes(nmAktif), "layanan aktif harus tampil");
  assert.ok(!namaTampil.includes(nmOff), "layanan nonaktif tidak boleh tampil untuk kasir");
  for (const l of data.data) {
    assert.deepEqual(Object.keys(l).sort(), ["estimasi_hari", "harga", "id", "nama"]);
  }
  assert.equal(data.data.find((l) => l.id === a.data.data.id).harga, 11000);

  const tanpaLogin = await api("", "GET", "/api/katalog/aktif");
  assert.ok([302, 307].includes(tanpaLogin.res.status), "endpoint aktif butuh login");
});

// ---------- Validasi server ----------

test("validasi menolak data tidak valid dan tidak membuat baris", async () => {
  const dasar = { nama: "x", harga: 1000, estimasi_hari: 1 };
  const buruk = [
    ["nama kosong", { ...dasar, nama: "" }],
    ["nama spasi saja", { ...dasar, nama: "     " }],
    ["nama bukan teks", { ...dasar, nama: 123 }],
    ["nama hilang", { harga: 1, estimasi_hari: 1 }],
    ["nama 101 karakter", { ...dasar, nama: "a".repeat(101) }],
    ["harga negatif", { ...dasar, harga: -1 }],
    ["harga desimal", { ...dasar, harga: 1.5 }],
    ["harga sebagai teks", { ...dasar, harga: "25000" }],
    ["harga di atas batas", { ...dasar, harga: 100_000_001 }],
    ["harga null", { ...dasar, harga: null }],
    ["estimasi negatif", { ...dasar, estimasi_hari: -1 }],
    ["estimasi desimal", { ...dasar, estimasi_hari: 1.5 }],
    ["estimasi sebagai teks", { ...dasar, estimasi_hari: "3" }],
    ["estimasi di atas batas", { ...dasar, estimasi_hari: 366 }],
    ["aktif bukan boolean", { ...dasar, aktif: "true" }],
    ["field asing", { ...dasar, id: 5 }],
    ["isi berupa array", [dasar]],
  ];
  const sebelum = Number((await admin.query(`SELECT count(*) FROM services`)).rows[0].count);
  for (const [label, isi] of buruk) {
    const nm = nama("Buruk");
    const body = Array.isArray(isi) ? isi : { ...isi, ...(isi.nama === "x" ? { nama: nm } : {}) };
    const { res } = await buat(ownerCookie, body);
    assert.equal(res.status, 400, `${label} harus 400, dapat ${res.status}`);
  }
  const rusak = await api(ownerCookie, "POST", "/api/katalog", undefined, { mentah: "{bukan json" });
  assert.equal(rusak.res.status, 400, "JSON rusak harus 400");
  const sesudah = Number((await admin.query(`SELECT count(*) FROM services`)).rows[0].count);
  assert.equal(sesudah, sebelum, "tidak ada baris baru dari data tidak valid");

  // Batas atas yang sah diterima.
  const ok = await buat(ownerCookie, { nama: nama("Batas"), harga: 100_000_000, estimasi_hari: 365 });
  assert.equal(ok.res.status, 201);
  const nol = await buat(ownerCookie, { nama: nama("Nol"), harga: 0, estimasi_hari: 0 });
  assert.equal(nol.res.status, 201);

  // PUT, PATCH, dan ID juga divalidasi.
  const id = ok.data.data.id;
  assert.equal((await api(ownerCookie, "PUT", `/api/katalog/${id}`, { nama: "x", harga: "1", estimasi_hari: 1 })).res.status, 400);
  assert.equal((await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: "false" })).res.status, 400);
  assert.equal((await api(ownerCookie, "PATCH", `/api/katalog/${id}`, {})).res.status, 400);
  assert.equal((await api(ownerCookie, "PATCH", `/api/katalog/abc`, { aktif: true })).res.status, 400);
  assert.equal((await api(ownerCookie, "PATCH", `/api/katalog/999999`, { aktif: true })).res.status, 404);
});

test("nama kembar ditolak tanpa membedakan huruf besar/kecil dan spasi pinggir (409)", async () => {
  const nm = nama("Fast Clean");
  assert.equal((await buat(ownerCookie, { nama: nm, harga: 1000, estimasi_hari: 1 })).res.status, 201);
  const kembar = await buat(ownerCookie, { nama: `  ${nm.toUpperCase()} `, harga: 2000, estimasi_hari: 2 });
  assert.equal(kembar.res.status, 409);
  assert.equal(
    Number((await admin.query(`SELECT count(*) FROM services WHERE LOWER(TRIM(nama)) = LOWER(TRIM($1))`, [nm])).rows[0].count),
    1
  );

  // Mengubah nama layanan lain menjadi nama yang sudah dipakai juga ditolak.
  const lain = await buat(ownerCookie, { nama: nama(), harga: 1, estimasi_hari: 1 });
  const ubah = await api(ownerCookie, "PUT", `/api/katalog/${lain.data.data.id}`, {
    nama: nm.toLowerCase(),
    harga: 1,
    estimasi_hari: 1,
  });
  assert.equal(ubah.res.status, 409);
});

test("indeks unik 0005 ada di database dan menolak nama kembar langsung di SQL", async () => {
  const idx = await admin.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename='services' AND indexname='services_nama_aktif_unik'`
  );
  assert.equal(idx.rowCount, 1, "indeks services_nama_aktif_unik harus ada (migrasi 0005)");
  assert.match(idx.rows[0].indexdef, /lower/i);
  assert.match(idx.rows[0].indexdef, /WHERE/i);

  const nm = nama("Indeks");
  await app.query(`INSERT INTO services (nama, harga, estimasi_hari) VALUES ($1, 1, 1)`, [nm]);
  await assert.rejects(
    app.query(`INSERT INTO services (nama, harga, estimasi_hari) VALUES ($1, 1, 1)`, [` ${nm.toUpperCase()}`]),
    (e) => e.code === "23505" && /services_nama_aktif_unik/.test(e.message)
  );
});

test("dua pembuatan nama sama serentak: hanya satu berhasil", async () => {
  const nm = nama("Serentak");
  const hasil = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      buat(ownerCookie, { nama: i % 2 ? nm : nm.toUpperCase(), harga: 1000, estimasi_hari: 1 })
    )
  );
  const status = hasil.map((h) => h.res.status).sort();
  assert.equal(status.filter((s) => s === 201).length, 1, `tepat satu 201, dapat ${status}`);
  assert.ok(status.filter((s) => s === 409).length === 5, `sisanya 409, dapat ${status}`);
  assert.equal(
    Number((await admin.query(`SELECT count(*) FROM services WHERE LOWER(nama) = LOWER($1)`, [nm])).rows[0].count),
    1
  );
});

test("mengaktifkan kembali layanan yang namanya sudah dipakai layanan aktif ditolak (409)", async () => {
  const nm = nama("Cuci Ulang");
  const lama = await buat(ownerCookie, { nama: nm, harga: 5000, estimasi_hari: 1 });
  const idLama = lama.data.data.id;
  await api(ownerCookie, "PATCH", `/api/katalog/${idLama}`, { aktif: false });

  // Nama yang sama (beda huruf) dipakai layanan aktif baru.
  const baru = await buat(ownerCookie, { nama: nm.toUpperCase(), harga: 6000, estimasi_hari: 1 });
  assert.equal(baru.res.status, 201);

  const aktifkan = await api(ownerCookie, "PATCH", `/api/katalog/${idLama}`, { aktif: true });
  assert.equal(aktifkan.res.status, 409);
  assert.equal((await dbLayanan(idLama)).aktif, false, "status tetap nonaktif");
  assert.equal(await jumlahAudit("AKTIFKAN_LAYANAN", idLama), 0, "tidak ada audit untuk aktivasi yang gagal");

  // Nama sama dengan layanan nonaktif SAJA (tidak ada layanan aktif bernama sama): 409 dengan pesan khusus, bukan 500.
  const PESAN = "Layanan dengan nama ini sudah ada tetapi nonaktif. Aktifkan kembali dari daftar.";
  const nm2 = nama("Hanya Nonaktif");
  const off = await buat(ownerCookie, { nama: nm2, harga: 5000, estimasi_hari: 1 });
  await api(ownerCookie, "PATCH", `/api/katalog/${off.data.data.id}`, { aktif: false });

  const persis = await buat(ownerCookie, { nama: nm2, harga: 1, estimasi_hari: 1 });
  assert.equal(persis.res.status, 409);
  assert.equal(persis.data.error, PESAN);

  // Mengubah nama layanan lain menjadi nama persis sebuah layanan nonaktif: pesan yang sama.
  const lain = await buat(ownerCookie, { nama: nama(), harga: 1, estimasi_hari: 1 });
  const ubahKeNonaktif = await api(ownerCookie, "PUT", `/api/katalog/${lain.data.data.id}`, {
    nama: nm2,
    harga: 1,
    estimasi_hari: 1,
  });
  assert.equal(ubahKeNonaktif.res.status, 409);
  assert.equal(ubahKeNonaktif.data.error, PESAN);

  // Bentrok dengan layanan AKTIF tetap memakai pesan lama (bukan pesan nonaktif).
  const kembarAktif = await buat(ownerCookie, { nama: nm.toUpperCase(), harga: 1, estimasi_hari: 1 });
  assert.equal(kembarAktif.res.status, 409);
  assert.equal(kembarAktif.data.error, "Nama layanan sudah dipakai layanan lain.");
});

// ---------- Content-Type dan Origin ----------

test("endpoint mutasi menolak Content-Type bukan JSON (415) dan Origin salah/hilang (403)", async () => {
  const nm = nama("Origin");
  const isi = { nama: nm, harga: 1000, estimasi_hari: 1 };
  const json = JSON.stringify(isi);

  const teks = await api(ownerCookie, "POST", "/api/katalog", undefined, { contentType: "text/plain", mentah: json });
  assert.equal(teks.res.status, 415);
  const form = await api(ownerCookie, "POST", "/api/katalog", undefined, {
    contentType: "application/x-www-form-urlencoded",
    mentah: "nama=x",
  });
  assert.equal(form.res.status, 415);
  const tanpaCt = await api(ownerCookie, "POST", "/api/katalog", undefined, { contentType: null, mentah: json });
  assert.equal(tanpaCt.res.status, 415);

  const asing = await api(ownerCookie, "POST", "/api/katalog", isi, { origin: "http://situs-jahat.example" });
  assert.equal(asing.res.status, 403);
  const tanpaOrigin = await api(ownerCookie, "POST", "/api/katalog", isi, { origin: null });
  assert.equal(tanpaOrigin.res.status, 403);
  const rusak = await api(ownerCookie, "POST", "/api/katalog", isi, { origin: "bukan-url" });
  assert.equal(rusak.res.status, 403);

  assert.equal(await jumlahLayananNama(nm), 0, "tidak ada layanan terbuat dari permintaan yang ditolak");

  const buatOk = await buat(ownerCookie, isi);
  assert.equal(buatOk.res.status, 201);
  const id = buatOk.data.data.id;
  const putAsing = await api(ownerCookie, "PUT", `/api/katalog/${id}`, { ...isi, harga: 2 }, { origin: "http://situs-jahat.example" });
  assert.equal(putAsing.res.status, 403);
  const patchTeks = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, undefined, { contentType: "text/plain", mentah: '{"aktif":false}' });
  assert.equal(patchTeks.res.status, 415);
  const baris = await dbLayanan(id);
  assert.equal(baris.harga, 1000);
  assert.equal(baris.aktif, true);
});

// ---------- Satu transaksi ----------

test("kegagalan audit membatalkan perubahan layanan (tambah, ubah, status) dalam satu transaksi", async () => {
  const ada = await buat(ownerCookie, { nama: nama("Transaksi"), harga: 7000, estimasi_hari: 2 });
  const id = ada.data.data.id;
  const nmBaru = nama("Gagal");

  // Paksa penulisan audit gagal lewat trigger sementara (dipasang admin, hanya di database tes).
  await admin.query(`
    CREATE OR REPLACE FUNCTION tes_audit_gagal() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit gagal (tes)'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER tes_audit_gagal BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION tes_audit_gagal();
  `);
  try {
    const t = await buat(ownerCookie, { nama: nmBaru, harga: 1000, estimasi_hari: 1 });
    assert.equal(t.res.status, 500, "audit gagal harus menggagalkan tambah");
    assert.equal(await jumlahLayananNama(nmBaru), 0, "layanan baru tidak boleh tersisa");

    const u = await api(ownerCookie, "PUT", `/api/katalog/${id}`, { nama: ada.data.data.nama, harga: 99999, estimasi_hari: 9 });
    assert.equal(u.res.status, 500);
    const sesudahUbah = await dbLayanan(id);
    assert.equal(sesudahUbah.harga, 7000, "harga tidak boleh berubah kalau audit gagal");
    assert.equal(sesudahUbah.estimasi_hari, 2);

    const p = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: false });
    assert.equal(p.res.status, 500);
    assert.equal((await dbLayanan(id)).aktif, true, "status tidak boleh berubah kalau audit gagal");
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS tes_audit_gagal ON audit_logs; DROP FUNCTION IF EXISTS tes_audit_gagal();`);
  }

  // Setelah trigger dilepas, operasi normal lagi.
  const pulih = await api(ownerCookie, "PUT", `/api/katalog/${id}`, { nama: ada.data.data.nama, harga: 8000, estimasi_hari: 2 });
  assert.equal(pulih.res.status, 200);
});

// ---------- Toggle idempoten ----------

test("toggle dengan target eksplisit idempoten: dikirim dua kali (dan serentak) hasilnya sama, audit tidak ganda", async () => {
  const t = await buat(ownerCookie, { nama: nama("Toggle"), harga: 4000, estimasi_hari: 1 });
  const id = t.data.data.id;

  const a = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: false });
  const b = await api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: false });
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  assert.equal(a.data.berubah, true);
  assert.equal(b.data.berubah, false);
  assert.equal((await dbLayanan(id)).aktif, false);
  assert.equal(await jumlahAudit("NONAKTIFKAN_LAYANAN", id), 1, "audit nonaktif hanya sekali");

  const serentak = await Promise.all([
    api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: true }),
    api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: true }),
    api(ownerCookie, "PATCH", `/api/katalog/${id}`, { aktif: true }),
  ]);
  for (const s of serentak) assert.equal(s.res.status, 200);
  assert.equal((await dbLayanan(id)).aktif, true);
  assert.equal(await jumlahAudit("AKTIFKAN_LAYANAN", id), 1, "audit aktif hanya sekali");
});

// ---------- Soft delete ----------

test("solemate_app tidak bisa DELETE/TRUNCATE services (permission denied); tidak ada rute DELETE", async () => {
  const t = await buat(ownerCookie, { nama: nama("Hapus"), harga: 1, estimasi_hari: 1 });
  const id = t.data.data.id;

  await assert.rejects(app.query(`DELETE FROM services WHERE id = $1`, [id]), /permission denied/i);
  await assert.rejects(app.query(`TRUNCATE services`), /permission denied/i);
  assert.ok(await dbLayanan(id), "baris tetap ada");

  const del = await api(ownerCookie, "DELETE", `/api/katalog/${id}`);
  assert.equal(del.res.status, 405, "tidak ada handler DELETE");
  assert.ok(await dbLayanan(id), "baris tetap ada setelah DELETE via API");
});

// ---------- FR-61: harga tiket lama ----------

test("mengubah harga layanan tidak mengubah harga pada tiket yang sudah ada (harga_saat_transaksi)", async () => {
  const t = await buat(ownerCookie, { nama: nama("Harga Tiket"), harga: 25000, estimasi_hari: 2 });
  const svc = t.data.data;

  const cust = await admin.query(
    `INSERT INTO customers (nama, nomor_wa) VALUES ('Pelanggan Katalog', '6281200000099') RETURNING id`
  );
  const order = await admin.query(
    `INSERT INTO orders (kode_tiket, customer_id, sumber, tanggal_masuk, status_pesanan, status_bayar, total)
     VALUES ('SOLE-UJI-KATALOG', $1, 'toko', now(), 'Belum dicuci', 'Belum bayar', 50000) RETURNING id`,
    [cust.rows[0].id]
  );
  const item = await admin.query(
    `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
     VALUES ($1, $2, 'Sepatu uji', 2, $3) RETURNING id`,
    [order.rows[0].id, svc.id, svc.harga]
  );

  const ubah = await api(ownerCookie, "PUT", `/api/katalog/${svc.id}`, { nama: svc.nama, harga: 40000, estimasi_hari: 2 });
  assert.equal(ubah.res.status, 200);
  assert.equal((await dbLayanan(svc.id)).harga, 40000, "harga katalog berubah");

  const sesudah = await admin.query(
    `SELECT oi.harga_saat_transaksi, o.total FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = $1`,
    [item.rows[0].id]
  );
  assert.equal(sesudah.rows[0].harga_saat_transaksi, 25000, "harga pada tiket lama tidak berubah");
  assert.equal(sesudah.rows[0].total, 50000, "total tiket lama tidak berubah");
});

// ---------- Tampilan: teks, bukan HTML ----------

test("nama berisi <script> ditampilkan sebagai teks di halaman (tidak dieksekusi)", async () => {
  const payload = "<script>alert(1)</script>";
  const nm = `${payload} ${Math.random().toString(36).slice(2, 7)}`;
  const t = await buat(ownerCookie, { nama: nm, harga: 1000, estimasi_hari: 1 });
  assert.equal(t.res.status, 201);
  assert.equal(t.data.data.nama, nm, "API mengembalikan teks apa adanya (JSON)");

  const halaman = await fetch(`${BASE}/katalog`, { headers: { Cookie: ownerCookie } });
  assert.equal(halaman.status, 200);
  const html = await halaman.text();
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "tag harus ter-escape menjadi teks");
  assert.ok(!html.includes(payload), "tag <script> mentah tidak boleh ada di HTML");

  for (const f of ["katalog-client.tsx", "page.tsx"]) {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/(app)/katalog", f), "utf-8");
    assert.ok(!/dangerouslySetInnerHTML/.test(src), `${f} tidak boleh memakai dangerouslySetInnerHTML`);
  }
});

// ---------- Validasi murni (unit) ----------

test("validasi murni: angka teks ditolak, batas atas, target status eksplisit, ID", () => {
  assert.equal(validasiTambah({ nama: " A ", harga: 100_000_000, estimasi_hari: 365 }).ok, true);
  assert.equal(validasiTambah({ nama: "A", harga: 100_000_001, estimasi_hari: 1 }).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: 1, estimasi_hari: 366 }).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: "1", estimasi_hari: 1 }).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: 1, estimasi_hari: "1" }).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: Number.NaN, estimasi_hari: 1 }).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: Infinity, estimasi_hari: 1 }).ok, false);
  assert.equal(validasiTambah(null).ok, false);
  assert.equal(validasiTambah({ nama: "A", harga: 1, estimasi_hari: 1 }).data.aktif, true, "default aktif");
  assert.equal(validasiUbah({ nama: "A", harga: 1, estimasi_hari: 1, aktif: false }).ok, false, "PUT tidak menerima aktif");
  assert.equal(validasiStatus({ aktif: true }).ok, true);
  assert.equal(validasiStatus({ aktif: "true" }).ok, false);
  assert.equal(validasiStatus({ aktif: 1 }).ok, false);
  assert.equal(validasiStatus({}).ok, false);
  assert.equal(validasiId("12"), 12);
  assert.equal(validasiId("0"), null);
  assert.equal(validasiId("-1"), null);
  assert.equal(validasiId("1.5"), null);
  assert.equal(validasiId("99999999999"), null);
  assert.equal(validasiId("1; DROP TABLE services"), null);
});
