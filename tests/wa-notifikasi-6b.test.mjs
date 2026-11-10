// Test Suite Phase 6B: Notifikasi WhatsApp Otomatis "Siap diambil" (FR-24).
// Menguji pemicu transisi status, idempotensi unik (order_id, jenis), klaim atomik,
// penanganan baris macet, gateway error handling & kirim ulang kasir,
// batas laju (RATE_LIMIT_TERCAPAI), pencegahan bocor data & nomor tidak terpercaya,
// perintah bot STOP/MULAI, toggle pelanggan toko, hak database solemate_app,
// dan kepatuhan Zero Trust.
//
// Dijalankan HANYA di database uji sementara solemate_test lewat with-test-db.mjs.
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/wa-notifikasi-6b.test.mjs'

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import {
  MockWaGatewayAdapter,
  aturWaGatewayInstance,
} from "../src/lib/wa-gateway.ts";
import {
  buatPesanNotifikasiSiapDiambil,
} from "../src/config/wa-bot.ts";
import {
  prosesNotifikasiSiapDiambil,
  periksaKelayakanKirimUlang,
  ambilNotifikasiTiket,
} from "../src/lib/wa-notifikasi.ts";
import {
  prosesWebhookMasukWa,
  buatKunciRateLimit,
} from "../src/lib/wa-bot.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner 6B ${Date.now()}`;
const KASIR_NAMA = `Kasir 6B ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_PIN = pin6();

let admin;
let app;
let ownerCookie;
let kasirCookie;
let mockGateway;
let layananUjiId;

let urutWa = 8000;
function waUnik08() {
  urutWa += 1;
  return `08129900${String(urutWa).padStart(4, "0")}`;
}

async function login(username, pin) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(res.status, 200, `login ${username} harus 200, dapat ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function api(cookie, method, url, body, opsi = {}) {
  const headers = { ...(opsi.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    headers.Origin = opsi.origin ?? BASE;
  }
  return fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}

before(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  app = new Pool({ connectionString: process.env.DATABASE_URL_APP });

  mockGateway = new MockWaGatewayAdapter();
  aturWaGatewayInstance(mockGateway);

  // Buat akun owner & kasir
  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasirCookie = await login(KASIR_NAMA, KASIR_PIN);

  // Layanan uji
  const sRes = await admin.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ($1, 45000, 3, true)
     RETURNING id`,
    [`Cuci 6B ${Date.now()}`]
  );
  layananUjiId = sRes.rows[0].id;
});

after(async () => {
  aturWaGatewayInstance(null);
  await admin?.end();
  await app?.end();
});

beforeEach(async () => {
  process.env.WA_NOTIFIKASI_AKTIF = "true";
  mockGateway.reset();
  await admin.query("DELETE FROM wa_rate_limit");
  await admin.query("DELETE FROM wa_messages");
});

async function buatTiketUji(opsi = {}) {
  const nomorWa = opsi.nomorWa ?? waUnik08();
  const nama = opsi.nama ?? `Pelanggan ${Date.now()}`;
  const res = await api(kasirCookie, "POST", "/api/tiket", {
    nama_pelanggan: nama,
    nomor_wa: nomorWa,
    jangan_kirim_notifikasi_wa: Boolean(opsi.janganKirimNotif),
    items: [
      {
        service_id: layananUjiId,
        deskripsi_barang: "Sneakers Uji 6B",
        jumlah: 1,
      },
    ],
    status_bayar: opsi.statusBayar ?? "Belum bayar",
    metode_bayar: opsi.statusBayar === "Lunas" ? "Cash" : null,
  });
  assert.equal(res.status, 201, "Pembuatan tiket uji harus 201");
  const json = await res.json();
  return json.data;
}

// Helper untuk memajukan tiket sesuai alur alur_pesanan satu langkah demi satu langkah (Phase 5B)
async function majuKeSiapDiambil(tiketId) {
  const p1 = await api(kasirCookie, "PATCH", `/api/tiket/${tiketId}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(p1.status, 200, "Maju ke Diproses harus 200");

  const p2 = await api(
    kasirCookie,
    "PATCH",
    `/api/tiket/${tiketId}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Siap diambil",
      status_sebelumnya: "Diproses",
    },
    { headers: { "x-sync-notifikasi": "1" } }
  );
  assert.equal(p2.status, 200, "Maju ke Siap diambil harus 200");
  return p2;
}

// =========================================================================
// 1. Uji Pemicu Transisi ke "Siap diambil" & Idempotensi
// =========================================================================
test("transisi ke 'Diproses' tidak membuat antrean wa_notifikasi; transisi ke 'Siap diambil' membuat tepat 1 antrean dan terkirim", async () => {
  const t = await buatTiketUji();

  // Maju ke "Diproses"
  const patch1 = await api(kasirCookie, "PATCH", `/api/tiket/${t.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(patch1.status, 200);

  const cekNotif1 = await admin.query(
    "SELECT * FROM wa_notifikasi WHERE order_id = $1",
    [t.id]
  );
  assert.equal(cekNotif1.rowCount, 0, "Status Diproses tidak boleh membuat wa_notifikasi");
  assert.equal(mockGateway.pesanTerkirim.length, 0, "Belum ada pesan terkirim");

  // Maju ke "Siap diambil" dengan sinkronisasi tes
  const patch2 = await api(
    kasirCookie,
    "PATCH",
    `/api/tiket/${t.id}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Siap diambil",
      status_sebelumnya: "Diproses",
    },
    { headers: { "x-sync-notifikasi": "1" } }
  );
  assert.equal(patch2.status, 200);

  const cekNotif2 = await admin.query(
    "SELECT * FROM wa_notifikasi WHERE order_id = $1",
    [t.id]
  );
  assert.equal(cekNotif2.rowCount, 1, "Harus ada tepat 1 baris di wa_notifikasi");
  assert.equal(cekNotif2.rows[0].jenis, "siap_diambil");
  assert.equal(cekNotif2.rows[0].status, "terkirim");
  assert.ok(cekNotif2.rows[0].terkirim_pada, "terkirim_pada harus terisi");
});

test("idempotensi transisi: koreksi mundur tidak mengirim; maju lagi ke 'Siap diambil' tidak membuat baris duplikat dan tidak kirim ulang", async () => {
  const t = await buatTiketUji();

  // Maju sesuai urutan ke Siap diambil
  await majuKeSiapDiambil(t.id);
  const n1 = await ambilNotifikasiTiket(t.id, admin);
  assert.equal(n1.status, "terkirim", "Notifikasi pertama harus terkirim");

  // Koreksi mundur satu langkah ke Diproses
  const patchMundur = await api(
    kasirCookie,
    "PATCH",
    `/api/tiket/${t.id}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Diproses",
      status_sebelumnya: "Siap diambil",
    },
    { headers: { "x-sync-notifikasi": "1" } }
  );
  assert.equal(patchMundur.status, 200);

  // Maju kembali ke Siap diambil
  const patchMajuLagi = await api(
    kasirCookie,
    "PATCH",
    `/api/tiket/${t.id}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Siap diambil",
      status_sebelumnya: "Diproses",
    },
    { headers: { "x-sync-notifikasi": "1" } }
  );
  assert.equal(patchMajuLagi.status, 200);

  const cekNotif = await admin.query(
    "SELECT * FROM wa_notifikasi WHERE order_id = $1",
    [t.id]
  );
  assert.equal(cekNotif.rowCount, 1, "Tepat 1 baris wa_notifikasi (UNIQUE order_id, jenis)");
  assert.equal(cekNotif.rows[0].percobaan, 1, "Tidak boleh ada percobaan pengiriman ulang kedua");
});

// =========================================================================
// 2. Uji Klaim Atomik Konkurensi & Baris Macet
// =========================================================================
test("klaim atomik konkurensi: dua proses serentak pada tiket yang sama hanya menghasilkan 1 kiriman", async () => {
  const t = await buatTiketUji();

  // Siapkan antrean dengan status 'menunggu' di DB langsung
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan, dibuat_pada, diperbarui_pada)
     VALUES ($1, 'siap_diambil', 'menunggu', 0, now(), now())`,
    [t.id]
  );

  // Jalankan 2 pemanggilan prosesNotifikasiSiapDiambil secara serentak
  const [hasil1, hasil2] = await Promise.all([
    prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true }),
    prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true }),
  ]);

  // Salah satu sukses terkirim, satu lagi diabaikan karena status sudah diklaim
  const adaTerkirim = hasil1.status === "terkirim" || hasil2.status === "terkirim";
  assert.ok(adaTerkirim, "Salah satu proses harus berhasil mengirim");
  assert.equal(mockGateway.pesanTerkirim.length, 1, "Hanya 1 pesan terkirim ke gateway mock");
});

test("baris macet di status 'mengirim' (> 2 menit) berhasil diambil alih dan diproses oleh pemanggil berikutnya", async () => {
  const t = await buatTiketUji();

  // Simulasikan baris macet di 'mengirim' sejak 3 menit yang lalu
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan, dibuat_pada, diperbarui_pada)
     VALUES ($1, 'siap_diambil', 'mengirim', 1, now() - interval '3 minutes', now() - interval '3 minutes')`,
    [t.id]
  );

  const hasil = await prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.status, "terkirim");
  assert.equal(mockGateway.pesanTerkirim.length, 1, "Baris macet berhasil dikirim");
});

// =========================================================================
// 3. Uji Kegagalan Gateway & Kirim Ulang Kasir
// =========================================================================
test("gateway kirim gagal: status tiket tetap sukses, notifikasi berstatus gagal, dan kirim ulang kasir berhasil setelah gateway sehat", async () => {
  const t = await buatTiketUji();

  // Maju ke Diproses dulu
  await api(kasirCookie, "PATCH", `/api/tiket/${t.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });

  // Uji langsung prosesNotifikasiSiapDiambil saat gateway gagal kirim
  mockGateway.simulasikanGagal = true;
  mockGateway.pesanGagal = "Koneksi gateway terputus";

  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)`,
    [t.id]
  );
  const hasilGagal = await prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true });
  assert.equal(hasilGagal.ok, false);
  assert.equal(hasilGagal.status, "gagal");
  assert.equal(hasilGagal.kode_galat, "GATEWAY_KIRIM_GAGAL");

  const notifGagal = await ambilNotifikasiTiket(t.id, admin);
  assert.equal(notifGagal.status, "gagal");
  assert.equal(notifGagal.kode_galat, "GATEWAY_KIRIM_GAGAL");

  // Pulihkan gateway
  mockGateway.simulasikanGagal = false;

  // Kasir melakukan kirim ulang via endpoint POST /api/tiket/[id]/notifikasi
  const resRetry = await api(kasirCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resRetry.status, 200, "Kirim ulang kasir harus 200");
  const jsonRetry = await resRetry.json();
  assert.equal(jsonRetry.ok, true);
  assert.equal(jsonRetry.status, "terkirim");

  const notifSukses = await ambilNotifikasiTiket(t.id, admin);
  assert.equal(notifSukses.status, "terkirim");
  assert.equal(notifSukses.kode_galat, null);
});

// =========================================================================
// 4. Uji Otorisasi & Penolakan 409 pada Kirim Ulang
// =========================================================================
test("otorisasi kirim ulang: owner dan pengguna tanpa login ditolak 403", async () => {
  const t = await buatTiketUji();

  // Owner ditolak
  const resOwner = await api(ownerCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resOwner.status, 403, "Owner harus ditolak 403");

  // Tanpa sesi diarahkan ke login (307 redirect)
  const resAnon = await api(null, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.ok(
    resAnon.status === 403 || resAnon.status === 307 || resAnon.status === 302,
    "Tanpa login harus ditolak 403 atau dialihkan ke login (307)"
  );
});

test("penolakan 409 pada kirim ulang untuk status dilewati yang tidak dapat dipaksa", async () => {
  const t = await buatTiketUji();

  // 1. Alasan opt_out_pelanggan
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, alasan_dilewati, percobaan)
     VALUES ($1, 'siap_diambil', 'dilewati', 'opt_out_pelanggan', 0)
     ON CONFLICT (order_id, jenis) DO UPDATE SET status = 'dilewati', alasan_dilewati = 'opt_out_pelanggan'`,
    [t.id]
  );
  const resOptOut = await api(kasirCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resOptOut.status, 409, "opt_out_pelanggan harus ditolak 409");
  const j1 = await resOptOut.json();
  assert.equal(j1.kode_konflik, "PELANGGAN_OPT_OUT");

  // 2. Alasan nomor_tidak_terverifikasi
  await admin.query(
    `UPDATE wa_notifikasi SET status = 'dilewati', alasan_dilewati = 'nomor_tidak_terverifikasi' WHERE order_id = $1`,
    [t.id]
  );
  const resUnverified = await api(kasirCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resUnverified.status, 409, "nomor_tidak_terverifikasi harus ditolak 409");
  const j2 = await resUnverified.json();
  assert.equal(j2.kode_konflik, "NOMOR_TIDAK_TERVERIFIKASI");

  // 3. Alasan nomor_tidak_terdaftar_wa
  await admin.query(
    `UPDATE wa_notifikasi SET status = 'dilewati', alasan_dilewati = 'nomor_tidak_terdaftar_wa' WHERE order_id = $1`,
    [t.id]
  );
  const resNotOnWa = await api(kasirCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resNotOnWa.status, 409, "nomor_tidak_terdaftar_wa harus ditolak 409");
  const j3 = await resNotOnWa.json();
  assert.equal(j3.kode_konflik, "NOMOR_TIDAK_TERDAFTAR");

  // 4. Alasan saklar_mati: validasi fungsi kelayakan saat saklar mati vs nyala
  const cekMati = periksaKelayakanKirimUlang("dilewati", "saklar_mati", null, false);
  assert.equal(cekMati.boleh, false);
  assert.equal(cekMati.kodeKonflik, "SAKLAR_NOTIFIKASI_MATI");

  const cekNyala = periksaKelayakanKirimUlang("dilewati", "saklar_mati", null, true);
  assert.equal(cekNyala.boleh, true);

  // Dan via API saat saklar aktif (setelah sebelumnya saklar_mati)
  await admin.query(
    `UPDATE wa_notifikasi SET status = 'dilewati', alasan_dilewati = 'saklar_mati' WHERE order_id = $1`,
    [t.id]
  );
  const resSwitchOn = await api(kasirCookie, "POST", `/api/tiket/${t.id}/notifikasi`);
  assert.equal(resSwitchOn.status, 200, "saklar_mati setelah saklar aktif harus berhasil dikirim ulang (200)");
});

// =========================================================================
// 5. Uji Batas Laju (RATE_LIMIT_TERCAPAI)
// =========================================================================
test("batas laju tercapai: baris tetap menunggu (bukan gagal) dengan kode_galat RATE_LIMIT_TERCAPAI", async () => {
  const t = await buatTiketUji();

  // Penuhi batas laju keluar dengan insert kunci HMAC yang tepat ke wa_rate_limit
  const kunciMenit = buatKunciRateLimit("global_outbound_notifikasi", "notif_out_menit");
  await admin.query(
    `INSERT INTO wa_rate_limit (kunci, kategori, hitungan, window_mulai)
     VALUES ($1, 'notif_out_menit', 50, now())
     ON CONFLICT (kunci, kategori) DO UPDATE SET hitungan = 50, window_mulai = now()`,
    [kunciMenit]
  );

  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)`,
    [t.id]
  );

  const hasil = await prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true });
  assert.equal(hasil.status, "menunggu", "Status harus tetap 'menunggu', BUKAN 'gagal'");
  assert.equal(hasil.kode_galat, "RATE_LIMIT_TERCAPAI");

  const notif = await ambilNotifikasiTiket(t.id, admin);
  assert.equal(notif.status, "menunggu");
  assert.equal(notif.kode_galat, "RATE_LIMIT_TERCAPAI");
});

// =========================================================================
// 6. Uji Cek Nomor Terdaftar di WAHA (check-exists)
// =========================================================================
test("cek nomor WAHA: nomor tidak terdaftar ditandai dilewati; kegagalan endpoint ditandai gagal sementara", async () => {
  const t1 = await buatTiketUji();
  const t2 = await buatTiketUji();

  // Nomor 1: Tidak terdaftar
  mockGateway.setMockCheckExists(t1.pelanggan.nomor_wa, false);
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)`,
    [t1.id]
  );
  const hasil1 = await prosesNotifikasiSiapDiambil(t1.id, { lewatiJeda: true });
  assert.equal(hasil1.status, "dilewati");
  assert.equal(hasil1.alasan_dilewati, "nomor_tidak_terdaftar_wa");

  // Nomor 2: Endpoint WAHA error / timeout -> gagal sementara, bukan tidak terdaftar
  mockGateway.setMockCheckExistsError(t2.pelanggan.nomor_wa, "WAHA HTTP 500: Server Error");
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)`,
    [t2.id]
  );
  const hasil2 = await prosesNotifikasiSiapDiambil(t2.id, { lewatiJeda: true });
  assert.equal(hasil2.status, "gagal");
  assert.equal(hasil2.kode_galat, "GATEWAY_CHECK_GAGAL");
});

// =========================================================================
// 7. Uji Format & Privasi Pesan Notifikasi (Requirement 8)
// =========================================================================
test("isi pesan notifikasi: hanya kode tiket, siap diambil, dan status bayar (tanpa nama pelanggan, tanpa harga, tanpa nama toko)", async () => {
  const pesanBelumBayar = buatPesanNotifikasiSiapDiambil("SM-20261110-001", "Belum bayar");
  const pesanLunas = buatPesanNotifikasiSiapDiambil("SM-20261110-002", "Lunas");

  // Harus memuat info wajib
  assert.ok(pesanBelumBayar.includes("SM-20261110-001"));
  assert.ok(pesanBelumBayar.includes("sepatu sudah selesai dan siap diambil"));
  assert.ok(pesanBelumBayar.includes("Belum bayar"));

  assert.ok(pesanLunas.includes("SM-20261110-002"));
  assert.ok(pesanLunas.includes("sepatu sudah selesai dan siap diambil"));
  assert.ok(pesanLunas.includes("Lunas"));

  // TIDAK boleh memuat data terlarang
  const teksGabung = `${pesanBelumBayar} ${pesanLunas}`;
  assert.ok(!teksGabung.includes("Solemate"), "Tidak boleh memuat nama toko");
  assert.ok(!teksGabung.includes("Rp"), "Tidak boleh memuat harga rupiah");
  assert.ok(!teksGabung.includes("45.000"), "Tidak boleh memuat nominal harga");
  assert.ok(!teksGabung.includes("Budi"), "Tidak boleh memuat nama pelanggan");
  assert.ok(!teksGabung.includes("Jalan"), "Tidak boleh memuat alamat");
  assert.ok(!teksGabung.includes("WIB"), "Tidak boleh memuat jam/tanggal luar data");
});

// =========================================================================
// 8. Uji Tiket Toko & Checkbox Jangan Kirim Notifikasi (Requirement 6)
// =========================================================================
test("tiket toko dengan nomor WA kasir berhasil dikirim; opsi jangan kirim notifikasi menandai opt_out_pelanggan", async () => {
  // Tiket toko normal
  const tNormal = await buatTiketUji();
  await majuKeSiapDiambil(tNormal.id);
  const nNormal = await ambilNotifikasiTiket(tNormal.id, admin);
  assert.equal(nNormal.status, "terkirim");

  // Tiket toko dengan checkbox "jangan kirim notifikasi"
  const tOptOut = await buatTiketUji({ janganKirimNotif: true });
  await majuKeSiapDiambil(tOptOut.id);
  const nOptOut = await ambilNotifikasiTiket(tOptOut.id, admin);
  assert.equal(nOptOut.status, "dilewati");
  assert.equal(nOptOut.alasan_dilewati, "opt_out_pelanggan");
});

// =========================================================================
// 9. Uji Perintah Bot WhatsApp "STOP" dan "MULAI" (Requirement 5)
// =========================================================================
test("perintah bot STOP dan MULAI hanya mempengaruhi pelanggan terverifikasi; @lid tak terpetakan tidak menyentuh data siapapun", async () => {
  const nomorWa = waUnik08();
  const nomorWaDb = "62" + nomorWa.slice(1);
  const nama = "Pelanggan Bot OptOut";

  // Daftarkan pelanggan di database dengan format nomor internasional 62...
  const cRes = await admin.query(
    "INSERT INTO customers (nama, nomor_wa, notifikasi_wa_aktif) VALUES ($1, $2, true) RETURNING id",
    [nama, nomorWaDb]
  );
  const customerId = cRes.rows[0].id;

  // 1. Pengirim nomor terverifikasi mengirim "STOP"
  const payloadStop = {
    event: "message",
    payload: {
      id: `msg-stop-${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      from: `${nomorWaDb}@c.us`,
      fromMe: false,
      body: "STOP",
    },
  };
  await prosesWebhookMasukWa(payloadStop);

  const cekAfterStop = await admin.query(
    "SELECT notifikasi_wa_aktif FROM customers WHERE id = $1",
    [customerId]
  );
  assert.equal(cekAfterStop.rows[0].notifikasi_wa_aktif, false, "STOP harus menonaktifkan notifikasi");
  assert.ok(
    mockGateway.pesanTerkirim.some((p) => p.teks.includes("dinonaktifkan")),
    "Balasan STOP harus memuat konfirmasi nonaktif"
  );

  mockGateway.reset();

  // 2. Pengirim nomor terverifikasi mengirim "MULAI"
  const payloadMulai = {
    event: "message",
    payload: {
      id: `msg-mulai-${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      from: `${nomorWaDb}@c.us`,
      fromMe: false,
      body: "MULAI",
    },
  };
  await prosesWebhookMasukWa(payloadMulai);

  const cekAfterMulai = await admin.query(
    "SELECT notifikasi_wa_aktif FROM customers WHERE id = $1",
    [customerId]
  );
  assert.equal(cekAfterMulai.rows[0].notifikasi_wa_aktif, true, "MULAI harus mengaktifkan kembali");
  assert.ok(
    mockGateway.pesanTerkirim.some((p) => p.teks.includes("diaktifkan kembali")),
    "Balasan MULAI harus memuat konfirmasi aktif"
  );

  mockGateway.reset();

  // 3. Pengirim @lid tak terpetakan mengirim "STOP": TIDAK boleh menyentuh pelanggan manapun
  const countSebelum = await admin.query(
    "SELECT COUNT(*) FROM customers WHERE notifikasi_wa_aktif = false"
  );
  const payloadLidStop = {
    event: "message",
    payload: {
      id: `msg-lid-stop-${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      from: "998877665544@lid",
      fromMe: false,
      body: "STOP",
    },
  };
  await prosesWebhookMasukWa(payloadLidStop);

  const countSetelah = await admin.query(
    "SELECT COUNT(*) FROM customers WHERE notifikasi_wa_aktif = false"
  );
  assert.equal(
    countSebelum.rows[0].count,
    countSetelah.rows[0].count,
    "STOP dari unmapped @lid tidak boleh mengubah data siapapun"
  );
  assert.ok(
    mockGateway.pesanTerkirim.some((p) => p.teks.includes("privasi (@lid)")),
    "Balasan ke @lid harus memuat petunjuk"
  );
});

// =========================================================================
// 10. Uji Kasir Toggle Notifikasi Pelanggan & Audit Log (Requirement 6)
// =========================================================================
test("kasir toggle preferensi notifikasi pelanggan mencatat audit_logs tanpa menyertakan nomor WA", async () => {
  const t = await buatTiketUji();
  const customerId = t.pelanggan.id;

  // Kasir mematikan notifikasi
  const resPatch = await api(kasirCookie, "PATCH", `/api/pelanggan/${customerId}/notifikasi`, {
    aktif: false,
  });
  assert.equal(resPatch.status, 200);

  const cCek = await admin.query(
    "SELECT notifikasi_wa_aktif FROM customers WHERE id = $1",
    [customerId]
  );
  assert.equal(cCek.rows[0].notifikasi_wa_aktif, false);

  // Periksa audit log
  const auditRes = await admin.query(
    `SELECT * FROM audit_logs
     WHERE entitas = 'customers' AND entitas_id = $1 AND aksi = 'UBAH_NOTIFIKASI_PELANGGAN'`,
    [customerId]
  );
  assert.ok(auditRes.rowCount > 0, "Audit log UBAH_NOTIFIKASI_PELANGGAN harus tercatat");
  const log = auditRes.rows[0];
  const strNilai = JSON.stringify(log.nilai_baru);
  assert.ok(!strNilai.includes("nomor_wa"), "Audit log tidak boleh mencantumkan nomor WA");
  assert.ok(!strNilai.includes("081"), "Audit log tidak boleh mencantumkan nomor telepon");
});

// =========================================================================
// 11. Uji Hak Database solemate_app (SELECT, INSERT, UPDATE dibolehkan; DELETE/TRUNCATE ditolak)
// =========================================================================
test("hak akses solemate_app: DELETE dan TRUNCATE pada wa_notifikasi ditolak oleh izin / trigger", async () => {
  const t = await buatTiketUji();
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)`,
    [t.id]
  );

  // SELECT dibolehkan
  const selRes = await app.query(
    "SELECT * FROM wa_notifikasi WHERE order_id = $1",
    [t.id]
  );
  assert.equal(selRes.rowCount, 1);

  // UPDATE dibolehkan
  await app.query(
    "UPDATE wa_notifikasi SET percobaan = 1 WHERE order_id = $1",
    [t.id]
  );

  // DELETE ditolak
  await assert.rejects(
    async () => {
      await app.query("DELETE FROM wa_notifikasi WHERE order_id = $1", [t.id]);
    },
    /tidak boleh dihapus|permission denied/i,
    "DELETE wa_notifikasi oleh solemate_app harus ditolak"
  );

  // TRUNCATE ditolak
  await assert.rejects(
    async () => {
      await app.query("TRUNCATE TABLE wa_notifikasi");
    },
    /tidak boleh dihapus|permission denied/i,
    "TRUNCATE wa_notifikasi oleh solemate_app harus ditolak"
  );
});

// =========================================================================
// 12. Uji Bukti Kegagalan Perilaku Lama (FAIL-then-PASS proof)
// =========================================================================
test("pembuktian celah lama: mode 'tanpa_klaim_atomik' menghasilkan pesan ganda pada proses paralel, sedangkan mode terkini mencegahnya", async () => {
  const t = await buatTiketUji();

  // Mode Perilaku Lama: tanpa klaim atomik -> dua proses menghasilkan 2 kiriman ke gateway
  mockGateway.reset();
  await Promise.all([
    prosesNotifikasiSiapDiambil(t.id, { modeUjiPerilakuLama: "tanpa_klaim_atomik" }),
    prosesNotifikasiSiapDiambil(t.id, { modeUjiPerilakuLama: "tanpa_klaim_atomik" }),
  ]);
  assert.equal(
    mockGateway.pesanTerkirim.length,
    2,
    "Perilaku lama tanpa klaim atomik terbukti rentan menghasilkan kiriman ganda (2 pesan terkirim)"
  );

  // Mode Perilaku Terkini: klaim atomik UPDATE ... RETURNING -> hanya 1 kiriman
  mockGateway.reset();
  await admin.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status, percobaan)
     VALUES ($1, 'siap_diambil', 'menunggu', 0)
     ON CONFLICT (order_id, jenis) DO UPDATE SET status = 'menunggu'`,
    [t.id]
  );

  await Promise.all([
    prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true }),
    prosesNotifikasiSiapDiambil(t.id, { lewatiJeda: true }),
  ]);
  assert.equal(
    mockGateway.pesanTerkirim.length,
    1,
    "Perilaku baru dengan klaim atomik terbukti mencegah kiriman ganda (tepat 1 pesan terkirim)"
  );
});
