// Tes Ekspor Rekap Bulanan ke Excel (.xlsx) & PDF (FR-53, Phase 7B Extension).
// Menguji: otorisasi owner-only, 405 metode non-GET, validasi query ketat, header no-store/nosniff/Content-Disposition,
// model dokumen tunggal Excel vs PDF, isi .xlsx via fflate (2 sheet, frozen header, lebar kolom, format angka,
// nol tag formula <f>, ketahanan injeksi rumus =/+/-/@), sanitasi teks PDF (emoji/non-Latin/kontrol/bidi),
// pagination + header tabel berulang, rentang kosong, anti-PII & tanpa kata "dikembalikan",
// audit EKSPOR_REKAP fail-closed, UI tombol min-h-[44px], serta 2 bukti gagal-lalu-lulus.
//
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/ekspor-rekap-7b.test.mjs'

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { unzipSync, strFromU8 } from "fflate";
import writeXlsxFile from "write-excel-file/node";
import { buatAkunUji } from "./helpers/akun.mjs";
import {
  validasiQueryEksporRekap,
  ambilRekapBulanan,
} from "../src/lib/laporan.ts";
import {
  bangunModelDokumenRekap,
  renderRekapExcel,
  renderRekapPdf,
  sanitasiTeksPdf,
  eksporRekapDenganAudit,
} from "../src/lib/rekap-ekspor.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner Ekspor 7B ${Date.now()}`;
const KASIR_NAMA = `Kasir Ekspor 7B ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let adminPool;
let ownerCookie;
let kasirCookie;
let ownerId;

let urutWa = 9000;
function waUnik62() {
  urutWa += 1;
  return `628139900${String(urutWa).padStart(4, "0")}`;
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

async function fetchBiner(cookie, url, method = "GET") {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
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

function bongkarXlsx(buf) {
  const arsip = unzipSync(new Uint8Array(buf));
  const teks = {};
  for (const [nama, data] of Object.entries(arsip)) {
    if (nama.endsWith(".xml") || nama.endsWith(".rels")) {
      teks[nama] = strFromU8(data);
    }
  }
  return teks;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function ekstrakSharedStrings(xmlSharedStrings) {
  if (!xmlSharedStrings) return [];
  const hasil = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xmlSharedStrings)) !== null) {
    const tMatches = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) =>
      decodeXmlEntities(x[1])
    );
    hasil.push(tMatches.join(""));
  }
  return hasil;
}

function ekstrakTeksPdf(buf) {
  const raw = buf.toString("latin1");
  const baris = [];
  const regex = /\[([^\]]+)\]\s*TJ|\(([^)]*)\)\s*Tj/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    if (m[1]) {
      const potongan = [...m[1].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => Buffer.from(h[1], "hex").toString("latin1"))
        .join("");
      if (potongan) baris.push(potongan);
    } else if (m[2]) {
      baris.push(m[2]);
    }
  }
  const teks = baris.join("\n");
  return { raw, baris, teks, teksRapi: teks.replace(/\s+/g, " ") };
}

async function sisipkanLayananDanTiket({
  namaLayanan,
  harga = 50000,
  jumlah = 1,
  tanggalMasukIso,
  tanggalBayarIso = null,
  statusBayar = "Lunas",
  metodeBayar = "Cash",
  namaPelanggan = "Pelanggan Uji Ekspor",
  nomorWa = waUnik62(),
}) {
  const svc = await adminPool.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ($1, $2, 2, true)
     RETURNING id`,
    [namaLayanan, harga]
  );
  const serviceId = svc.rows[0].id;

  const cust = await adminPool.query(
    `INSERT INTO customers (nama, nomor_wa)
     VALUES ($1, $2)
     RETURNING id`,
    [namaPelanggan, nomorWa]
  );
  const customerId = cust.rows[0].id;

  const kodeTiket = `EXP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const totalHarga = harga * jumlah;
  const ord = await adminPool.query(
    `INSERT INTO orders (
       kode_tiket, customer_id, sumber, dibuat_oleh, tanggal_masuk, estimasi_selesai,
       status_pesanan, status_bayar, metode_bayar, tanggal_bayar, total
     ) VALUES (
       $1, $2, 'toko', $3, $4::timestamptz, $4::timestamptz + interval '2 days',
       'Belum dicuci', $5, $6, $7::timestamptz, $8
     )
     RETURNING id`,
    [
      kodeTiket,
      customerId,
      ownerId,
      tanggalMasukIso,
      statusBayar,
      statusBayar === "Lunas" ? metodeBayar : null,
      tanggalBayarIso,
      totalHarga,
    ]
  );
  const orderId = ord.rows[0].id;

  await adminPool.query(
    `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
     VALUES ($1, $2, 'Sepatu uji ekspor', $3, $4)`,
    [orderId, serviceId, jumlah, harga]
  );

  return { orderId, serviceId, customerId, kodeTiket };
}

before(async () => {
  const dbUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  assert.ok(dbUrl, "DATABASE_URL_ADMIN harus terisi");
  adminPool = new Pool({ connectionString: dbUrl });

  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);

  const uRes = await adminPool.query(`SELECT id FROM users WHERE nama = $1`, [OWNER_NAMA]);
  ownerId = uRes.rows[0].id;

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);
});

after(async () => {
  if (adminPool) await adminPool.end();
});

// ---------- 1. Otorisasi, Metode, Header Keamanan, & Validasi Query ----------

test("ekspor rekap: hanya owner (anon 307, kasir 403, non-GET 405), header lengkap & validasi parameter ketat", async () => {
  // Tanpa login -> 307 redirect ke /login
  const resAnon = await fetchBiner(
    null,
    "/api/rekap-bulanan/ekspor?format=xlsx&periode=rentang&dari=2026-10-01&sampai=2026-10-31"
  );
  assert.equal(resAnon.res.status, 307);

  // Kasir -> 403 JSON + anti-cache
  const resKasir = await fetchBiner(
    kasirCookie,
    "/api/rekap-bulanan/ekspor?format=pdf&periode=rentang&dari=2026-10-01&sampai=2026-10-31"
  );
  assert.equal(resKasir.res.status, 403);
  const jsonKasir = JSON.parse(resKasir.buf.toString("utf-8"));
  assert.equal(jsonKasir.error, "Akses ditolak");
  assert.match(resKasir.res.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(resKasir.res.headers.get("vary") ?? "", /cookie/i);
  assert.equal(resKasir.res.headers.get("x-content-type-options"), "nosniff");

  // Metode non-GET -> 405
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await fetchBiner(
      ownerCookie,
      "/api/rekap-bulanan/ekspor?format=xlsx&periode=rentang&dari=2026-10-01&sampai=2026-10-31",
      m
    );
    assert.equal(r.res.status, 405, `Metode ${m} harus ditolak 405`);
  }

  // Validasi unit parameter
  assert.equal(validasiQueryEksporRekap(new URLSearchParams("")).ok, false);
  assert.equal(validasiQueryEksporRekap(new URLSearchParams("format=csv")).ok, false);
  assert.equal(
    validasiQueryEksporRekap(new URLSearchParams("format=xlsx&format=pdf")).ok,
    false
  );
  assert.equal(
    validasiQueryEksporRekap(new URLSearchParams("format=xlsx&filename=hack")).ok,
    false
  );
  assert.equal(
    validasiQueryEksporRekap(
      new URLSearchParams("format=xlsx&periode=rentang&dari=2026-01-01&sampai=2027-01-03")
    ).ok,
    false
  );
  assert.equal(
    validasiQueryEksporRekap(
      new URLSearchParams("format=pdf&periode=rentang&dari=2026-01-01&sampai=2027-01-02")
    ).ok,
    true
  );

  // HTTP 400 selalu JSON (bukan file rusak)
  const badFmt = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=csv&periode=rentang&dari=2026-10-01&sampai=2026-10-31"
  );
  assert.equal(badFmt.res.status, 400);
  assert.match(badFmt.res.headers.get("content-type") ?? "", /application\/json/i);
  const badJson = JSON.parse(badFmt.buf.toString("utf-8"));
  assert.match(badJson.error, /format ekspor/i);
});

// ---------- 2. Rentang Kosong, UI Tombol, Header Attachment, & Nol PII / "dikembalikan" ----------

test("rentang kosong (2020-01-01 s/d 2020-01-31) ekspor Excel & PDF valid, header aman, SSR punya tombol 44px", async () => {
  // UI Rekap Bulanan memiliki tombol Unduh Excel & Unduh PDF dengan tap target >= 44px
  const ssrRekap = await ambilHtml(ownerCookie, "/rekap-bulanan");
  assert.equal(ssrRekap.res.status, 200);
  assert.match(ssrRekap.html, /Unduh Excel/);
  assert.match(ssrRekap.html, /Unduh PDF/);
  assert.match(ssrRekap.html, /min-h-\[44px\]/);

  // Halaman Laporan Harian tetap tanpa tombol ekspor
  const ssrHarian = await ambilHtml(ownerCookie, "/laporan-harian");
  assert.equal(ssrHarian.res.status, 200);
  assert.doesNotMatch(ssrHarian.html, /Unduh Excel|Unduh PDF/i);

  // Ekspor Excel rentang kosong
  const xRes = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=xlsx&periode=rentang&dari=2020-01-01&sampai=2020-01-31"
  );
  assert.equal(xRes.res.status, 200);
  assert.equal(
    xRes.res.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(
    xRes.res.headers.get("content-disposition"),
    'attachment; filename="rekap-solemate_2020-01-01_sd_2020-01-31.xlsx"'
  );
  assert.match(xRes.res.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(xRes.res.headers.get("vary") ?? "", /cookie/i);
  assert.equal(xRes.res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(xRes.buf.subarray(0, 2).toString("utf-8"), "PK");

  const xFiles = bongkarXlsx(xRes.buf);
  const allXml = Object.values(xFiles).join("\n");
  assert.match(allXml, /Belum ada layanan pada rentang tanggal ini/i);
  assert.match(allXml, /Belum tersedia: sumber data pengeluaran belum ditentukan/i);
  assert.match(allXml, /99,9%–100,1%/);
  assert.doesNotMatch(allXml, /NaN|undefined/);
  assert.doesNotMatch(allXml, /dikembalikan/i);

  // Ekspor PDF rentang kosong
  const pRes = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=pdf&periode=rentang&dari=2020-01-01&sampai=2020-01-31"
  );
  assert.equal(pRes.res.status, 200);
  assert.equal(pRes.res.headers.get("content-type"), "application/pdf");
  assert.equal(
    pRes.res.headers.get("content-disposition"),
    'attachment; filename="rekap-solemate_2020-01-01_sd_2020-01-31.pdf"'
  );
  assert.equal(pRes.buf.subarray(0, 5).toString("utf-8"), "%PDF-");
  const { teks: pTeks } = ekstrakTeksPdf(pRes.buf);
  assert.match(pTeks, /Belum ada layanan pada rentang tanggal ini/);
  assert.match(pTeks, /Belum tersedia: sumber data pengeluaran belum ditentukan/);
  assert.match(pTeks, /Halaman 1 dari 1/);
  assert.doesNotMatch(pTeks, /NaN|undefined/);
  assert.doesNotMatch(pTeks, /dikembalikan/i);
});

// ---------- 3. >10 Layanan + Lainnya, Ketahanan Injeksi Formula Excel, Konsistensi Model Tunggal, Privasi PII ----------

test("ekspor HTTP >10 layanan + Lainnya, anti-formula injection (=HYPERLINK, +cmd, @SUM, -1), nol PII, & konsisten Excel vs PDF", async () => {
  // Rentang terisolasi: Agustus 2021
  const namaBerbahaya = [
    '=HYPERLINK("http://evil.invalid","Klik")',
    "+cmd|' /C calc'!A0",
    "@SUM(1+1)*10",
    "-1+1",
  ];
  const namaPiiRahasia = "Budi Rahasia Ekspor Jangan Bocor";
  const waPiiRahasia = "6281355667788";

  // 4 layanan injeksi formula masing-masing 27 pasang, lalu 6 layanan lain 27 pasang -> total 10 top = 270
  // Plus 2 layanan kecil agar terbentuk "Lainnya": 22 psg dan 1 psg
  for (let i = 0; i < 10; i++) {
    const nama =
      i < namaBerbahaya.length ? namaBerbahaya[i] : `Layanan Standar Ekspor ${i + 1}`;
    await sisipkanLayananDanTiket({
      namaLayanan: nama,
      harga: 25000,
      jumlah: 27,
      tanggalMasukIso: "2021-08-10 10:00:00+07",
      tanggalBayarIso: "2021-08-10 11:00:00+07",
      statusBayar: "Lunas",
      metodeBayar: i % 2 === 0 ? "Cash" : "Non-cash",
      namaPelanggan: namaPiiRahasia,
      nomorWa: i === 0 ? waPiiRahasia : waUnik62(),
    });
  }
  await sisipkanLayananDanTiket({
    namaLayanan: "Layanan Kecil Ekspor A",
    harga: 30000,
    jumlah: 22,
    tanggalMasukIso: "2021-08-11 10:00:00+07",
    statusBayar: "Belum bayar",
    namaPelanggan: namaPiiRahasia,
  });
  await sisipkanLayananDanTiket({
    namaLayanan: "Layanan Kecil Ekspor B",
    harga: 40000,
    jumlah: 1,
    tanggalMasukIso: "2021-08-12 10:00:00+07",
    tanggalBayarIso: "2021-08-12 12:00:00+07",
    statusBayar: "Lunas",
    metodeBayar: "Non-cash",
    namaPelanggan: namaPiiRahasia,
  });

  // Model dokumen tunggal langsung dari query produksi
  const rekapDb = await ambilRekapBulanan(
    { periode: "rentang", dari: "2021-08-01", sampai: "2021-08-31" },
    adminPool
  );
  const modelDb = bangunModelDokumenRekap(rekapDb, "12 Agustus 2021, 15.00 WIB");
  assert.equal(modelDb.layanan.totalPasang, 293); // 10*27 + 22 + 1
  const barisLainnyaModel = modelDb.layanan.daftar.find((b) => b.adalahLainnya);
  assert.ok(barisLainnyaModel, "Baris Lainnya harus muncul");
  assert.equal(barisLainnyaModel.jumlahPasang, 23); // 22 + 1

  // Hit endpoint Excel
  const xRes = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=xlsx&periode=rentang&dari=2021-08-01&sampai=2021-08-31"
  );
  assert.equal(xRes.res.status, 200);
  const xFiles = bongkarXlsx(xRes.buf);

  // Verifikasi 2 sheet, frozen header, lebar kolom, format angka, NOL formula <f>
  assert.match(xFiles["xl/workbook.xml"], /name="Ringkasan"/);
  assert.match(xFiles["xl/workbook.xml"], /name="Layanan Terlaris"/);
  assert.match(xFiles["xl/worksheets/sheet1.xml"], /state="frozen"/);
  assert.match(xFiles["xl/worksheets/sheet2.xml"], /state="frozen"/);
  assert.match(xFiles["xl/worksheets/sheet1.xml"], /<cols>/);
  assert.match(xFiles["xl/worksheets/sheet2.xml"], /<cols>/);
  assert.match(xFiles["xl/styles.xml"], /&quot;Rp &quot;#,##0/);
  assert.match(xFiles["xl/styles.xml"], /0\.0%/);

  for (const [namaXml, isiXml] of Object.entries(xFiles)) {
    if (namaXml.startsWith("xl/worksheets/")) {
      assert.doesNotMatch(
        isiXml,
        /<f[\s>]/i,
        `Sheet ${namaXml} tidak boleh mengandung tag formula <f>`
      );
    }
  }

  // Semua payload berbahaya =HYPERLINK / +cmd / @SUM / -1 wajib berada di sharedStrings.xml sebagai teks
  const strings = ekstrakSharedStrings(xFiles["xl/sharedStrings.xml"]);
  for (const payload of namaBerbahaya) {
    assert.ok(
      strings.includes(payload),
      `String berbahaya "${payload}" harus tersimpan utuh sebagai shared string teks`
    );
  }
  assert.ok(strings.includes("Lainnya"));
  assert.ok(strings.includes("Tunai / Cash"));
  assert.ok(strings.includes("Non-Cash"));
  assert.ok(
    !strings.includes("Keterangan"),
    "Excel Ringkasan tidak boleh memiliki kolom Keterangan"
  );
  assert.doesNotMatch(
    xFiles["xl/worksheets/sheet1.xml"],
    /<c r="F/,
    "Sheet Ringkasan hanya memiliki 5 kolom (A sampai E)"
  );

  // Pastikan total pasang (293) dan nominal pesanan masuk tersimpan sebagai sel numerik <v> tanpa t="s"
  assert.match(
    xFiles["xl/worksheets/sheet2.xml"],
    /<c r="C16"[^>]*><v>293<\/v><\/c>/
  );
  assert.doesNotMatch(
    xFiles["xl/worksheets/sheet2.xml"],
    /<c r="C16"[^>]*t="s"/
  );

  // Nol PII pelanggan & owner username maupun kata "dikembalikan" di seluruh isi Excel
  const gabungExcel = Object.values(xFiles).join("\n");
  assert.doesNotMatch(gabungExcel, new RegExp(namaPiiRahasia));
  assert.doesNotMatch(gabungExcel, new RegExp(waPiiRahasia));
  assert.doesNotMatch(gabungExcel, new RegExp(OWNER_NAMA));
  assert.doesNotMatch(gabungExcel, /nama_pelanggan|nomor_wa|dikembalikan/i);

  // Hit endpoint PDF untuk rentang yang sama persis
  const pRes = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=pdf&periode=rentang&dari=2021-08-01&sampai=2021-08-31"
  );
  assert.equal(pRes.res.status, 200);
  const { raw: pRaw, baris: pBaris, teksRapi: pTeks } = ekstrakTeksPdf(pRes.buf);

  // Cek kesamaan angka & teks dari model tunggal di PDF (tanpa kolom Keterangan)
  assert.match(pTeks, /Rekap Bulanan Solemate Shoes Clean/);
  assert.match(pTeks, /293/); // total pasang yang sama
  assert.match(pTeks, /Lainnya/);
  assert.match(pTeks, /99,9%-100,1%/);
  assert.match(pTeks, /Belum tersedia: sumber data pengeluaran belum ditentukan/);
  assert.match(pTeks, /Tunai \/ Cash/);
  assert.match(pTeks, /Non-Cash/);
  assert.ok(
    !pBaris.includes("Keterangan"),
    "PDF Ringkasan tidak boleh memiliki header kolom Keterangan"
  );
  assert.doesNotMatch(pTeks, /\bKeterangan\b/);
  assert.doesNotMatch(pRaw, new RegExp(namaPiiRahasia));
  assert.doesNotMatch(pRaw, new RegExp(waPiiRahasia));
  assert.doesNotMatch(pRaw, new RegExp(OWNER_NAMA));
  assert.doesNotMatch(pTeks, new RegExp(namaPiiRahasia));
  assert.doesNotMatch(pTeks, new RegExp(waPiiRahasia));
  assert.doesNotMatch(pTeks, new RegExp(OWNER_NAMA));
  assert.doesNotMatch(pTeks, /dikembalikan/i);
});

// ---------- 4. Sanitasi PDF (Emoji, Non-Latin, Kontrol/Bidi), Wrap Nama Panjang, Pagination + Header Berulang ----------

test("PDF aman terhadap emoji, aksara non-Latin, karakter kontrol/bidi, wrap nama panjang & header tabel berulang lintas halaman", async () => {
  // Uji unit sanitasiTeksPdf
  const hasilSanitasi = sanitasiTeksPdf(
    "Cuci Kilat 👟🔥 日本語 中文 \u0000\u0007\u001b\u202e Café – Spesial"
  );
  assert.doesNotMatch(hasilSanitasi, /[\u0000-\u001F\u007F-\u009F\u202E]/);
  assert.match(hasilSanitasi, /Cuci Kilat \?+ .* Café - Spesial/);

  // Bangun model buatan bersih untuk menguji pagination & repeated header 11 baris dengan nama panjang
  const daftarPanjang = Array.from({ length: 10 }, (_, idx) => ({
    peringkat: idx + 1,
    service_id: idx + 1,
    nama_layanan:
      idx === 0
        ? `Paket 👟✨ 中文 \u0007 Super Panjang Perawatan Sepatu Kulit & Suede Eksklusif Seri ${idx + 1} `.repeat(3)
        : `Paket Perawatan Sepatu Kulit, Kanvas, Suede & Repaint Premium Nomor ${idx + 1} `.repeat(3),
    aktif: true,
    jumlah_pasang: 10,
    persentase_pasang: 9.1,
    total_nominal: 100000,
    adalah_lainnya: false,
  }));
  daftarPanjang.push({
    peringkat: null,
    service_id: null,
    nama_layanan: "Lainnya",
    aktif: true,
    jumlah_pasang: 10,
    persentase_pasang: 9.1,
    total_nominal: 100000,
    adalah_lainnya: true,
  });

  const modelPanjang = bangunModelDokumenRekap(
    {
      periode: "rentang",
      rentang: { dari: "2026-09-01", sampai: "2026-09-30", hari_ini: "2026-09-30" },
      disclaimer: "Angka dihitung dari data tiket saat ini; perubahan setelah periode berlalu dapat menggeser angka hari lampau.",
      pesanan_masuk: {
        total_tiket: 11,
        total_pasang: 110,
        total_nominal: 1100000,
        lunas: { total_tiket: 10, total_pasang: 100, total_nominal: 1000000 },
        belum_bayar: { total_tiket: 1, total_pasang: 10, total_nominal: 100000 },
      },
      pembayaran_diterima: {
        total_tiket: 10,
        total_nominal: 1000000,
        cash: { total_tiket: 6, total_nominal: 600000, label: "Cash tercatat di sistem" },
        non_cash: { total_tiket: 4, total_nominal: 400000 },
      },
      layanan_terlaris: {
        total_pasang: 110,
        total_nominal: 1100000,
        jumlah_layanan_unik: 13,
        daftar: daftarPanjang,
        catatan_pembulatan:
          "Persentase dibulatkan satu desimal per baris (termasuk Lainnya) dari porsi aslinya terhadap total pasang; total dapat berkisar 99,9%–100,1% akibat pembulatan.",
      },
      laba_rugi: {
        tersedia: false,
        pesan: "Belum tersedia: sumber data pengeluaran belum ditentukan",
      },
    },
    "30 September 2026, 20.00 WIB"
  );

  const pdfBuf = await renderRekapPdf(modelPanjang);
  assert.equal(pdfBuf.subarray(0, 5).toString("utf-8"), "%PDF-");
  const { raw: pdfRaw, baris: pdfBaris, teks: pdfText } = ekstrakTeksPdf(pdfBuf);

  // Pastikan multi-halaman (>1) dengan halaman bernomor & header tabel berulang ("Nama Layanan" muncul >= 2 kali)
  assert.match(pdfText, /Halaman 1 dari 2/);
  assert.match(pdfText, /Halaman 2 dari 2/);
  const jumlahHeaderTabel = pdfBaris.filter((b) => b === "Nama Layanan").length;
  assert.ok(
    jumlahHeaderTabel >= 2,
    `Header tabel Layanan Terlaris harus berulang di halaman baru (ditemukan ${jumlahHeaderTabel} kali)`
  );
  // Pastikan hanya font lokal Helvetica, bukan eksternal
  assert.match(pdfRaw, /\/BaseFont \/Helvetica/);
  assert.doesNotMatch(pdfRaw, /https?:\/\//);
});

// ---------- 5. Audit EKSPOR_REKAP & Fail-Closed ----------

test("audit EKSPOR_REKAP tercatat lengkap tanpa isi laporan/PII dan bersifat fail-closed jika INSERT audit gagal", async () => {
  const sebelum = await adminPool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs WHERE aksi = 'EKSPOR_REKAP' AND user_id = $1`,
    [ownerId]
  );

  // Trigger 1x ekspor xlsx lewat HTTP
  const resHttp = await fetchBiner(
    ownerCookie,
    "/api/rekap-bulanan/ekspor?format=xlsx&periode=rentang&dari=2020-02-01&sampai=2020-02-28"
  );
  assert.equal(resHttp.res.status, 200);

  const sesudah = await adminPool.query(
    `SELECT entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id
     FROM audit_logs
     WHERE aksi = 'EKSPOR_REKAP' AND user_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [ownerId]
  );
  assert.equal(sesudah.rowCount, 1);
  const baris = sesudah.rows[0];
  assert.equal(baris.entitas, "rekap_bulanan");
  assert.equal(baris.entitas_id, 0);
  assert.equal(baris.aksi, "EKSPOR_REKAP");
  assert.equal(baris.nilai_lama, null);
  assert.deepEqual(baris.nilai_baru, {
    format: "xlsx",
    dari: "2020-02-01",
    sampai: "2020-02-28",
  });

  // Jumlah baris bertambah
  const totalSesudah = await adminPool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs WHERE aksi = 'EKSPOR_REKAP' AND user_id = $1`,
    [ownerId]
  );
  assert.equal(totalSesudah.rows[0].n, sebelum.rows[0].n + 1);

  // Fail-closed: jika logging audit gagal, ekspor wajib melempar galat dan TIDAK mengembalikan buffer
  await assert.rejects(
    async () => {
      await eksporRekapDenganAudit({
        filter: { periode: "rentang", dari: "2020-02-01", sampai: "2020-02-28" },
        format: "pdf",
        userId: ownerId,
        poolClient: adminPool,
        auditLogger: async () => {
          throw new Error("SIMULASI_AUDIT_LOG_GAGAL");
        },
      });
    },
    /SIMULASI_AUDIT_LOG_GAGAL/
  );
});

// ---------- 6. Bukti Gagal-Lalu-Lulus 1: Injeksi Formula Excel (HANYA pembanding cacat di tes) ----------

async function renderExcelDenganFormulaCacatPembanding(namaLayananBerbahaya) {
  // Implementasi pembanding cacat di berkas tes: menulis string berawalan '=' sebagai type: 'Formula'
  return await writeXlsxFile(
    [
      [
        { value: "Nama Layanan", type: String, fontWeight: "bold" },
        {
          value: namaLayananBerbahaya.slice(1), // write-excel-file Formula expects without leading '='
          type: "Formula",
        },
      ],
    ],
    {}
  ).toBuffer();
}

test("BUKTI 1 (gagal-lalu-lulus): pembanding cacat menghasilkan tag <f> formula; kode produksi menyimpannya sebagai string aman", async () => {
  const payload = '=HYPERLINK("http://evil.invalid","KLIK")';

  // FASE GAGAL (pembanding cacat): XML sheet mengandung tag formula <f>
  const bufCacat = await renderExcelDenganFormulaCacatPembanding(payload);
  const xmlCacat = bongkarXlsx(bufCacat)["xl/worksheets/sheet1.xml"];
  assert.throws(
    () => {
      assert.doesNotMatch(xmlCacat, /<f[\s>]/i, "Tidak boleh ada formula Excel <f>");
    },
    /did not expect|Tidak boleh ada formula Excel/,
    "Pembanding cacat harus gagal terhadap assertion anti-formula"
  );
  console.log("[BUKTI-1-GAGAL] Implementasi pembanding cacat menyisipkan tag <f> pada sheet1.xml");

  // FASE LULUS (kode produksi renderRekapExcel)
  const model = bangunModelDokumenRekap(
    {
      periode: "rentang",
      rentang: { dari: "2021-08-01", sampai: "2021-08-31", hari_ini: "2021-08-31" },
      disclaimer:
        "Angka dihitung dari data tiket saat ini; perubahan setelah periode berlalu dapat menggeser angka hari lampau.",
      pesanan_masuk: {
        total_tiket: 1,
        total_pasang: 1,
        total_nominal: 50000,
        lunas: { total_tiket: 1, total_pasang: 1, total_nominal: 50000 },
        belum_bayar: { total_tiket: 0, total_pasang: 0, total_nominal: 0 },
      },
      pembayaran_diterima: {
        total_tiket: 1,
        total_nominal: 50000,
        cash: { total_tiket: 1, total_nominal: 50000, label: "Cash tercatat di sistem" },
        non_cash: { total_tiket: 0, total_nominal: 0 },
      },
      layanan_terlaris: {
        total_pasang: 1,
        total_nominal: 50000,
        jumlah_layanan_unik: 1,
        daftar: [
          {
            peringkat: 1,
            service_id: 999,
            nama_layanan: payload,
            aktif: true,
            jumlah_pasang: 1,
            persentase_pasang: 100,
            total_nominal: 50000,
            adalah_lainnya: false,
          },
        ],
        catatan_pembulatan:
          "Persentase dibulatkan satu desimal per baris (termasuk Lainnya) dari porsi aslinya terhadap total pasang; total dapat berkisar 99,9%–100,1% akibat pembulatan.",
      },
      laba_rugi: {
        tersedia: false,
        pesan: "Belum tersedia: sumber data pengeluaran belum ditentukan",
      },
    },
    "31 Agustus 2021, 10.00 WIB"
  );
  const bufProduksi = await renderRekapExcel(model);
  const filesProduksi = bongkarXlsx(bufProduksi);
  for (const [k, v] of Object.entries(filesProduksi)) {
    if (k.startsWith("xl/worksheets/")) {
      assert.doesNotMatch(v, /<f[\s>]/i);
    }
  }
  const strings = ekstrakSharedStrings(filesProduksi["xl/sharedStrings.xml"]);
  assert.ok(strings.includes(payload));
  console.log("[BUKTI-1-LULUS] Kode produksi renderRekapExcel() menyimpan payload '=HYPERLINK(...)' sebagai String murni tanpa <f>");
});

// ---------- 7. Bukti Gagal-Lalu-Lulus 2: Angka Disimpan sebagai Teks vs Numerik Asli ----------

async function renderExcelAngkaSebagaiTeksPembandingCacat(nominal) {
  // Implementasi pembanding cacat di berkas tes: menulis nominal sebagai string teks berformat Rupiah
  return await writeXlsxFile(
    [
      [
        { value: "Nominal", type: String, fontWeight: "bold" },
        { value: `Rp ${nominal.toLocaleString("id-ID")}`, type: String },
      ],
    ],
    {}
  ).toBuffer();
}

test("BUKTI 2 (gagal-lalu-lulus): pembanding cacat menyimpan angka sebagai teks (t='s'); kode produksi menyimpan sel numerik berformat Rupiah", async () => {
  const nominalUji = 250000;

  // FASE GAGAL (pembanding cacat): sel B1 bertipe t="s" (teks), bukan numerik
  const bufCacat = await renderExcelAngkaSebagaiTeksPembandingCacat(nominalUji);
  const xmlCacat = bongkarXlsx(bufCacat)["xl/worksheets/sheet1.xml"];
  assert.throws(
    () => {
      assert.match(xmlCacat, /<c r="B1"[^>]*><v>250000<\/v><\/c>/);
      assert.doesNotMatch(xmlCacat, /<c r="B1"[^>]*t="s"/);
    },
    /did not match|Expected/,
    "Pembanding cacat harus gagal karena menyimpan angka sebagai String"
  );
  console.log("[BUKTI-2-GAGAL] Implementasi pembanding cacat menyimpan Rp 250.000 sebagai sel teks (t=\"s\"), bukan sel numerik");

  // FASE LULUS (kode produksi renderRekapExcel)
  const model = bangunModelDokumenRekap(
    {
      periode: "rentang",
      rentang: { dari: "2026-10-01", sampai: "2026-10-31", hari_ini: "2026-10-31" },
      disclaimer: "Angka dihitung dari data tiket saat ini; perubahan setelah periode berlalu dapat menggeser angka hari lampau.",
      pesanan_masuk: {
        total_tiket: 1,
        total_pasang: 2,
        total_nominal: nominalUji,
        lunas: { total_tiket: 1, total_pasang: 2, total_nominal: nominalUji },
        belum_bayar: { total_tiket: 0, total_pasang: 0, total_nominal: 0 },
      },
      pembayaran_diterima: {
        total_tiket: 1,
        total_nominal: nominalUji,
        cash: { total_tiket: 1, total_nominal: nominalUji, label: "Cash tercatat di sistem" },
        non_cash: { total_tiket: 0, total_nominal: 0 },
      },
      layanan_terlaris: {
        total_pasang: 2,
        total_nominal: nominalUji,
        jumlah_layanan_unik: 1,
        daftar: [
          {
            peringkat: 1,
            service_id: 99,
            nama_layanan: "Deep Clean Test",
            aktif: true,
            jumlah_pasang: 2,
            persentase_pasang: 100,
            total_nominal: nominalUji,
            adalah_lainnya: false,
          },
        ],
        catatan_pembulatan:
          "Persentase dibulatkan satu desimal per baris (termasuk Lainnya) dari porsi aslinya terhadap total pasang; total dapat berkisar 99,9%–100,1% akibat pembulatan.",
      },
      laba_rugi: {
        tersedia: false,
        pesan: "Belum tersedia: sumber data pengeluaran belum ditentukan",
      },
    },
    "31 Oktober 2026, 23.00 WIB"
  );

  const bufProduksi = await renderRekapExcel(model);
  const filesProduksi = bongkarXlsx(bufProduksi);
  const sheetRingkasan = filesProduksi["xl/worksheets/sheet1.xml"];
  // E6 = Total Pesanan Masuk nominal (row 6 col E)
  assert.match(sheetRingkasan, /<c r="E6"[^>]*><v>250000<\/v><\/c>/);
  assert.doesNotMatch(sheetRingkasan, /<c r="E6"[^>]*t="s"/);
  assert.match(filesProduksi["xl/styles.xml"], /&quot;Rp &quot;#,##0/);
  console.log("[BUKTI-2-LULUS] Kode produksi renderRekapExcel() menyimpan 250000 sebagai sel numerik <v>250000</v> dengan format '\"Rp \"#,##0'");
});
