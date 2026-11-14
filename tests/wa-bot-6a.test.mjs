// Test Suite Phase 6A: Bot WhatsApp Pesan MASUK.
// Menguji verifikasi tanda tangan HMAC-SHA512, parser pesanan, gateway mock,
// transaksi pembuatan tiket dari WA, rate limiting atomik, penanganan privasi @lid,
// dan kepatuhan Zero Trust.
//
// Dijalankan hanya di database uji solemate_test lewat with-test-db.mjs.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import {
  verifikasiTandaTanganWebhookWa,
  periksaUsiaPayload,
  periksaRateLimitAtomik,
  bersihkanCatatanWaUsang,
  prosesWebhookMasukWa,
  buatKunciRateLimit,
  buatChatHash,
  formatBarisDeskripsiBarangWa,
} from "../src/lib/wa-bot.ts";
import {
  parsePesanPemesananWa,
  adalahPesanMenu,
  adalahPesanKatalog,
  adalahPesanFormatPemesanan,
  adalahPesanCekProgress,
  adalahUpayaPemesanan,
  diagnosaUpayaPemesanan,
  ekstrakKodeTiketCek,
} from "../src/lib/wa-parser.ts";
import {
  MockWaGatewayAdapter,
  WahaGatewayAdapter,
  aturWaGatewayInstance,
} from "../src/lib/wa-gateway.ts";

const { Pool } = pg;
let pool;
let mockGateway;

const TEST_HMAC_SECRET = "test-waha-secret-key-12345-rahasia-panjang-64bit";

before(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  process.env.WAHA_WEBHOOK_HMAC_KEY = TEST_HMAC_SECRET;
  mockGateway = new MockWaGatewayAdapter();
  aturWaGatewayInstance(mockGateway);
});

after(async () => {
  aturWaGatewayInstance(null);
  await pool.end();
});

beforeEach(async () => {
  mockGateway.reset();
  process.env.WAHA_WEBHOOK_HMAC_KEY = TEST_HMAC_SECRET;
  // Bersihkan tabel sebelum tiap blok tes agar tidak ada efek samping
  await pool.query("DELETE FROM wa_rate_limit");
  await pool.query("DELETE FROM wa_messages");
});

function buatHmacSha512(body, secret = TEST_HMAC_SECRET) {
  return crypto.createHmac("sha512", secret).update(body, "utf8").digest("hex");
}

// =========================================================================
// 1. Uji Keamanan HMAC-SHA512 & Payload
// =========================================================================

test("HMAC-SHA512: vektor uji resmi terverifikasi identik", () => {
  const payloadVector = JSON.stringify({
    event: "message",
    session: "default",
    engine: "WEBJS",
  });
  const secretVector = "my-secret-key";
  const expectedHex =
    "208f8a55dde9e05519e898b10b89bf0d0b3b0fdf11fdbf09b6b90476301b98d8097c462b2b17a6ce93b6b47a136cf2e78a33a63f6752c2c1631777076153fa89";

  const hitung = crypto
    .createHmac("sha512", secretVector)
    .update(payloadVector, "utf8")
    .digest("hex");
  assert.equal(hitung, expectedHex, "Vektor uji resmi HMAC-SHA512 harus cocok");
});

test("HMAC-SHA512: tanda tangan valid diterima", () => {
  const body = JSON.stringify({ event: "message", data: "halo" });
  const hmac = buatHmacSha512(body);
  const hasil = verifikasiTandaTanganWebhookWa(body, hmac);
  assert.equal(hasil.ok, true);
});

test("HMAC-SHA512: tanda tangan salah atau body diubah ditolak (401)", () => {
  const body = JSON.stringify({ event: "message", data: "halo" });
  const hmacSalah = buatHmacSha512(body, "secret-yang-salah");
  const hasil = verifikasiTandaTanganWebhookWa(body, hmacSalah);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 401);
});

test("HMAC-SHA512: header HMAC kosong atau hilang ditolak (401)", () => {
  const body = JSON.stringify({ event: "message" });
  const hasil1 = verifikasiTandaTanganWebhookWa(body, null);
  assert.equal(hasil1.ok, false);
  assert.equal(hasil1.kode, 401);

  const hasil2 = verifikasiTandaTanganWebhookWa(body, "");
  assert.equal(hasil2.ok, false);
  assert.equal(hasil2.kode, 401);
});

test("HMAC-SHA512: WAHA_WEBHOOK_HMAC_KEY kosong/tidak disetel menolak semua webhook (503)", () => {
  delete process.env.WAHA_WEBHOOK_HMAC_KEY;
  const body = JSON.stringify({ event: "message" });
  const hasil = verifikasiTandaTanganWebhookWa(body, "bebas");
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 503);
});

test("HMAC-SHA512: WAHA_WEBHOOK_HMAC_KEY kurang dari 32 karakter ditolak (503)", () => {
  process.env.WAHA_WEBHOOK_HMAC_KEY = "kunci_pendek_kurang_dari_32_chr"; // 31 karakter
  const body = JSON.stringify({ event: "message" });
  const hasil = verifikasiTandaTanganWebhookWa(body, "bebas");
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 503);
  assert.match(hasil.galat, /minimal 32 karakter/i);
});

test("HMAC-SHA512: WAHA_WEBHOOK_HMAC_KEY bernilai teks contoh/placeholder ditolak (503)", () => {
  process.env.WAHA_WEBHOOK_HMAC_KEY = "isi_dengan_kunci_rahasia_hmac_sha512_minimal_32_karakter";
  const body = JSON.stringify({ event: "message" });
  const hasil = verifikasiTandaTanganWebhookWa(body, "bebas");
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 503);
  assert.match(hasil.galat, /placeholder/i);
});

test("Usia payload: timestamp detik dan milidetik baru diterima", () => {
  const sekarangDetik = Math.floor(Date.now() / 1000);
  assert.equal(periksaUsiaPayload(sekarangDetik).valid, true);

  const sekarangMs = Date.now();
  assert.equal(periksaUsiaPayload(sekarangMs).valid, true);
});

test("Usia payload: timestamp usang (> 300 detik) ditolak", () => {
  const lampauDetik = Math.floor(Date.now() / 1000) - 350;
  const res = periksaUsiaPayload(lampauDetik);
  assert.equal(res.valid, false);
  assert.match(res.galat, /kedaluwarsa/i);
});

// =========================================================================
// 2. Uji Parser Pesan Masuk
// =========================================================================

test("Parser intent: mendeteksi menu, katalog, format, dan cek", () => {
  assert.equal(adalahPesanMenu("menu"), true);
  assert.equal(adalahPesanMenu("Halo"), true);
  assert.equal(adalahPesanMenu("P"), true);

  assert.equal(adalahPesanKatalog("1"), true);
  assert.equal(adalahPesanKatalog("layanan"), true);
  assert.equal(adalahPesanKatalog("daftar harga"), true);

  assert.equal(adalahPesanFormatPemesanan("2"), true);
  assert.equal(adalahPesanFormatPemesanan("format"), true);
  assert.equal(adalahPesanFormatPemesanan("cara pesan"), true);

  assert.equal(adalahPesanCekProgress("3"), true);
  assert.equal(adalahPesanCekProgress("cek"), true);
  assert.equal(adalahPesanCekProgress("cek SM-20261108-001"), true);

  assert.equal(ekstrakKodeTiketCek("cek SM-20261108-001"), "SM-20261108-001");
  assert.equal(ekstrakKodeTiketCek("status SM-20261108-099 tolong"), "SM-20261108-099");
  assert.equal(ekstrakKodeTiketCek("cek saja"), null);
});

test("Parser pemesanan: format valid 1 item dan multi item berhasil", () => {
  const layananMock = [
    { id: 10, nama: "Fast Clean", harga: 35000, estimasi_hari: 1 },
    { id: 20, nama: "Deep Clean", harga: 50000, estimasi_hari: 3 },
  ];

  const teks1 = `
Nama: Ahmad Dahlan
Barang: 1 | 1 | Sneakers putih Adidas Stan Smith
Antar/Jemput: Antar sendiri
`;
  const res1 = parsePesanPemesananWa(teks1, layananMock);
  assert.equal(res1.ok, true);
  assert.equal(res1.nama, "Ahmad Dahlan");
  assert.equal(res1.serah_terima, "antar_sendiri");
  assert.equal(res1.items.length, 1);
  assert.equal(res1.items[0].service_id, 10);
  assert.equal(res1.items[0].jumlah, 1);

  const teks2 = `
Nama: Siti Fatimah
Barang:
Deep Clean | 2 | Nike Air Max hitam & Jordan 1
Fast Clean | 1 | Vans Old Skool
Antar/Jemput: Jemput
Nomor WA: 081234567890
`;
  const res2 = parsePesanPemesananWa(teks2, layananMock);
  assert.equal(res2.ok, true);
  assert.equal(res2.nama, "Siti Fatimah");
  assert.equal(res2.serah_terima, "jemput");
  assert.equal(res2.nomor_wa_manual, "6281234567890");
  assert.equal(res2.items.length, 2);
  assert.equal(res2.items[0].service_id, 20);
  assert.equal(res2.items[0].jumlah, 2);
});

test("Parser pemesanan: tolak karakter terlarang (kontrol, bidi U+202E, zero-width)", () => {
  const layananMock = [{ id: 10, nama: "Fast Clean", harga: 35000, estimasi_hari: 1 }];

  // Byte nol pada nama
  const teksBidi = `
Nama: Budi\u202Esantoso
Barang: 1 | 1 | Sepatu
Antar/Jemput: Antar sendiri
`;
  const resBidi = parsePesanPemesananWa(teksBidi, layananMock);
  assert.equal(resBidi.ok, false);
  assert.match(resBidi.galat, /karakter terlarang/i);

  // Karakter lebar-nol pada deskripsi
  const teksZero = `
Nama: Budi Santoso
Barang: 1 | 1 | Sepatu\u200Bbersih
Antar/Jemput: Antar sendiri
`;
  const resZero = parsePesanPemesananWa(teksZero, layananMock);
  assert.equal(resZero.ok, false);
  assert.match(resZero.galat, /karakter terlarang/i);
});

test("Parser pemesanan: tolak kuantitas 0, negatif, atau melebihi 20 pasang", () => {
  const layananMock = [{ id: 10, nama: "Fast Clean", harga: 35000, estimasi_hari: 1 }];

  const teksNol = `
Nama: Budi Santoso
Barang: 1 | 0 | Sepatu
Antar/Jemput: Antar sendiri
`;
  assert.equal(parsePesanPemesananWa(teksNol, layananMock).ok, false);

  const teksBanyak = `
Nama: Budi Santoso
Barang: 1 | 25 | Sepatu
Antar/Jemput: Antar sendiri
`;
  assert.equal(parsePesanPemesananWa(teksBanyak, layananMock).ok, false);
});

// =========================================================================
// 3. Uji Rate Limiting Atomik
// =========================================================================

test("Rate limit atomik: pesan per menit dibatasi 12 pesan", async () => {
  const pengenal = "62899990001@c.us";
  for (let i = 1; i <= 12; i++) {
    const r = await periksaRateLimitAtomik(pool, pengenal, "pesan_menit", "1 minute", 12);
    assert.equal(r.dibolehkan, true, `Pesan ke-${i} harus dibolehkan`);
  }
  const rKe13 = await periksaRateLimitAtomik(pool, pengenal, "pesan_menit", "1 minute", 12);
  assert.equal(rKe13.dibolehkan, false, "Pesan ke-13 harus diblokir");
});

test("Rate limit atomik: tiket global WA per jam dibatasi 30 tiket", async () => {
  for (let i = 1; i <= 30; i++) {
    const r = await periksaRateLimitAtomik(pool, "global", "tiket_global_jam", "1 hour", 30);
    assert.equal(r.dibolehkan, true, `Tiket ke-${i} harus dibolehkan`);
  }
  const rKe31 = await periksaRateLimitAtomik(pool, "global", "tiket_global_jam", "1 hour", 30);
  assert.equal(rKe31.dibolehkan, false, "Tiket ke-31 harus diblokir");
});

test("Rate limit: kunci turunan berlabel 'wa-rate-limit' tidak memuat nomor mentah / JID (Refinement 2)", async () => {
  const pengenal = "628123456789@c.us";
  const kunci = buatKunciRateLimit(pengenal, "pesan_menit");
  assert.equal(kunci.length, 64, "Kunci rate limit harus berupa hash SHA-256 (64 hex char)");
  assert.ok(!kunci.includes("628123456789"), "Kunci tidak boleh memuat nomor telepon mentah");
  assert.ok(!kunci.includes("@c.us"), "Kunci tidak boleh memuat JID mentah");

  // Periksa langsung nilai di database wa_rate_limit setelah pencatatan
  await periksaRateLimitAtomik(pool, pengenal, "pesan_menit", "1 minute", 12);
  const barisDb = await pool.query("SELECT kunci FROM wa_rate_limit WHERE kategori = 'pesan_menit'");
  assert.equal(barisDb.rowCount, 1);
  const kunciDb = barisDb.rows[0].kunci;
  assert.equal(kunciDb, kunci);
  assert.ok(!kunciDb.includes("628123456789"), "Kolom kunci di database tidak boleh memuat nomor telepon");
});

// =========================================================================
// 4. Uji Alur Webhook Masuk & Pembuatan Tiket
// =========================================================================

test("Webhook: deduplikasi pesan masuk dengan provider_message_id sama", async () => {
  const payload = {
    event: "message",
    payload: {
      id: "msg-dedup-1",
      from: "628111222333@c.us",
      body: "menu",
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  const res1 = await prosesWebhookMasukWa(payload, JSON.stringify(payload));
  assert.equal(res1.ok, true);
  assert.equal(res1.duplikat, undefined);
  assert.equal(mockGateway.pesanTerkirim.length, 1);

  // Kirim lagi dengan ID yang sama
  const res2 = await prosesWebhookMasukWa(payload, JSON.stringify(payload));
  assert.equal(res2.ok, true);
  assert.equal(res2.duplikat, true);
  // Gateway tidak boleh menerima pesan kedua
  assert.equal(mockGateway.pesanTerkirim.length, 1);
});

test("Webhook: abaikan fromMe, grup (@g.us), dan status broadcast", async () => {
  const pFromMe = {
    event: "message",
    payload: { id: "m1", from: "628111@c.us", body: "menu", fromMe: true },
  };
  assert.equal((await prosesWebhookMasukWa(pFromMe, "")).diabaikan, true);

  const pGrup = {
    event: "message",
    payload: { id: "m2", from: "123456789@g.us", body: "menu", fromMe: false },
  };
  assert.equal((await prosesWebhookMasukWa(pGrup, "")).diabaikan, true);

  const pStatus = {
    event: "message",
    payload: { id: "m3", from: "status@broadcast", body: "menu", fromMe: false },
  };
  assert.equal((await prosesWebhookMasukWa(pStatus, "")).diabaikan, true);
});

test("Webhook: pesan media dibalas dengan panduan media dan kena jeda", async () => {
  const payload = {
    event: "message",
    payload: {
      id: "msg-media-1",
      from: "628123444555@c.us",
      type: "image",
      hasMedia: true,
      fromMe: false,
    },
  };

  const res1 = await prosesWebhookMasukWa(payload, "");
  assert.equal(res1.ok, true);
  assert.equal(mockGateway.pesanTerkirim.length, 1);
  assert.match(mockGateway.pesanTerkirim[0].teks, /belum dapat memproses gambar/i);

  // Pesan media kedua langsung dikirim -> terkena batas jeda media (tidak spamming balasan)
  const payload2 = {
    event: "message",
    payload: {
      id: "msg-media-2",
      from: "628123444555@c.us",
      type: "image",
      hasMedia: true,
      fromMe: false,
    },
  };
  const res2 = await prosesWebhookMasukWa(payload2, "");
  assert.equal(res2.ok, true);
  assert.equal(mockGateway.pesanTerkirim.length, 1); // tetap 1
});

test("Webhook: perintah 1 menampilkan katalog aktif dengan formatRupiah", async () => {
  // Pastikan ada minimal 1 layanan aktif di database
  await pool.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ('Uji Cuci Cepat', 40000, 2, true)
     ON CONFLICT (nama) DO UPDATE SET aktif = true
     RETURNING id, nama, harga`
  );

  const payload = {
    event: "message",
    payload: {
      id: "msg-katalog-1",
      from: "628555666777@c.us",
      body: "1",
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  assert.equal(mockGateway.pesanTerkirim.length, 1);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Rp\s*40\.000/);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Uji Cuci Cepat/);
});

test("Webhook: pemesanan sukses membuat tiket sumber 'wa' dan serah_terima", async () => {
  // Buat layanan aktif uji
  await pool.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ('Cuci Standard Bot', 45000, 2, true)
     ON CONFLICT (nama) DO UPDATE SET aktif = true
     RETURNING id, nama, harga`
  );

  const payload = {
    event: "message",
    payload: {
      id: "msg-order-sukses-1",
      from: "628777888999@c.us",
      body: `Nama: Bambang Pamungkas
Barang: Cuci Standard Bot | 2 | Sepatu Bola Nike & Specs
Antar/Jemput: Jemput`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  assert.ok(res.kodeTiket, "Harus mengembalikan kode tiket");
  assert.match(res.kodeTiket, /^SM-\d{8}-\d{3}$/);

  // Periksa data tersimpan di tabel orders
  const ord = await pool.query(
    `SELECT id, kode_tiket, sumber, serah_terima, status_pesanan, status_bayar, total, dibuat_oleh
     FROM orders WHERE kode_tiket = $1`,
    [res.kodeTiket]
  );
  assert.equal(ord.rowCount, 1);
  const row = ord.rows[0];
  assert.equal(row.sumber, "wa");
  assert.equal(row.serah_terima, "jemput");
  assert.equal(row.status_pesanan, "Belum dicuci");
  assert.equal(row.status_bayar, "Belum bayar");
  assert.equal(row.total, 90000);
  assert.equal(row.dibuat_oleh, null);

  // Balasan terkirim ke chatId persis dari payload
  assert.equal(mockGateway.pesanTerkirim.length, 1);
  assert.equal(mockGateway.pesanTerkirim[0].chatId, "628777888999@c.us");
  assert.match(mockGateway.pesanTerkirim[0].teks, new RegExp(res.kodeTiket));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Jemput oleh Tim Solemate/i);

  // Verifikasi trigger blokir_update_ilegal_orders: serah_terima tidak boleh diubah
  await assert.rejects(
    async () => {
      await pool.query(
        `UPDATE orders SET serah_terima = 'antar_sendiri' WHERE id = $1`,
        [row.id]
      );
    },
    /serah_terima pada orders tidak boleh diubah/
  );
});

test("Webhook: nama pelanggan lama di customers TIDAK ditimpa oleh nama dari bot (Refinement 9)", async () => {
  // Masukkan customer lama
  const nomorUji = "628999888777";
  await pool.query(
    `INSERT INTO customers (nama, nomor_wa) VALUES ('Nama Asli di Toko', $1)
     ON CONFLICT (nomor_wa) DO UPDATE SET nama = 'Nama Asli di Toko'`,
    [nomorUji]
  );

  const payload = {
    event: "message",
    payload: {
      id: "msg-order-cust-lama",
      from: `${nomorUji}@c.us`,
      body: `Nama: Nama Beda Dari WhatsApp
Barang: Cuci Standard Bot | 1 | Sepatu Vans
Antar/Jemput: Antar sendiri`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);

  // Nama pelanggan di tabel customers harus tetap 'Nama Asli di Toko'
  const c = await pool.query(`SELECT nama FROM customers WHERE nomor_wa = $1`, [nomorUji]);
  assert.equal(c.rows[0].nama, "Nama Asli di Toko");
  assert.match(mockGateway.pesanTerkirim[0].teks, /Nama Beda Dari WhatsApp/);
  assert.doesNotMatch(mockGateway.pesanTerkirim[0].teks, /Nama Asli di Toko/);
});

// =========================================================================
// 5. Uji Penanganan Privasi Pengirim @lid (Refinement 5)
// =========================================================================

test("Privasi @lid: pemesanan dengan nomor WA manual berhasil dan dicatat di audit log", async () => {
  const payload = {
    event: "message",
    payload: {
      id: "msg-lid-order-1",
      from: "99887766554433@lid",
      body: `Nama: Raden Saleh
Barang: Cuci Standard Bot | 1 | Pantofel kulit
Antar/Jemput: Antar sendiri
Nomor WA: 081234999888`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  assert.ok(res.kodeTiket);

  // Periksa audit log memiliki nomor_belum_diverifikasi: true tanpa nomor WA
  const aud = await pool.query(
    `SELECT nilai_baru FROM audit_logs
     WHERE entitas = 'orders' AND nilai_baru->>'kode_tiket' = $1`,
    [res.kodeTiket]
  );
  assert.equal(aud.rowCount, 1);
  const auditData = aud.rows[0].nilai_baru;
  assert.equal(auditData.nomor_belum_diverifikasi, true);
  assert.equal(auditData.nomor_wa, undefined);
});

test("Privasi @lid: pemesanan tanpa nomor WA manual ditolak dengan panduan", async () => {
  const payload = {
    event: "message",
    payload: {
      id: "msg-lid-order-tanpa-nomor",
      from: "99887766554433@lid",
      body: `Nama: Raden Saleh
Barang: Cuci Standard Bot | 1 | Pantofel kulit
Antar/Jemput: Antar sendiri`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Nomor WA: 08xxxxxxxxxx/);
});

test("Privasi @lid: pengirim @lid dapat mengecek pesanan miliknya via chat_hash (Phase 6A.1)", async () => {
  // Pengirim 99887766554433@lid memiliki pesanan yang dibuat pada tes sebelumnya
  const payload = {
    event: "message",
    payload: {
      id: "msg-lid-cek",
      from: "99887766554433@lid",
      body: "cek",
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  // Harus menemukan pesanan miliknya yang dibuat dari chat yang sama via chat_hash
  assert.match(mockGateway.pesanTerkirim[0].teks, /Pesanan Aktif Anda/i);

  // Pengirim @lid baru yang belum pernah membuat pesanan
  mockGateway.reset();
  const resBaru = await prosesWebhookMasukWa({
    event: "message",
    payload: {
      id: "msg-lid-cek-baru",
      from: "belum-pernah-order@lid",
      body: "cek",
      fromMe: false,
    },
  });
  assert.equal(resBaru.ok, true);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Tidak ditemukan pesanan aktif/i);
});

test("Privasi @lid: pemesanan dengan nomor pelanggan lama TIDAK membocorkan nama tersimpan (Refinement 4)", async () => {
  const nomorTerdaftar = "6281234599999";
  // Simpan pelanggan lama dengan nama rahasia
  await pool.query(
    `INSERT INTO customers (nama, nomor_wa) VALUES ('Sultan Hamengkubuwono', $1)
     ON CONFLICT (nomor_wa) DO UPDATE SET nama = 'Sultan Hamengkubuwono'`,
    [nomorTerdaftar]
  );

  const payload = {
    event: "message",
    payload: {
      id: "msg-lid-order-anti-bocor",
      from: "11223344556677@lid",
      body: `Nama: Budi Samaran
Barang: Cuci Standard Bot | 1 | Sepatu Formal
Antar/Jemput: Antar sendiri
Nomor WA: 081234599999`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);
  assert.ok(res.kodeTiket);

  const teksBalasan = mockGateway.pesanTerkirim[0].teks;
  // Balasan harus memakai nama yang diketik pemesan
  assert.match(teksBalasan, /Budi Samaran/);
  // Balasan TIDAK BOLEH membocorkan nama tersimpan pelanggan lama
  assert.ok(
    !teksBalasan.includes("Sultan Hamengkubuwono"),
    "Nama tersimpan pelanggan lama tidak boleh bocor ke pengirim @lid"
  );

  // Di database, nama pelanggan lama tetap utuh (Refinement 9)
  const c = await pool.query("SELECT nama FROM customers WHERE nomor_wa = $1", [nomorTerdaftar]);
  assert.equal(c.rows[0].nama, "Sultan Hamengkubuwono");
});

test("Privasi @lid: cek progress dengan nomor ketikan atau kode tiket orang lain tidak membocorkan data (Refinement 4 & Phase 6A.1)", async () => {
  mockGateway.reset();
  const payloadKetikan = {
    event: "message",
    payload: {
      id: "msg-lid-cek-ketik-nomor",
      from: "11223344556677@lid",
      body: "cek 081234599999",
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payloadKetikan, "");
  assert.equal(res.ok, true);
  // Nomor ketikan tidak membuka data Sultan Hamengkubuwono; hanya melihat tiket milik chat-nya sendiri
  assert.ok(!mockGateway.pesanTerkirim[0].teks.includes("Sultan Hamengkubuwono"));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Pesanan Aktif Anda/i);

  // Pengirim lain yang mengetik nomor tersebut tetap tidak bisa membuka data orang lain
  mockGateway.reset();
  await prosesWebhookMasukWa({
    event: "message",
    payload: {
      id: "msg-lid-cek-pencuri",
      from: "orang-lain-tanpa-tiket@lid",
      body: "cek 081234599999",
      fromMe: false,
    },
  });
  assert.ok(!mockGateway.pesanTerkirim[0].teks.includes("Sultan Hamengkubuwono"));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Tidak ditemukan pesanan aktif/i);

  mockGateway.reset();
  const payloadKode = {
    event: "message",
    payload: {
      id: "msg-lid-cek-kode-tiket",
      from: "11223344556677@lid",
      body: "cek SM-20261108-001",
      fromMe: false,
    },
  };
  const res2 = await prosesWebhookMasukWa(payloadKode, "");
  assert.equal(res2.ok, true);
  assert.match(mockGateway.pesanTerkirim[0].teks, /tidak ditemukan/i);
});

// =========================================================================
// 6. Uji Pengecekan Progress Pesanan (@c.us)
// =========================================================================

test("Cek progress: pelanggan @c.us dapat melihat pesanan aktif miliknya", async () => {
  const nomorWa = "6281999888111";

  // Buat tiket aktif untuk nomor ini
  const payloadOrder = {
    event: "message",
    payload: {
      id: "msg-order-cek-1",
      from: `${nomorWa}@c.us`,
      body: `Nama: Joko Anwar
Barang: Cuci Standard Bot | 1 | Sepatu Lari
Antar/Jemput: Antar sendiri`,
      fromMe: false,
    },
  };
  const resOrder = await prosesWebhookMasukWa(payloadOrder, "");
  const kodeTiket = resOrder.kodeTiket;

  mockGateway.reset();

  // 1. Cek semua tiket aktif
  const payloadCekAll = {
    event: "message",
    payload: {
      id: "msg-cek-all",
      from: `${nomorWa}@c.us`,
      body: "3",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadCekAll, "");
  assert.match(mockGateway.pesanTerkirim[0].teks, new RegExp(kodeTiket));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Layanan:\s*Cuci Standard Bot/i);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Deskripsi Barang:\s*Sepatu Lari/i);

  mockGateway.reset();

  // 2. Cek tiket spesifik
  const payloadCekKode = {
    event: "message",
    payload: {
      id: "msg-cek-kode",
      from: `${nomorWa}@c.us`,
      body: `cek ${kodeTiket}`,
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadCekKode, "");
  assert.match(mockGateway.pesanTerkirim[0].teks, /Status Pesanan/i);
  assert.match(mockGateway.pesanTerkirim[0].teks, new RegExp(kodeTiket));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Layanan:\s*Cuci Standard Bot/i);
  assert.match(mockGateway.pesanTerkirim[0].teks, /Deskripsi Barang:\s*Sepatu Lari/i);
});

test("Cek progress: mencoba memeriksa tiket pelanggan lain ditolak (tidak ditemukan)", async () => {
  const nomorSaya = "6281999000000";
  const payloadCekOrangLain = {
    event: "message",
    payload: {
      id: "msg-cek-orang-lain",
      from: `${nomorSaya}@c.us`,
      body: "cek SM-20261108-999",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadCekOrangLain, "");
  assert.match(mockGateway.pesanTerkirim[0].teks, /tidak ditemukan atau tidak terdaftar/i);
});

// =========================================================================
// 7. Uji Pembersihan Catatan Berkala
// =========================================================================

test("Pembersihan berkala: menghapus rate limit usang (> 24 jam) dan pesan lama (> 30 hari)", async () => {
  // Masukkan data lampau
  await pool.query(
    `INSERT INTO wa_rate_limit (kunci, kategori, hitungan, window_mulai)
     VALUES ('kunci_lama', 'pesan_menit', 5, now() - interval '25 hours'),
            ('kunci_baru', 'pesan_menit', 1, now())`
  );
  await pool.query(
    `INSERT INTO wa_messages (customer_id, arah, isi, waktu, provider_message_id)
     VALUES (NULL, 'masuk', 'lama', now() - interval '31 days', 'msg-old-1'),
            (NULL, 'masuk', 'baru', now(), 'msg-new-1')`
  );

  const hasilBersih = await bersihkanCatatanWaUsang(pool);
  assert.equal(hasilBersih.rateLimitTerhapus >= 1, true);
  assert.equal(hasilBersih.pesanTerhapus >= 1, true);

  const sisaRate = await pool.query("SELECT * FROM wa_rate_limit WHERE kunci = 'kunci_lama'");
  assert.equal(sisaRate.rowCount, 0);

  const sisaPesan = await pool.query("SELECT * FROM wa_messages WHERE provider_message_id = 'msg-old-1'");
  assert.equal(sisaPesan.rowCount, 0);
});

// =========================================================================
// 8. Uji Toleransi Parser & Penanganan Pesan Nyata (Pesan A & Pesan B)
// =========================================================================

test("Toleransi parser: spasi sekitar titik dua, huruf besar-kecil, slash, dan Pesan A", () => {
  const layananMock = [
    { id: 1, nama: "Cuci Standard", harga: 35000, estimasi_hari: 2 },
    { id: 2, nama: "Deep Clean", harga: 50000, estimasi_hari: 3 },
  ];

  // Variasi spasi dan huruf besar-kecil pada label & nilai serah terima
  const teksVariasi = `
NAMA  :  Budi Handoko
BARANG : 1 | 1 | Sepatu Casual Pria
Antar / Jemput : JEMPUT
NOMOR WA : 081234567890
`;
  const resVar = parsePesanPemesananWa(teksVariasi, layananMock);
  assert.equal(resVar.ok, true);
  assert.equal(resVar.nama, "Budi Handoko");
  assert.equal(resVar.serah_terima, "jemput");
  assert.equal(resVar.items[0].service_id, 1);
  assert.equal(resVar.nomor_wa_manual, "6281234567890");

  // Pesan A nyata: Barang tanpa titik dua diikuti 1 | 1 | ..., Antar/Jemput : Jemput
  const pesanA = `Nama: Husna
Barang 1 | 1 | Sepatu Nike puma
Antar/Jemput : Jemput`;

  assert.equal(adalahUpayaPemesanan(pesanA), true);
  const resA = parsePesanPemesananWa(pesanA, layananMock);
  assert.equal(resA.ok, true, "Pesan A harus berhasil di-parse setelah toleransi");
  assert.equal(resA.nama, "Husna");
  assert.equal(resA.serah_terima, "jemput");
  assert.equal(resA.items.length, 1);
  assert.equal(resA.items[0].deskripsi_barang, "Sepatu Nike puma");
  assert.equal(resA.items[0].jumlah, 1);
});

test("Deteksi & diagnosa upaya pemesanan: Pesan B menghasilkan petunjuk spesifik tanpa tiket", () => {
  const layananMock = [
    { id: 1, nama: "Cuci Standard", harga: 35000, estimasi_hari: 2 },
  ];

  const pesanB = `Husna
1 | 1 | sepatu nike putih
Jemput`;

  // 1. Dikenali sebagai upaya pemesanan (bukan pesan acak)
  assert.equal(adalahUpayaPemesanan(pesanB), true);

  // 2. Parser menolak karena tidak ada label (tidak menebak-nebak)
  const resB = parsePesanPemesananWa(pesanB, layananMock);
  assert.equal(resB.ok, false);

  // 3. Diagnosa menghasilkan petunjuk spesifik per baris
  const petunjuk = diagnosaUpayaPemesanan(pesanB, layananMock, resB.galat);
  assert.match(petunjuk, /Baris 1/i);
  assert.match(petunjuk, /Nama:/i);
  assert.match(petunjuk, /Baris 2/i);
  assert.match(petunjuk, /Barang:/i);
  assert.match(petunjuk, /Baris 3/i);
  assert.match(petunjuk, /Antar\/Jemput:/i);
  assert.match(petunjuk, /Contoh Format yang Benar/i);
});

test("Webhook: Pesan A berhasil membuat tiket di database", async () => {
  const nomorWa = "6281299900011";
  const payloadPesanA = {
    event: "message",
    payload: {
      id: "msg-real-pesan-a",
      from: `${nomorWa}@c.us`,
      body: `Nama: Husna
Barang 1 | 1 | Sepatu Nike puma
Antar/Jemput : Jemput`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payloadPesanA, "");
  assert.equal(res.ok, true);
  assert.equal(res.balasanTerkirim, true);
  assert.ok(res.kodeTiket, "Kode tiket harus dihasilkan");

  // Verifikasi balasan konfirmasi sukses
  const balasan = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan, /Pesanan Berhasil Dicatat/i);
  assert.match(balasan, new RegExp(res.kodeTiket));
  assert.match(balasan, /Husna/);
  assert.match(balasan, /Jemput/i);

  // Verifikasi database: tiket tersimpan dengan benar
  const dbCheck = await pool.query(
    "SELECT o.kode_tiket, o.serah_terima, o.status_pesanan, o.status_bayar, c.nama FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.kode_tiket = $1",
    [res.kodeTiket]
  );
  assert.equal(dbCheck.rowCount, 1);
  assert.equal(dbCheck.rows[0].serah_terima, "jemput");
  assert.equal(dbCheck.rows[0].status_pesanan, "Belum dicuci");
  assert.equal(dbCheck.rows[0].status_bayar, "Belum bayar");
  assert.equal(dbCheck.rows[0].nama, "Husna");
});

test("Webhook: Pesan B dibalas petunjuk spesifik dan TIDAK membuat tiket", async () => {
  const jumlahTiketAwal = await pool.query("SELECT COUNT(*)::int AS count FROM orders");
  const countAwal = jumlahTiketAwal.rows[0].count;

  const payloadPesanB = {
    event: "message",
    payload: {
      id: "msg-real-pesan-b",
      from: "6281299900022@c.us",
      body: `Husna
1 | 1 | sepatu nike putih
Jemput`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payloadPesanB, "");
  assert.equal(res.ok, true);
  assert.equal(res.balasanTerkirim, true);
  assert.equal(res.kodeTiket, undefined, "Tidak boleh menghasilkan kode tiket");

  // Verifikasi balasan adalah petunjuk spesifik
  const balasan = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan, /Format Pemesanan Belum Sesuai/i);
  assert.match(balasan, /Baris 1.*Nama:/i);
  assert.match(balasan, /Baris 2.*Barang:/i);
  assert.match(balasan, /Baris 3.*Antar\/Jemput:/i);
  assert.match(balasan, /Contoh Format yang Benar/i);

  // Verifikasi database: tidak ada tiket baru yang dibuat
  const jumlahTiketAkhir = await pool.query("SELECT COUNT(*)::int AS count FROM orders");
  assert.equal(jumlahTiketAkhir.rows[0].count, countAwal, "Jumlah baris orders tidak boleh bertambah");
});

test("Format pemesanan (balasan 2): bersih untuk nomor reguler, memuat Nomor WA hanya untuk @lid", async () => {
  // 1. Pengirim reguler @c.us
  const payloadReguler = {
    event: "message",
    payload: {
      id: "msg-format-reguler",
      from: "628123456789@c.us",
      body: "2",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadReguler, "");
  const balasanReguler = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasanReguler, /Format Pemesanan Solemate/i);
  assert.doesNotMatch(balasanReguler, /opsional jika bukan nomor tersembunyi/i);
  assert.doesNotMatch(balasanReguler, /Nomor WA:/i);

  mockGateway.reset();

  // 2. Pengirim privasi @lid
  const payloadLid = {
    event: "message",
    payload: {
      id: "msg-format-lid",
      from: "123456789012345@lid",
      body: "2",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadLid, "");
  const balasanLid = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasanLid, /Format Pemesanan Solemate/i);
  assert.match(balasanLid, /Nomor WA:/i);
  assert.match(balasanLid, /fitur privasi \(@lid\)/i);
});

test("Pesan acak tetap dibalas 'Perintah tidak dikenali' tanpa petunjuk format berlebih", async () => {
  const payloadAcak = {
    event: "message",
    payload: {
      id: "msg-pesan-acak",
      from: "628123456789@c.us",
      body: "selamat siang min, mau tanya besok toko buka jam berapa?",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadAcak, "");
  const balasan = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan, /Perintah tidak dikenali/i);
  assert.doesNotMatch(balasan, /Baris 1/i);
  assert.doesNotMatch(balasan, /Format Pemesanan Belum Sesuai/i);
});

// =========================================================================
// 8. Uji Fitur & Kepatuhan Phase 6A.1 (Penanganan Privasi @lid)
// =========================================================================

test("Gateway: pemetaan lid ke nomor telepon dengan validasi ketat & cache in-memory (Phase 6A.1)", async () => {
  const lidValid = "123456789012345@lid";
  const pnValid = "6281234567890@c.us";

  // 1. Sukses: Status 200, lid cocok, pn valid regex
  mockGateway.setMockLid(lidValid, pnValid, 200);
  const nomor1 = await mockGateway.petakanLidKeNomor(lidValid);
  assert.equal(nomor1, "6281234567890");
  assert.equal(mockGateway.hitunganPanggilanLid, 1);

  // 2. Cache hit: Panggilan kedua tidak memanggil gateway lagi
  const nomor2 = await mockGateway.petakanLidKeNomor(lidValid);
  assert.equal(nomor2, "6281234567890");
  assert.equal(mockGateway.hitunganPanggilanLid, 1, "Panggilan cache hit tidak boleh menambah hitungan gateway");

  // 3. Status bukan 200 (misal 404 / 500) -> ditolak (null)
  mockGateway.reset();
  const lidError = "999888777666@lid";
  mockGateway.setMockLid(lidError, null, 404);
  const hasilError = await mockGateway.petakanLidKeNomor(lidError);
  assert.equal(hasilError, null);

  // 4. Lid pada respons berbeda -> ditolak (null)
  mockGateway.reset();
  const lidMinta = "111222333444@lid";
  mockGateway.setMockLid(lidMinta, pnValid, 200, "beda_lid@lid");
  const hasilBedaLid = await mockGateway.petakanLidKeNomor(lidMinta);
  assert.equal(hasilBedaLid, null);

  // 5. Format pn tidak valid (bukan regex ^[0-9]{8,15}@c.us$) -> ditolak (null)
  mockGateway.reset();
  const lidPnInvalid = "555666777888@lid";
  // Kurang dari 8 digit
  mockGateway.setMockLid(lidPnInvalid, "12345@c.us", 200);
  assert.equal(await mockGateway.petakanLidKeNomor(lidPnInvalid), null);

  // Bukan @c.us
  mockGateway.lidCache.clear();
  mockGateway.setMockLid(lidPnInvalid, "6281234567890@s.whatsapp.net", 200);
  assert.equal(await mockGateway.petakanLidKeNomor(lidPnInvalid), null);

  // Teks acak
  mockGateway.lidCache.clear();
  mockGateway.setMockLid(lidPnInvalid, "invalid_phone_number", 200);
  assert.equal(await mockGateway.petakanLidKeNomor(lidPnInvalid), null);
});

test("Phase 6A.1: Cek progress satu kondisi: nomor terverifikasi ATAU chat_hash (tiket lama & baru)", async () => {
  mockGateway.reset();
  const lidPengirim = "user-lid-progress-001@lid";

  // Langkah 1: Pengirim @lid belum terpetakan di gateway (respons 404)
  mockGateway.setMockLid(lidPengirim, null, 404);

  // Buat Tiket 1 dengan nomor manual
  const payloadOrder1 = {
    event: "message",
    payload: {
      id: "msg-order-lid-phase6a1-1",
      from: lidPengirim,
      body: `Nama: Pelanggan Privasi Satu
Barang: Cuci Standard Bot | 1 | Sepatu Sneaker Lama
Antar/Jemput: Antar sendiri
Nomor WA: 081255551111`,
      fromMe: false,
    },
  };

  const res1 = await prosesWebhookMasukWa(payloadOrder1, "");
  assert.equal(res1.ok, true);
  const kodeTiket1 = res1.kodeTiket;
  assert.ok(kodeTiket1);

  // Verifikasi balasan sukses untuk @lid tak terpetakan: menyebut "dari chat ini"
  const balasan1 = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan1, new RegExp(`cek ${kodeTiket1}\\* dari chat ini kapan saja`, "i"));

  // Verifikasi database: nomor_terverifikasi = false, chat_hash terisi
  const ord1 = await pool.query(
    "SELECT chat_hash, nomor_terverifikasi FROM orders WHERE kode_tiket = $1",
    [kodeTiket1]
  );
  assert.equal(ord1.rows[0].nomor_terverifikasi, false);
  assert.equal(ord1.rows[0].chat_hash, buatChatHash(lidPengirim));

  // Langkah 2: Simulasi WAHA kemudian berhasil memetakan pengirim yang sama ke nomor terverifikasi
  mockGateway.reset();
  mockGateway.lidCache.clear();
  const nomorTerverifikasi = "6281299998888";
  mockGateway.setMockLid(lidPengirim, `${nomorTerverifikasi}@c.us`, 200);

  // Buat Tiket 2 dari pengirim yang sama
  const payloadOrder2 = {
    event: "message",
    payload: {
      id: "msg-order-lid-phase6a1-2",
      from: lidPengirim,
      body: `Nama: Pelanggan Privasi Dua
Barang: Cuci Standard Bot | 1 | Sepatu Kulit Baru
Antar/Jemput: Antar sendiri`,
      fromMe: false,
    },
  };

  const res2 = await prosesWebhookMasukWa(payloadOrder2, "");
  assert.equal(res2.ok, true);
  const kodeTiket2 = res2.kodeTiket;
  assert.ok(kodeTiket2);

  // Verifikasi balasan sukses untuk pengirim yang nomornya terverifikasi: tidak terbatas "dari chat ini"
  const balasan2 = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan2, new RegExp(`cek ${kodeTiket2}\\* kapan saja`, "i"));

  // Verifikasi database Tiket 2: nomor_terverifikasi = true
  const ord2 = await pool.query(
    "SELECT chat_hash, nomor_terverifikasi FROM orders WHERE kode_tiket = $1",
    [kodeTiket2]
  );
  assert.equal(ord2.rows[0].nomor_terverifikasi, true);

  // Langkah 3: Pengirim mengecek daftar tiket aktif dengan "3" atau "cek"
  mockGateway.reset();
  const payloadCekSemua = {
    event: "message",
    payload: {
      id: "msg-cek-semua-phase6a1",
      from: lidPengirim,
      body: "3",
      fromMe: false,
    },
  };
  await prosesWebhookMasukWa(payloadCekSemua, "");
  const balasanDaftar = mockGateway.pesanTerkirim[0].teks;
  // Pengirim yang terpetakan WAJIB melihat KEDUA tiketnya (Tiket 1 via chat_hash & Tiket 2 via nomor terverifikasi)
  assert.match(balasanDaftar, new RegExp(kodeTiket1), "Tiket lama @lid harus terlihat");
  assert.match(balasanDaftar, new RegExp(kodeTiket2), "Tiket baru terpetakan harus terlihat");

  // Langkah 4: Pengirim mengecek rincian tiket spesifik
  mockGateway.reset();
  await prosesWebhookMasukWa({
    event: "message",
    payload: { id: "msg-cek-t1", from: lidPengirim, body: `cek ${kodeTiket1}`, fromMe: false },
  });
  assert.match(mockGateway.pesanTerkirim[0].teks, new RegExp(kodeTiket1));

  mockGateway.reset();
  await prosesWebhookMasukWa({
    event: "message",
    payload: { id: "msg-cek-t2", from: lidPengirim, body: `cek ${kodeTiket2}`, fromMe: false },
  });
  assert.match(mockGateway.pesanTerkirim[0].teks, new RegExp(kodeTiket2));

  // Langkah 5: Nomor ketikan manual di pesan tidak pernah membuka tiket siapa pun
  mockGateway.reset();
  await prosesWebhookMasukWa({
    event: "message",
    payload: { id: "msg-cek-ketikan", from: "pencuri@lid", body: "cek 081255551111", fromMe: false },
  });
  // Tidak boleh menampilkan detail tiket 1
  assert.doesNotMatch(mockGateway.pesanTerkirim[0].teks, new RegExp(kodeTiket1));
  assert.match(mockGateway.pesanTerkirim[0].teks, /Tidak ditemukan pesanan aktif/i);

  // Langkah 6: Pengirim lain tidak bisa melihat tiket ini
  mockGateway.reset();
  await prosesWebhookMasukWa({
    event: "message",
    payload: { id: "msg-cek-curi", from: "orang-asing@lid", body: `cek ${kodeTiket1}`, fromMe: false },
  });
  assert.match(mockGateway.pesanTerkirim[0].teks, /tidak ditemukan/i);
});

test("Phase 6A.1: Audit log mencatat nomor_belum_diverifikasi: true tanpa membocorkan nomor", async () => {
  mockGateway.reset();
  const lidPengirim = "audit-lid-test@lid";
  mockGateway.setMockLid(lidPengirim, null, 404);

  const payload = {
    event: "message",
    payload: {
      id: "msg-order-audit-test",
      from: lidPengirim,
      body: `Nama: Siti Rahma
Barang: Cuci Standard Bot | 1 | Flat Shoes
Antar/Jemput: Jemput
Nomor WA: 081277778888`,
      fromMe: false,
    },
  };

  const res = await prosesWebhookMasukWa(payload, "");
  assert.equal(res.ok, true);

  // Periksa catatan audit log
  const auditRes = await pool.query(
    `SELECT nilai_baru
     FROM audit_logs
     WHERE entitas = 'orders' AND aksi = 'TAMBAH_TIKET' AND nilai_baru->>'kode_tiket' = $1`,
    [res.kodeTiket]
  );
  assert.equal(auditRes.rowCount, 1);
  const nilaiBaru = auditRes.rows[0].nilai_baru;
  assert.equal(nilaiBaru.nomor_belum_diverifikasi, true);
  // Verifikasi nomor telepon tidak bocor di audit_logs
  assert.equal(nilaiBaru.nomor_wa, undefined);
  const auditJson = JSON.stringify(nilaiBaru);
  assert.ok(!auditJson.includes("081277778888"));
  assert.ok(!auditJson.includes("6281277778888"));
});

test("Migrasi 0011: Trigger blokir update orders menolak pengubahan chat_hash dan nomor_terverifikasi", async () => {
  // Ambil salah satu tiket yang ada
  const r = await pool.query("SELECT id FROM orders LIMIT 1");
  assert.ok(r.rowCount > 0, "Harus ada order di database");
  const orderId = r.rows[0].id;

  // 1. Coba ubah chat_hash -> harus ditolak
  await assert.rejects(
    async () => {
      await pool.query("UPDATE orders SET chat_hash = 'hash_ilegal_baru' WHERE id = $1", [orderId]);
    },
    (err) => {
      assert.match(err.message, /Kolom chat_hash pada orders tidak boleh diubah setelah tiket dibuat/i);
      return true;
    }
  );

  // 2. Coba ubah nomor_terverifikasi -> harus ditolak
  await assert.rejects(
    async () => {
      await pool.query("UPDATE orders SET nomor_terverifikasi = false WHERE id = $1", [orderId]);
    },
    (err) => {
      assert.match(err.message, /Kolom nomor_terverifikasi pada orders tidak boleh diubah setelah tiket dibuat/i);
      return true;
    }
  );
});

// =========================================================================
// 8. Pengujian 10 Perbaikan Keamanan & Keandalan (Phase 6A/6A.1 Refinements)
// =========================================================================

test("Fix 1: Pengirim terverifikasi selalu memakai nomor terverifikasi, nomor ketikan diabaikan, balasan memakai parse.nama", async () => {
  mockGateway.reset();
  const nomorPengirim = "628111222333";
  const jidPengirim = `${nomorPengirim}@c.us`;

  // Masukkan customer korban ke database
  const nomorKorban = "628999888777";
  const namaKorban = "Korban Penipuan Lama";
  await pool.query(
    "INSERT INTO customers (nama, nomor_wa) VALUES ($1, $2) ON CONFLICT (nomor_wa) DO UPDATE SET nama = $1",
    [namaKorban, nomorKorban]
  );

  const payload = {
    event: "message",
    payload: {
      id: "msg-fix1-test",
      from: jidPengirim,
      body: `Nama: Penyerang Iseng
Barang: Cuci Standard Bot | 1 | Sepatu Sneaker
Antar/Jemput: Jemput
Nomor WA: 08999888777`,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  const res = await prosesWebhookMasukWa(payload);
  assert.equal(res.ok, true);

  // Periksa balasan sukses: WAJIB memakai nama yang diketik (Penyerang Iseng), TIDAK BOLEH memuat nama korban
  const balasan = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasan, /Nama: \*Penyerang Iseng\*/);
  assert.doesNotMatch(balasan, new RegExp(namaKorban));

  // Periksa tiket di database: WAJIB terhubung ke customer nomor pengirim (628111222333), BUKAN nomor korban
  const tiketDb = await pool.query(
    `SELECT o.kode_tiket, o.nomor_terverifikasi, c.nomor_wa
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.kode_tiket = $1`,
    [res.kodeTiket]
  );
  assert.equal(tiketDb.rowCount, 1);
  assert.equal(tiketDb.rows[0].nomor_wa, nomorPengirim, "Tiket harus atas nomor pengirim terverifikasi");
  assert.equal(tiketDb.rows[0].nomor_terverifikasi, true);
});

test("Fix 2: Balasan cek status tidak menampilkan nama pelanggan sama sekali", async () => {
  mockGateway.reset();
  const nomor = "62811555666";
  const jid = `${nomor}@c.us`;

  // Buat tiket untuk user ini
  const payloadOrder = {
    event: "message",
    payload: {
      id: "msg-fix2-order",
      from: jid,
      body: `Nama: Rahasia Pribadi
Barang: Cuci Standard Bot | 1 | Sepatu Lari
Antar/Jemput: Jemput`,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
  const resOrder = await prosesWebhookMasukWa(payloadOrder);
  assert.equal(resOrder.ok, true);
  const kodeTiket = resOrder.kodeTiket;

  mockGateway.reset();
  const payloadCek = {
    event: "message",
    payload: {
      id: "msg-fix2-cek",
      from: jid,
      body: `cek ${kodeTiket}`,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
  const resCek = await prosesWebhookMasukWa(payloadCek);
  assert.equal(resCek.ok, true);

  const balasanCek = mockGateway.pesanTerkirim[0].teks;
  // Memastikan TIDAK ADA kata "Nama:" atau nama pelanggan di balasan cek
  assert.doesNotMatch(balasanCek, /Nama:/i, "Balasan cek tidak boleh memuat label Nama:");
  assert.doesNotMatch(balasanCek, /Rahasia Pribadi/i, "Balasan cek tidak boleh memuat nama pelanggan");
  assert.match(balasanCek, new RegExp(kodeTiket), "Harus memuat kode tiket");
  assert.match(balasanCek, /Status Pesanan:/i);
  assert.match(balasanCek, /Status Pembayaran:/i);
  assert.match(balasanCek, /Estimasi Selesai:/i);
});

test("Fix 3: Dedup atomik mengklaim wa_messages terlebih dahulu di transaksi; race condition hanya buat 1 tiket dan 1 balasan", async () => {
  mockGateway.reset();
  const jid = "62811777888@c.us";
  const msgId = "msg-race-atomic-1";

  const payload = {
    event: "message",
    payload: {
      id: msgId,
      from: jid,
      body: `Nama: Pelanggan Serentak
Barang: Cuci Standard Bot | 1 | Sepatu Putih
Antar/Jemput: Jemput`,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  // Jalankan 2 pemrosesan secara serentak (race condition)
  const [res1, res2] = await Promise.all([
    prosesWebhookMasukWa(payload),
    prosesWebhookMasukWa(payload),
  ]);

  // Tepat satu yang berhasil membuat tiket
  const suksesCount = [res1, res2].filter((r) => r.kodeTiket).length;
  assert.equal(suksesCount, 1, "Tepat satu panggilan yang membuat tiket");

  // Periksa pesan balasan keluar yang dikirim gateway
  const balasanSukses = mockGateway.pesanTerkirim.filter((p) => p.teks.includes("Pesanan Berhasil Dicatat"));
  assert.equal(balasanSukses.length, 1, "Tepat satu balasan pemesanan terkirim");

  // Periksa database: tepat 1 order di tabel orders dengan wa_messages provider_message_id ini
  const rMsg = await pool.query("SELECT * FROM wa_messages WHERE provider_message_id = $1", [msgId]);
  assert.equal(rMsg.rowCount, 1, "Hanya satu baris di wa_messages");
});

test("Fix 4: Pesan non-order mengklaim ID terlebih dahulu; retry tidak memicu balasan ganda", async () => {
  mockGateway.reset();
  const jid = "62811999000@c.us";
  const msgId = "msg-menu-retry-test";

  const payload = {
    event: "message",
    payload: {
      id: msgId,
      from: jid,
      body: "MENU",
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  // Panggilan pertama
  const res1 = await prosesWebhookMasukWa(payload);
  assert.equal(res1.ok, true);
  assert.equal(res1.balasanTerkirim, true);
  assert.equal(mockGateway.pesanTerkirim.length, 1);

  // Panggilan kedua (simulasi retry dari WAHA setelah timeout / 500)
  const res2 = await prosesWebhookMasukWa(payload);
  assert.equal(res2.ok, true);
  assert.equal(res2.duplikat, true);
  // Gateway tidak boleh mengirim balasan kedua!
  assert.equal(mockGateway.pesanTerkirim.length, 1, "Balasan tidak boleh dikirim ulang pada pesan duplikat");
});

test("Fix 5: SESSION_SECRET kosong, < 32 karakter, atau placeholder gagal tertutup (503)", async () => {
  const secretAsli = process.env.SESSION_SECRET;
  try {
    // Kondisi 1: kosong
    process.env.SESSION_SECRET = "";
    assert.throws(
      () => buatChatHash("test@lid"),
      (err) => {
        assert.match(err.message, /SESSION_SECRET belum dikonfigurasi/i);
        return true;
      }
    );

    // Kondisi 2: < 32 karakter
    process.env.SESSION_SECRET = "rahasia-pendek";
    assert.throws(
      () => buatChatHash("test@lid"),
      (err) => {
        assert.match(err.message, /kurang dari 32 karakter/i);
        return true;
      }
    );

    // Kondisi 3: placeholder
    process.env.SESSION_SECRET = "isi_dengan_kunci_rahasia_hmac_sha512_minimal_32_karakter";
    assert.throws(
      () => buatChatHash("test@lid"),
      (err) => {
        assert.match(err.message, /menggunakan teks contoh\/placeholder/i);
        return true;
      }
    );
  } finally {
    process.env.SESSION_SECRET = secretAsli;
  }
});

test("Fix 6: Migrasi 0011 memberi GRANT DELETE wa_messages dan bersihkanCatatanWaUsang benar-benar menghapus pesan lama", async () => {
  // Masukkan pesan dengan waktu 35 hari yang lalu
  await pool.query(
    `INSERT INTO wa_messages (customer_id, arah, isi, provider_message_id, order_id, waktu)
     VALUES (NULL, 'masuk', 'pesan kuno', 'msg-kuno-1', NULL, now() - interval '35 days')`
  );

  // Jalankan fungsi pembersihan
  const hasil = await bersihkanCatatanWaUsang(pool);
  assert.ok(hasil.pesanTerhapus >= 1, "Pesan lama harus berhasil dihapus tanpa galat izin");

  const cek = await pool.query("SELECT 1 FROM wa_messages WHERE provider_message_id = 'msg-kuno-1'");
  assert.equal(cek.rowCount, 0, "Pesan kuno harus sudah tidak ada di database");
});

test("Fix 7: Pesan tanpa id ditolak/diabaikan (200), dan payload tanpa timestamp ditolak periksaUsiaPayload", async () => {
  mockGateway.reset();
  // 1. Pesan tanpa id
  const payloadTanpaId = {
    event: "message",
    payload: {
      from: "62811222333@c.us",
      body: "MENU",
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
  const res = await prosesWebhookMasukWa(payloadTanpaId);
  assert.equal(res.ok, true);
  assert.equal(res.diabaikan, true);
  assert.match(res.alasan, /id/i);
  assert.equal(mockGateway.pesanTerkirim.length, 0, "Tidak boleh ada balasan jika ID tidak ada");

  // 2. periksaUsiaPayload tanpa timestamp wajib menolak
  const cekNull = periksaUsiaPayload(null);
  assert.equal(cekNull.valid, false, "Timestamp null harus tidak valid");
  const cekUndef = periksaUsiaPayload(undefined);
  assert.equal(cekUndef.valid, false, "Timestamp undefined harus tidak valid");
});

test("Fix 8: Validasi tipe payload primitif / non-string dijawab 200 tanpa unhandled 500 error", async () => {
  mockGateway.reset();

  // Test 8A: body bukan string (misal number)
  const resNumberBody = await prosesWebhookMasukWa({
    event: "message",
    payload: {
      id: "msg-bad-type-1",
      from: "62811222333@c.us",
      body: 12345,
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
  assert.equal(resNumberBody.ok, true);
  assert.equal(resNumberBody.diabaikan, true);

  // Test 8B: from bukan string
  const resBadFrom = await prosesWebhookMasukWa({
    event: "message",
    payload: {
      id: "msg-bad-type-2",
      from: 123456,
      body: "halo",
      fromMe: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
  assert.equal(resBadFrom.ok, true);
  assert.equal(resBadFrom.diabaikan, true);

  // Test 8C: payload bernilai null atau bukan object
  const resNull = await prosesWebhookMasukWa(null);
  assert.equal(resNull.ok, true);
  assert.equal(resNull.diabaikan, true);
});

test("Fix 9: Parser layanan hanya menerima nomor urut pricelist (1..N) atau nama persis, bukan ID database di luar urutan", () => {
  const katalogMock = [
    { id: 10, nama: "Deep Clean", harga: 50000, estimasi_hari: 3 },
    { id: 25, nama: "Fast Clean", harga: 30000, estimasi_hari: 1 },
  ];

  // Nomor urut 1 harus memetakan ke "Deep Clean" (urutan 1)
  const p1 = parsePesanPemesananWa(
    "Nama: Andi\nBarang: 1 | 1 | Nike\nAntar/Jemput: Jemput",
    katalogMock
  );
  assert.equal(p1.ok, true);
  assert.equal(p1.items[0].nama_layanan, "Deep Clean");

  // Nomor urut 2 harus memetakan ke "Fast Clean" (urutan 2)
  const p2 = parsePesanPemesananWa(
    "Nama: Andi\nBarang: 2 | 1 | Nike\nAntar/Jemput: Jemput",
    katalogMock
  );
  assert.equal(p2.ok, true);
  assert.equal(p2.items[0].nama_layanan, "Fast Clean");

  // Nomor 10 (merupakan ID database, bukan nomor urut 1..2) HARUS DITOLAK
  const p10 = parsePesanPemesananWa(
    "Nama: Andi\nBarang: 10 | 1 | Nike\nAntar/Jemput: Jemput",
    katalogMock
  );
  assert.equal(p10.ok, false);
  assert.match(p10.galat, /tidak ditemukan/i);

  // Nama layanan persis tetap diterima
  const pNama = parsePesanPemesananWa(
    "Nama: Andi\nBarang: Deep Clean | 1 | Nike\nAntar/Jemput: Jemput",
    katalogMock
  );
  assert.equal(pNama.ok, true);
  assert.equal(pNama.items[0].nama_layanan, "Deep Clean");
});

test("Fix 10: WAHA_BASE_URL kosong melempar galat konfigurasi yang jelas tanpa rahasia dan tanpa fallback port 3000", () => {
  const envAsli = process.env.WAHA_BASE_URL;
  try {
    delete process.env.WAHA_BASE_URL;
    assert.throws(
      () => new WahaGatewayAdapter({ baseUrl: "" }),
      (err) => {
        assert.match(err.message, /WAHA_BASE_URL belum diatur/i);
        assert.doesNotMatch(err.message, /3000/, "Tidak boleh ada fallback ke port 3000");
        return true;
      }
    );
  } finally {
    process.env.WAHA_BASE_URL = envAsli;
  }
});

test("formatBarisDeskripsiBarangWa memformat 0, 1, dan multi-item secara konsisten", () => {
  assert.equal(formatBarisDeskripsiBarangWa([]), "Deskripsi Barang: -");
  assert.equal(
    formatBarisDeskripsiBarangWa([
      { layanan: "Outsole biasa", jumlah: 1, deskripsi_barang: "sepatu adidas\nhitam" },
    ]),
    "Deskripsi Barang: sepatu adidas hitam"
  );
  assert.equal(
    formatBarisDeskripsiBarangWa(
      [{ layanan: "Outsole biasa", jumlah: 2, deskripsi_barang: "sepatu adidas hitam" }],
      "   "
    ),
    "   Deskripsi Barang: 2x sepatu adidas hitam"
  );
  assert.equal(
    formatBarisDeskripsiBarangWa(
      [
        { layanan: "Outsole biasa", jumlah: 1, deskripsi_barang: "sepatu adidas hitam" },
        { layanan: "Deep Clean", jumlah: 2, deskripsi_barang: "sneakers nike putih" },
      ],
      "   "
    ),
    "   Deskripsi Barang:\n   - 1x Outsole biasa — sepatu adidas hitam\n   - 2x Deep Clean — sneakers nike putih"
  );
});

test("Cek pesanan aktif & cek kode tiket menampilkan deskripsi barang untuk 1 maupun multi-item tanpa membocorkan nama pelanggan", async () => {
  mockGateway.reset();
  const nomorWa = "6281333444555";
  const jid = `${nomorWa}@c.us`;

  await pool.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ('Deep Clean Multi Tes', 55000, 3, true)
     ON CONFLICT (nama) DO UPDATE SET aktif = true`
  );

  // Order multi-item
  const resMulti = await prosesWebhookMasukWa(
    {
      event: "message",
      payload: {
        id: "msg-order-multi-desc",
        from: jid,
        body: `Nama: Pelanggan Rahasia Multi
Barang: Cuci Standard Bot | 1 | Sepatu Adidas Hitam
Barang: Deep Clean Multi Tes | 2 | Sneakers Nike Putih
Antar/Jemput: Antar sendiri`,
        fromMe: false,
      },
    },
    ""
  );
  assert.equal(resMulti.ok, true);
  const kodeMulti = resMulti.kodeTiket;

  // Cek semua pesanan aktif ("3")
  mockGateway.reset();
  await prosesWebhookMasukWa(
    {
      event: "message",
      payload: { id: "msg-cek-multi-list", from: jid, body: "3", fromMe: false },
    },
    ""
  );
  const balasanList = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasanList, new RegExp(kodeMulti));
  assert.match(balasanList, /Deskripsi Barang:/);
  assert.match(balasanList, /- 1x Cuci Standard Bot — Sepatu Adidas Hitam/);
  assert.match(balasanList, /- 2x Deep Clean Multi Tes — Sneakers Nike Putih/);
  assert.doesNotMatch(balasanList, /Pelanggan Rahasia Multi/);

  // Cek kode tiket ("cek <KODE>")
  mockGateway.reset();
  await prosesWebhookMasukWa(
    {
      event: "message",
      payload: { id: "msg-cek-multi-detail", from: jid, body: `cek ${kodeMulti}`, fromMe: false },
    },
    ""
  );
  const balasanDetail = mockGateway.pesanTerkirim[0].teks;
  assert.match(balasanDetail, new RegExp(`Status Pesanan ${kodeMulti}`));
  assert.match(balasanDetail, /Deskripsi Barang:/);
  assert.match(balasanDetail, /- 1x Cuci Standard Bot — Sepatu Adidas Hitam/);
  assert.match(balasanDetail, /- 2x Deep Clean Multi Tes — Sneakers Nike Putih/);
  assert.doesNotMatch(balasanDetail, /Pelanggan Rahasia Multi/);
});
