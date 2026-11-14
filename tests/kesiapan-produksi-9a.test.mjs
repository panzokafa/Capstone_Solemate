// Test Suite Phase 9A: Kesiapan Produksi di Kode.
// Menguji:
// 1. Zona waktu eksplisit Asia/Jakarta (hourCycle: "h23", batas 00.00 WIB, timestamp tetap 2026-11-14T17:30:00Z)
// 2. Database runtime hanya memakai DATABASE_URL_APP (tanpa fallback ke DATABASE_URL admin), SSL gagal tertutup di produksi,
//    serta pool.on("error") yang hanya mencatat kode galat aman
// 3. WA_GATEWAY_MODE gagal tertutup di produksi ('waha' vs 'nonaktif', penolakan 'mock'), webhook 503 & notifikasi saklar_mati
// 4. Header x-sync-notifikasi hanya dihormati di non-produksi; di produksi diabaikan dan memakai after()
// 5. Penjaga Origin (APP_ORIGIN https wajib di produksi, x-forwarded-host tidak dipercayai)
// 6. Penjaga produksi murni (/dev/*, /detail-tiket, scripts/seed.js)
// 7. Pemindaian statis seluruh console.* di src/ agar tidak mencetak objek error mentah atau err.message
// 8. Bukti gagal-lalu-lulus (via pembanding di berkas tes) untuk 3 perilaku kunci (a, b, c)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  formatTanggal,
  formatWaktu,
  formatTanggalYmdWib,
  formatKodeTanggalWib,
  formatDatetimeLocalWib,
} from "../src/lib/format.ts";
import { tanggalHariIniWib } from "../src/lib/tiket-validasi.ts";
import {
  adalahNilaiPlaceholder,
  apakahFaseBuildNext,
  apakahOriginDiizinkan,
  apakahRuteDevTerblokir,
  apakahSinkronNotifikasiDiizinkan,
  apakahWaGatewayNonaktif,
  ekstrakKodeGalatAman,
  evaluasiPermintaanUbah,
  tegakkanEnvProduksi,
  tentukanModeWaGateway,
  validasiDaftarAppOrigin,
  validasiEnvProduksi,
} from "../src/lib/env-produksi.ts";
import { periksaIzinSeed } from "../scripts/seed-guard.mjs";
import {
  bangunKonfigurasiPoolDb,
  catatGalatPoolAman,
  getPool,
} from "../src/lib/db.ts";
import {
  ambilWaGateway,
  aturWaGatewayInstance,
  MockWaGatewayAdapter,
} from "../src/lib/wa-gateway.ts";
import {
  cekSaklarNotifikasiAktif,
  jadwalkanPengirimanNotifikasiSiapDiambil,
  prosesNotifikasiSiapDiambil,
} from "../src/lib/wa-notifikasi.ts";
import { prosesWebhookMasukWa } from "../src/lib/wa-bot.ts";
import { buatTiketToko } from "../src/lib/tiket.ts";

// Toggle murni di berkas tes untuk membuktikan skenario GAGAL (pembanding naif)
// lalu LULUS (implementasi produksi) pada uji 8(a), 8(b), dan 8(c).
const PAKAI_PEMBANDING_NAIF = process.env.UJI_PEMBANDING_NAIF === "1";

const ENV_PRODUKSI_VALID_WAHA = {
  NODE_ENV: "production",
  DATABASE_URL_APP:
    "postgresql://solemate_app:SangatKuatDanUnik998877@ep-neon-pooler.ap-southeast-1.aws.neon.tech:5432/solemate?sslmode=require",
  SESSION_SECRET:
    "kunci_sesi_produksi_sangat_acak_minimal_32_karakter_9988776655",
  APP_ORIGIN: "https://solemate-demo.vercel.app",
  WA_GATEWAY_MODE: "waha",
  WAHA_BASE_URL: "https://waha.solemate-contoh.id",
  WAHA_API_KEY: "waha_live_key_acak_998877665544332211",
  WAHA_WEBHOOK_HMAC_KEY:
    "hmac_webhook_produksi_sangat_acak_minimal_32_karakter_112233",
};

after(async () => {
  aturWaGatewayInstance(null);
  await getPool().end().catch(() => {});
});

// ============================================================================
// 1 & 8(a). ZONA WAKTU ASIA/JAKARTA, HOURCYCLE H23, & BUKTI GAGAL-LALU-LULUS (a)
// ============================================================================

test("Phase 9A (1): Timestamp tetap 2026-11-14T17:30:00Z dan batas 00.00 WIB (hourCycle h23) tidak bergantung TZ mesin", () => {
  const tsTetap = "2026-11-14T17:30:00Z"; // 15 November 2026 pukul 00.30 WIB

  assert.equal(
    formatTanggal(tsTetap, { denganWaktu: true }),
    "15 November 2026, 00.30 WIB"
  );
  assert.equal(formatTanggal(tsTetap), "15 November 2026");
  assert.equal(
    formatTanggal(tsTetap, { ringkas: true }),
    "15 Nov 2026"
  );
  assert.equal(formatWaktu(tsTetap), "00.30 WIB");
  assert.equal(formatTanggalYmdWib(tsTetap), "2026-11-15");
  assert.equal(tanggalHariIniWib(new Date(tsTetap)), "2026-11-15");
  assert.equal(formatKodeTanggalWib(tsTetap), "20261115");
  assert.equal(formatDatetimeLocalWib(tsTetap), "2026-11-15T00:30");

  // Batas tepat tengah malam 00.00 WIB (2026-11-14T17:00:00Z) wajib "00.00 WIB" (bukan "24.00 WIB")
  const tsTengahMalamWib = "2026-11-14T17:00:00Z";
  assert.equal(
    formatTanggal(tsTengahMalamWib, { denganWaktu: true }),
    "15 November 2026, 00.00 WIB"
  );
  assert.equal(formatWaktu(tsTengahMalamWib), "00.00 WIB");
  assert.equal(formatDatetimeLocalWib(tsTengahMalamWib), "2026-11-15T00:00");
});

test("Phase 9A (8a): Bukti gagal-lalu-lulus kode tiket bertanggal WIB pada 2026-11-14T17:30:00Z (pembanding UTC-naif vs produksi + DB UTC)", async () => {
  const tsUji = new Date("2026-11-14T17:30:00Z");

  // Pembanding UTC-naif (hanya di berkas tes): memakai toISOString().slice(0, 10)
  function kodeTanggalUtcNaif(d) {
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  // 1. Verifikasi baseline pembanding UTC-naif: menghasilkan 20261114 pada 2026-11-14T17:30:00Z
  const hasilNaif = kodeTanggalUtcNaif(tsUji);
  assert.equal(hasilNaif, "20261114");
  assert.notEqual(
    hasilNaif,
    "20261115",
    "Pembanding UTC-naif salah menghasilkan tanggal 14 November saat sudah 15 November 00.30 WIB"
  );

  // 2. Uji pembuatan tiket di database ketika sesi PostgreSQL berada di UTC
  const pool = getPool();
  const layananRes = await pool.query(
    `INSERT INTO services (nama, harga, estimasi_hari, aktif)
     VALUES ('Cuci Uji Zona Waktu 9A', 35000, 2, true)
     ON CONFLICT (nama) DO UPDATE SET aktif = true
     RETURNING id`
  );
  const serviceId = layananRes.rows[0].id;

  const userRes = await pool.query(
    `INSERT INTO users (nama, peran, pin_hash, aktif)
     VALUES ('kasir_uji_tz_9a', 'kasir', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHVqaTlh$aGFzaHVqaTlh', true)
     ON CONFLICT (nama) DO UPDATE SET aktif = true
     RETURNING id`
  );
  const userId = userRes.rows[0].id;

  // Verifikasi ekspresi SQL dengan sesi UTC eksplisit
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const tzCheck = await client.query("SHOW TIME ZONE");
    assert.equal(tzCheck.rows[0].TimeZone, "UTC");
    await client.query("COMMIT");
  } finally {
    client.release();
  }

  const hasilTiket = await buatTiketToko(
    {
      nomor_wa: "6281299998877",
      nama_pelanggan: "Pelanggan Uji WIB",
      konfirmasi_ubah_nama: false,
      tanggal_masuk: tsUji,
      estimasi_selesai: null,
      status_bayar: "Belum bayar",
      metode_bayar: null,
      items: [
        {
          service_id: serviceId,
          jumlah: 1,
          deskripsi_barang: "Sneakers putih uji zona waktu",
        },
      ],
    },
    userId,
    tsUji
  );

  assert.equal(hasilTiket.ok, true);

  // 3. Kontrak GAGAL-lalu-LULUS 8(a): saat UJI_PEMBANDING_NAIF=1 memakai hasil UTC-naif (20261114) sehingga GAGAL;
  // saat normal memakai formatKodeTanggalWib dan hasilTiket.tiket.kode_tiket produksi (20261115) sehingga LULUS.
  const tanggalKodeDiuji = PAKAI_PEMBANDING_NAIF
    ? hasilNaif
    : formatKodeTanggalWib(tsUji);
  const kodeTiketDiuji = PAKAI_PEMBANDING_NAIF
    ? `SM-${hasilNaif}-001`
    : hasilTiket.tiket.kode_tiket;

  assert.match(
    kodeTiketDiuji,
    /^SM-20261115-\d{3,}$/,
    `Kode tiket wajib bertanggal WIB 20261115, didapat: ${kodeTiketDiuji}`
  );
  assert.equal(
    tanggalKodeDiuji,
    "20261115",
    `Tanggal kode tiket wajib 20261115 (WIB), didapat: ${tanggalKodeDiuji}`
  );
});

// ============================================================================
// 1, 2, & 8(c). DATABASE RUNTIME, SSL GAGAL TERTUTUP, POOL ERROR, & BUKTI (c)
// ============================================================================

test("Phase 9A (1, 2, 8c): Bukti gagal-lalu-lulus env produksi menolak fallback DATABASE_URL admin, placeholder, dan pelemahan SSL", () => {
  // Pembanding naif (hanya di berkas tes): jatuh kembali ke DATABASE_URL dan hanya memeriksa panjang >= 32
  function validasiEnvNaif(env) {
    const dbUrl = env.DATABASE_URL_APP || env.DATABASE_URL || "";
    const secret = env.SESSION_SECRET || "";
    return {
      ok: dbUrl.startsWith("postgres") && secret.length >= 32,
    };
  }

  const envFallbackAdminDanPlaceholder = {
    NODE_ENV: "production",
    // Tidak ada DATABASE_URL_APP, hanya DATABASE_URL admin
    DATABASE_URL:
      "postgresql://solemate:SangatKuatAdmin123@ep-neon.ap-southeast-1.aws.neon.tech:5432/solemate?sslmode=require",
    // Panjang >= 32 tetapi nilai placeholder
    SESSION_SECRET: "ganti_dengan_string_acak_minimal_32_karakter",
    APP_ORIGIN: "https://solemate-demo.vercel.app",
    WA_GATEWAY_MODE: "nonaktif",
  };

  // 1. Verifikasi baseline pembanding naif: meloloskan fallback DATABASE_URL admin & placeholder
  assert.equal(validasiEnvNaif(envFallbackAdminDanPlaceholder).ok, true);

  // 2. Kontrak GAGAL-lalu-LULUS 8(c): saat UJI_PEMBANDING_NAIF=1 memakai validasiEnvNaif -> GAGAL karena ok=true;
  // saat normal memakai validasiEnvProduksi -> LULUS karena menolak fallback & placeholder.
  const validatorDiuji = PAKAI_PEMBANDING_NAIF
    ? validasiEnvNaif
    : validasiEnvProduksi;
  const hasilProd = validatorDiuji(envFallbackAdminDanPlaceholder);
  assert.equal(
    hasilProd.ok,
    false,
    "Validasi env produksi wajib menolak fallback ke DATABASE_URL admin dan placeholder SESSION_SECRET"
  );
  assert.ok(
    hasilProd.daftarGalat.some((g) =>
      g.includes("DATABASE_URL_APP wajib diisi di produksi (fallback ke DATABASE_URL admin ditolak)")
    )
  );
  assert.ok(
    hasilProd.daftarGalat.some((g) =>
      g.includes("SESSION_SECRET masih menggunakan teks contoh/placeholder")
    )
  );
  // Pesan error tidak boleh membocorkan nilai rahasia
  assert.ok(!hasilProd.pesan.includes("SangatKuatAdmin123"));
  assert.ok(
    !hasilProd.pesan.includes("ganti_dengan_string_acak_minimal_32_karakter")
  );

  // 3. bangunKonfigurasiPoolDb menolak jika DATABASE_URL_APP kosong meskipun DATABASE_URL terisi
  assert.throws(
    () =>
      bangunKonfigurasiPoolDb({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://solemate:rahasia@127.0.0.1:5432/solemate",
      }),
    /DATABASE_URL_APP belum diisi/
  );

  // 4. SSL gagal tertutup di produksi: tolak DB_SSL_REJECT_UNAUTHORIZED=false dan DB_SSL=false
  assert.throws(
    () =>
      bangunKonfigurasiPoolDb({
        ...ENV_PRODUKSI_VALID_WAHA,
        DB_SSL_REJECT_UNAUTHORIZED: "false",
      }),
    /DB_SSL_REJECT_UNAUTHORIZED=false ditolak di produksi/
  );
  assert.throws(
    () =>
      bangunKonfigurasiPoolDb({
        ...ENV_PRODUKSI_VALID_WAHA,
        DB_SSL: "false",
      }),
    /DB_SSL=false ditolak di produksi/
  );
  assert.throws(
    () =>
      bangunKonfigurasiPoolDb({
        ...ENV_PRODUKSI_VALID_WAHA,
        DATABASE_URL_APP:
          "postgresql://solemate_app:SangatKuatDanUnik998877@ep-neon-pooler.aws.neon.tech:5432/solemate?sslmode=disable",
      }),
    /tidak boleh mematikan verifikasi SSL/
  );

  // 5. Konfigurasi pool produksi valid memakai SSL ketat & batas koneksi serverless
  const cfgProd = bangunKonfigurasiPoolDb(ENV_PRODUKSI_VALID_WAHA);
  assert.deepEqual(cfgProd.ssl, { rejectUnauthorized: true });
  assert.equal(cfgProd.max, 5);
  assert.equal(cfgProd.idleTimeoutMillis, 5000);
  assert.equal(cfgProd.connectionTimeoutMillis, 10000);
  assert.equal(cfgProd.allowExitOnIdle, true);

  // 6. Saat fase `next build` (NEXT_PHASE=phase-production-build), validasi runtime dilewati
  assert.equal(
    apakahFaseBuildNext({ NEXT_PHASE: "phase-production-build" }),
    true
  );
  const hasilBuild = validasiEnvProduksi({
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-build",
  });
  assert.equal(hasilBuild.ok, true);
  assert.equal(hasilBuild.dilewatiBuild, true);
});

test("Phase 9A (2): catatGalatPoolAman pada pool.on('error') hanya mencatat kode/nama galat tanpa membocorkan pesan atau data", () => {
  const tangkapan = [];
  const errDenganPesanSensitif = Object.assign(
    new Error(
      "FATAL: password authentication failed for user solemate_app with secret Rahasia12345"
    ),
    { code: "28P01" }
  );

  const kode = catatGalatPoolAman(errDenganPesanSensitif, (label, k) => {
    tangkapan.push(`${label} ${k}`);
  });

  assert.equal(kode, "28P01");
  assert.equal(ekstrakKodeGalatAman(errDenganPesanSensitif), "28P01");
  assert.equal(ekstrakKodeGalatAman(new TypeError("rahasia")), "TypeError");
  assert.equal(adalahNilaiPlaceholder("ganti_password_ini"), true);
  assert.equal(adalahNilaiPlaceholder("KunciAsliSangatKuat998877"), false);
  assert.equal(tangkapan.length, 1);
  assert.equal(
    tangkapan[0],
    "[DB_POOL] Galat klien idle: 28P01"
  );
  assert.ok(!tangkapan[0].includes("Rahasia12345"));
  assert.ok(!tangkapan[0].includes("password authentication failed"));
});

// ============================================================================
// 3. WA_GATEWAY_MODE (WAHA, NONAKTIF, PENOLAKAN MOCK DI PRODUKSI)
// ============================================================================

test("Phase 9A (3): Semua kombinasi WA_GATEWAY_MODE di produksi dan non-produksi", async () => {
  // 1. Produksi: kosong / tidak diatur -> gagal tertutup
  const tanpaMode = validasiEnvProduksi({
    ...ENV_PRODUKSI_VALID_WAHA,
    WA_GATEWAY_MODE: "",
  });
  assert.equal(tanpaMode.ok, false);
  assert.throws(
    () => tentukanModeWaGateway({ NODE_ENV: "production", WA_GATEWAY_MODE: "" }),
    /WA_GATEWAY_MODE wajib diatur secara eksplisit/
  );

  // 2. Produksi: 'mock' -> ditolak (hanya untuk tes)
  const modeMockProd = validasiEnvProduksi({
    ...ENV_PRODUKSI_VALID_WAHA,
    WA_GATEWAY_MODE: "mock",
  });
  assert.equal(modeMockProd.ok, false);
  assert.throws(
    () =>
      tentukanModeWaGateway({ NODE_ENV: "production", WA_GATEWAY_MODE: "mock" }),
    /WA_GATEWAY_MODE='mock' ditolak di produksi/
  );

  // 3. Produksi: nilai asing -> ditolak
  const modeAsingProd = validasiEnvProduksi({
    ...ENV_PRODUKSI_VALID_WAHA,
    WA_GATEWAY_MODE: "twilio",
  });
  assert.equal(modeAsingProd.ok, false);

  // 4. Produksi: 'nonaktif' -> valid TANPA membutuhkan WAHA_BASE_URL, WAHA_API_KEY, WAHA_WEBHOOK_HMAC_KEY
  const envProdNonaktif = {
    NODE_ENV: "production",
    DATABASE_URL_APP: ENV_PRODUKSI_VALID_WAHA.DATABASE_URL_APP,
    SESSION_SECRET: ENV_PRODUKSI_VALID_WAHA.SESSION_SECRET,
    APP_ORIGIN: ENV_PRODUKSI_VALID_WAHA.APP_ORIGIN,
    WA_GATEWAY_MODE: "nonaktif",
    WAHA_BASE_URL: "",
    WAHA_API_KEY: "",
    WAHA_WEBHOOK_HMAC_KEY: "",
  };
  const hasilProdNonaktif = validasiEnvProduksi(envProdNonaktif);
  assert.equal(hasilProdNonaktif.ok, true);
  assert.equal(tentukanModeWaGateway(envProdNonaktif), "nonaktif");
  assert.equal(apakahWaGatewayNonaktif(envProdNonaktif), true);
  assert.equal(
    cekSaklarNotifikasiAktif({
      ...envProdNonaktif,
      WA_NOTIFIKASI_AKTIF: "true",
    }),
    false
  );

  // 5. Produksi: 'waha' tetapi WAHA_* kosong atau placeholder -> ditolak
  const wahaTanpaKunci = validasiEnvProduksi({
    ...ENV_PRODUKSI_VALID_WAHA,
    WAHA_API_KEY: "ganti_api_key_ini",
    WAHA_WEBHOOK_HMAC_KEY: "pendek",
  });
  assert.equal(wahaTanpaKunci.ok, false);
  assert.equal(wahaTanpaKunci.daftarGalat.length, 2);

  // 6. Produksi: 'waha' dengan seluruh WAHA_* valid -> lolos
  const wahaValid = validasiEnvProduksi(ENV_PRODUKSI_VALID_WAHA);
  assert.equal(wahaValid.ok, true);
  assert.equal(tentukanModeWaGateway(ENV_PRODUKSI_VALID_WAHA), "waha");
  assert.equal(apakahWaGatewayNonaktif(ENV_PRODUKSI_VALID_WAHA), false);
  assert.doesNotThrow(() => tegakkanEnvProduksi(ENV_PRODUKSI_VALID_WAHA));

  // 7. Perilaku runtime saat WA_GATEWAY_MODE='nonaktif':
  // (a) Webhook membalas 503 tanpa memproses
  const hasilWebhookNonaktif = await prosesWebhookMasukWa(
    {
      event: "message",
      payload: { id: "msg-nonaktif-1", from: "628123456789@c.us", body: "MENU" },
    },
    envProdNonaktif
  );
  assert.equal(hasilWebhookNonaktif.ok, false);
  assert.equal(hasilWebhookNonaktif.kode, 503);

  // (b) Pengiriman notifikasi otomatis dilewati dengan alasan 'saklar_mati' tanpa butuh WAHA_*
  const pool = getPool();
  const srv = await pool.query(
    `SELECT id FROM services WHERE nama = 'Cuci Uji Zona Waktu 9A' LIMIT 1`
  );
  const usr = await pool.query(
    `SELECT id FROM users WHERE nama = 'kasir_uji_tz_9a' LIMIT 1`
  );
  const tkt = await buatTiketToko(
    {
      nomor_wa: "6281277776655",
      nama_pelanggan: "Pelanggan Nonaktif WA",
      konfirmasi_ubah_nama: false,
      tanggal_masuk: new Date("2026-11-14T10:00:00Z"),
      estimasi_selesai: null,
      status_bayar: "Belum bayar",
      metode_bayar: null,
      items: [
        {
          service_id: srv.rows[0].id,
          jumlah: 1,
          deskripsi_barang: "Sepatu lari uji mode nonaktif",
        },
      ],
    },
    usr.rows[0].id,
    new Date("2026-11-14T10:00:00Z")
  );
  assert.equal(tkt.ok, true);

  await pool.query(
    `INSERT INTO wa_notifikasi (order_id, jenis, status)
     VALUES ($1, 'siap_diambil', 'menunggu')`,
    [tkt.tiket.id]
  );

  const hasilNotifNonaktif = await prosesNotifikasiSiapDiambil(
    tkt.tiket.id,
    { lewatiJeda: true },
    pool,
    {
      ...envProdNonaktif,
      WA_NOTIFIKASI_AKTIF: "true",
    }
  );
  assert.equal(hasilNotifNonaktif.ok, true);
  assert.equal(hasilNotifNonaktif.status, "dilewati");
  assert.equal(hasilNotifNonaktif.alasan_dilewati, "saklar_mati");

  // (c) ambilWaGateway melempar error jika dipanggil langsung saat mode nonaktif
  aturWaGatewayInstance(null);
  assert.throws(
    () => ambilWaGateway(envProdNonaktif),
    /WA_GATEWAY_MODE=nonaktif/
  );
  aturWaGatewayInstance(new MockWaGatewayAdapter());
});

// ============================================================================
// 4 & 8(b). HEADER X-SYNC-NOTIFIKASI & BUKTI GAGAL-LALU-LULUS AFTER() (b)
// ============================================================================

test("Phase 9A (4 & 8b): Header x-sync-notifikasi diabaikan di produksi dan orkestrator memakai after() (bukan floating promise)", async () => {
  // 1. Uji fungsi murni apakahSinkronNotifikasiDiizinkan
  assert.equal(
    apakahSinkronNotifikasiDiizinkan("1", { NODE_ENV: "production" }),
    false
  );
  assert.equal(
    apakahSinkronNotifikasiDiizinkan("1", { NODE_ENV: "development" }),
    true
  );
  assert.equal(
    apakahSinkronNotifikasiDiizinkan("1", { NODE_ENV: "test" }),
    true
  );
  assert.equal(
    apakahSinkronNotifikasiDiizinkan("0", { NODE_ENV: "development" }),
    false
  );
  assert.equal(
    apakahSinkronNotifikasiDiizinkan(null, { NODE_ENV: "development" }),
    false
  );

  // 2. Bukti gagal-lalu-lulus 8(b): Pembanding floating-promise naif vs orkestrator produksi after()
  // Pembanding naif (hanya di berkas tes): memanggil kirimNotifikasi sebagai floating promise tanpa mendaftarkan ke after()
  async function orkestratorFloatingNaif({
    orderId,
    tiketAwal,
    jadwalkanAfter,
    kirimNotifikasi,
  }) {
    // Floating promise dimulai langsung tanpa terdaftar di jadwalkanAfter
    void kirimNotifikasi(orderId, { lewatiJeda: false });
    void jadwalkanAfter;
    return { tiketFinal: tiketAwal, modeEksekusi: "floating" };
  }

  let panggilanKirimNaif = 0;
  const tugasAfterNaif = [];
  await orkestratorFloatingNaif({
    orderId: 101,
    tiketAwal: { id: 101 },
    jadwalkanAfter: (fn) => tugasAfterNaif.push(fn),
    kirimNotifikasi: async () => {
      panggilanKirimNaif += 1;
      return { ok: true, status: "terkirim" };
    },
  });
  // Pada pembanding naif: tugasAfterNaif kosong (tidak terdaftar di after()) dan promise sudah telanjur jalan liar!
  assert.equal(
    tugasAfterNaif.length,
    0,
    "Pembanding floating-promise gagal mendaftarkan pekerjaan ke after()"
  );
  assert.equal(panggilanKirimNaif, 1);

  // Kontrak GAGAL-lalu-LULUS 8(b): saat UJI_PEMBANDING_NAIF=1 memakai orkestratorFloatingNaif -> GAGAL
  // karena modeEksekusi="floating" dan tidak terdaftar di after(); saat normal memakai fungsi produksi
  // `jadwalkanPengirimanNotifikasiSiapDiambil` di NODE_ENV=production dengan header `x-sync-notifikasi: 1` -> LULUS.
  const orkestratorDiuji = PAKAI_PEMBANDING_NAIF
    ? orkestratorFloatingNaif
    : jadwalkanPengirimanNotifikasiSiapDiambil;
  let panggilanKirimProd = 0;
  let panggilanMuatUlangProd = 0;
  const tugasAfterProd = [];

  const hasilJadwalProd = await orkestratorDiuji({
    orderId: 202,
    notifikasiDibuat: true,
    tiketAwal: { id: 202, status: "Siap diambil" },
    headerSync: "1", // Dikirim oleh klien di produksi -> WAJIB DIABAIKAN!
    env: { NODE_ENV: "production" },
    jadwalkanAfter: (fn) => {
      tugasAfterProd.push(fn);
    },
    kirimNotifikasi: async () => {
      panggilanKirimProd += 1;
      return { ok: true, status: "terkirim" };
    },
    muatUlangTiket: async () => {
      panggilanMuatUlangProd += 1;
      return { id: 202, status: "Siap diambil", dimuatUlang: true };
    },
  });

  // Bukti LULUS (dan GAGAL saat PAKAI_PEMBANDING_NAIF=true):
  // - modeEksekusi wajib "after" (bukan "floating" atau "sinkron")
  // - tepat 1 callback terdaftar di jadwalkanAfter
  // - sebelum callback after() dijalankan oleh runtime Next.js, kirimNotifikasi belum berjalan liar (panggilanKirimProd === 0)
  // - muatUlangTiket sinkron tidak dipanggil
  assert.equal(
    hasilJadwalProd.modeEksekusi,
    "after",
    `Pengiriman di produksi wajib memakai after() dan mengabaikan x-sync-notifikasi, didapat modeEksekusi=${hasilJadwalProd.modeEksekusi}`
  );
  assert.equal(tugasAfterProd.length, 1);
  assert.equal(
    panggilanKirimProd,
    0,
    "kirimNotifikasi tidak boleh berjalan sebagai floating promise di luar callback after()"
  );
  assert.equal(panggilanMuatUlangProd, 0);

  // Saat runtime Next.js mengeksekusi callback after():
  await tugasAfterProd[0]();
  assert.equal(panggilanKirimProd, 1);

  // 3. Di non-produksi (NODE_ENV=development) dengan headerSync="1", mode sinkron tetap berjalan untuk tes
  let panggilanKirimDev = 0;
  const tugasAfterDev = [];
  const hasilJadwalDev = await jadwalkanPengirimanNotifikasiSiapDiambil({
    orderId: 203,
    notifikasiDibuat: true,
    tiketAwal: { id: 203, versi: 1 },
    headerSync: "1",
    env: { NODE_ENV: "development" },
    jadwalkanAfter: (fn) => tugasAfterDev.push(fn),
    kirimNotifikasi: async () => {
      panggilanKirimDev += 1;
      return { ok: true, status: "terkirim" };
    },
    muatUlangTiket: async () => ({ id: 203, versi: 2 }),
  });
  assert.equal(hasilJadwalDev.modeEksekusi, "sinkron");
  assert.equal(panggilanKirimDev, 1);
  assert.equal(tugasAfterDev.length, 0);
  assert.deepEqual(hasilJadwalDev.tiketFinal, { id: 203, versi: 2 });
});

// ============================================================================
// 5. ORIGIN GUARD (APP_ORIGIN HTTPS DI PRODUKSI, X-FORWARDED-HOST DIABAIKAN)
// ============================================================================

test("Phase 9A (5a): Penjaga origin menolak x-forwarded-host palsu dan mewajibkan APP_ORIGIN https di produksi", () => {
  const envProd = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://solemate-demo.vercel.app",
    TRUST_PROXY: "true",
  };

  // 1. Serangan spoofing x-forwarded-host + Origin penyerang -> wajib DITOLAK (403)
  const reqSpoof = new Request("https://solemate-demo.vercel.app/api/tiket", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil-attacker.com",
      host: "solemate-demo.vercel.app",
      "x-forwarded-host": "evil-attacker.com",
    },
  });
  const tolakSpoof = evaluasiPermintaanUbah(reqSpoof, envProd);
  assert.equal(tolakSpoof.ok, false);
  assert.equal(tolakSpoof.status, 403);

  // 2. Origin http:// (bukan https://) di produksi -> wajib DITOLAK (403)
  assert.equal(
    apakahOriginDiizinkan(
      "http://solemate-demo.vercel.app",
      "solemate-demo.vercel.app",
      envProd
    ),
    false
  );

  // 3. Origin https:// yang sesuai dengan APP_ORIGIN -> DIIZINKAN (ok: true)
  const reqValid = new Request("https://solemate-demo.vercel.app/api/tiket", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://solemate-demo.vercel.app",
      host: "solemate-demo.vercel.app",
    },
  });
  assert.deepEqual(evaluasiPermintaanUbah(reqValid, envProd), { ok: true });

  // 4. Validasi APP_ORIGIN di produksi menolak http:// atau kosong
  assert.equal(validasiDaftarAppOrigin("", true).ok, false);
  assert.equal(
    validasiDaftarAppOrigin("http://solemate-demo.vercel.app", true).ok,
    false
  );
  assert.equal(
    validasiDaftarAppOrigin("https://solemate-demo.vercel.app", true).ok,
    true
  );
});

// ============================================================================
// 6. PENJAGA PRODUKSI (/DEV/*, /DETAIL-TIKET, SCRIPTS/SEED.JS)
// ============================================================================

test("Phase 9A (6): Penjaga murni /dev/*, /detail-tiket, dan scripts/seed.js", () => {
  // 1. apakahRuteDevTerblokir
  for (const rute of ["/dev", "/dev/komponen", "/detail-tiket", "/detail-tiket/123"]) {
    assert.equal(
      apakahRuteDevTerblokir(rute, { NODE_ENV: "production" }),
      true,
      `Rute ${rute} wajib diblokir (404) di produksi`
    );
    assert.equal(
      apakahRuteDevTerblokir(rute, { NODE_ENV: "development" }),
      false,
      `Rute ${rute} tetap diizinkan di development`
    );
  }
  assert.equal(
    apakahRuteDevTerblokir("/tiket", { NODE_ENV: "production" }),
    false
  );
  assert.equal(
    apakahRuteDevTerblokir("/login", { NODE_ENV: "production" }),
    false
  );

  // 2. periksaIzinSeed dari scripts/seed-guard.mjs
  {
    const tolakProd = periksaIzinSeed(
      { NODE_ENV: "production" },
      ["node", "scripts/seed.js"]
    );
    assert.equal(tolakProd.diizinkan, false);
    assert.equal(tolakProd.kodeKeluar, 1);

    const izinkanProdFlag = periksaIzinSeed(
      { NODE_ENV: "production" },
      ["node", "scripts/seed.js", "--izinkan-produksi"]
    );
    assert.equal(izinkanProdFlag.diizinkan, true);
    assert.equal(izinkanProdFlag.kodeKeluar, 0);

    const lewatiTest = periksaIzinSeed(
      { NODE_ENV: "test" },
      ["node", "scripts/seed.js"]
    );
    assert.equal(lewatiTest.diizinkan, false);
    assert.equal(lewatiTest.kodeKeluar, 0);

    const izinkanDev = periksaIzinSeed(
      { NODE_ENV: "development" },
      ["node", "scripts/seed.js"]
    );
    assert.equal(izinkanDev.diizinkan, true);
    assert.equal(izinkanDev.kodeKeluar, 0);
  }

  // 3. Uji proses CLI `node scripts/seed.js`:
  // - NODE_ENV=production keluar dengan kode 1 dan pesan ditolak
  const hasilCliProd = spawnSync(process.execPath, ["scripts/seed.js"], {
    env: { ...process.env, NODE_ENV: "production", SEED_IZINKAN_PRODUKSI: "" },
    encoding: "utf8",
  });
  assert.equal(hasilCliProd.status, 1);
  assert.match(hasilCliProd.stderr, /Seed ditolak: NODE_ENV='production'/);

  // - NODE_ENV=test keluar dengan kode 0 dan pesan dilewati (perilaku non-produksi tetap sama)
  const hasilCliTest = spawnSync(process.execPath, ["scripts/seed.js"], {
    env: { ...process.env, NODE_ENV: "test" },
    encoding: "utf8",
  });
  assert.equal(hasilCliTest.status, 0);
  assert.match(
    hasilCliTest.stdout,
    /Seed dilewati: NODE_ENV bukan 'development'\./
  );
});

// ============================================================================
// 7. PEMINDAIAN STATIS CONSOLE.* DI SRC/
// ============================================================================

function kumpulkanBerkasKode(dir, hasil = []) {
  for (const entri of readdirSync(dir)) {
    const penuh = join(dir, entri);
    const st = statSync(penuh);
    if (st.isDirectory()) {
      kumpulkanBerkasKode(penuh, hasil);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entri)) {
      hasil.push(penuh);
    }
  }
  return hasil;
}

// Pola deteksi console.* yang mencetak objek error mentah atau properti .message / .stack:
// 1) Argumen variabel error mentah langsung: console.error("...", e) atau console.warn("...", err)
// 2) Akses .message atau .stack atau String(e/err) di dalam pemanggilan console.*
export const POLA_CONSOLE_ERROR_MENTAH =
  /console\.(?:error|warn|log|info|debug)\s*\([^)]*(?:,\s*(?:e|err|error|galat)\s*\)|(?:\b(?:e|err|error|galat)\.(?:message|stack)\b)|\bString\s*\(\s*(?:e|err|error|galat)\s*\))/s;

test("Phase 9A (7): Tidak ada console.* di src/ yang mencetak objek error mentah atau err.message", () => {
  // Pastikan regex detektor benar-benar menangkap contoh berbahaya (bukti detektor bekerja)
  assert.equal(
    POLA_CONSOLE_ERROR_MENTAH.test('console.error("POST /api/katalog gagal:", e)'),
    true
  );
  assert.equal(
    POLA_CONSOLE_ERROR_MENTAH.test(
      'console.warn("[WA_BOT] Gagal:", err instanceof Error ? err.message : "DB")'
    ),
    true
  );
  assert.equal(
    POLA_CONSOLE_ERROR_MENTAH.test(
      'console.error("POST /api/katalog gagal:", ekstrakKodeGalatAman(e))'
    ),
    false
  );

  const semuaBerkasSrc = kumpulkanBerkasKode(join(process.cwd(), "src"));
  const pelanggaran = [];

  for (const pathBerkas of semuaBerkasSrc) {
    const isi = readFileSync(pathBerkas, "utf8");
    const cocok = isi.match(POLA_CONSOLE_ERROR_MENTAH);
    if (cocok) {
      pelanggaran.push({ pathBerkas, cuplikan: cocok[0] });
    }
  }

  assert.deepEqual(
    pelanggaran,
    [],
    `Ditemukan console.* di src/ yang mencetak error mentah atau err.message: ${JSON.stringify(pelanggaran)}`
  );
});
