// Tes Phase 5B (Mutasi Status & Pembayaran Tiket, Pembatalan, Konkurensi FOR UPDATE,
// Idempotensi, Atomisitas Audit, Pertahanan DB Migrasi 0009, Penanda & Filter Tiket Lama WIB,
// Pesan wa.me per Status, dan SSR Kasir vs Owner).
// Seluruh pengujian dijalankan HANYA pada database uji sementara `solemate_test`.
//
// Jalankan:
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/tiket-5b.test.mjs'

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buatAkunUji } from "./helpers/akun.mjs";
import { MIN_HARI_BELUM_DIAMBIL } from "../src/config/tiket.ts";
import { periksaTransisiStatusPesanan } from "../src/config/order-status.ts";
import { buatPesanWaTiket, buatUrlWaMe } from "../src/lib/nomor-wa.ts";
import {
  validasiQueryDaftarTiket,
  validasiUbahTiket,
  tanggalHariIniWib,
  geserHariKalender,
} from "../src/lib/tiket-validasi.ts";
import { daftarTiket, ubahTiket } from "../src/lib/tiket.ts";

const { Pool } = pg;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner 5B ${Date.now()}`;
const KASIR1_NAMA = `KasirSatu 5B ${Date.now()}`;
const KASIR2_NAMA = `KasirDua 5B ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR1_PIN = pin6();
const KASIR2_PIN = pin6();

let admin;
let app;
let ownerCookie;
let kasir1Cookie;
let kasir2Cookie;
let layananUji;

let urutWa = 5000;
function waUnik08() {
  urutWa += 1;
  return `08128800${String(urutWa).padStart(4, "0")}`;
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

async function buatTiketBaru(tambahan = {}) {
  const { res, data } = await api(kasir1Cookie, "POST", "/api/tiket", {
    nama_pelanggan: tambahan.nama_pelanggan ?? "Pelanggan Uji Lima B",
    nomor_wa: tambahan.nomor_wa ?? waUnik08(),
    items: tambahan.items ?? [
      {
        service_id: layananUji.id,
        deskripsi_barang: "Sneakers Putih Kanvas",
        jumlah: 1,
      },
    ],
    status_bayar: tambahan.status_bayar ?? "Belum bayar",
    ...(tambahan.metode_bayar ? { metode_bayar: tambahan.metode_bayar } : {}),
  });
  assert.equal(res.status, 201, `buatTiketBaru gagal: ${JSON.stringify(data)}`);
  return data.data;
}

before(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  app = new Pool({ connectionString: process.env.DATABASE_URL_APP });

  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR1_NAMA, "kasir", KASIR1_PIN);
  await buatAkunUji(KASIR2_NAMA, "kasir", KASIR2_PIN);

  ownerCookie = await login(OWNER_NAMA, OWNER_PIN);
  kasir1Cookie = await login(KASIR1_NAMA, KASIR1_PIN);
  kasir2Cookie = await login(KASIR2_NAMA, KASIR2_PIN);

  const s = await api(ownerCookie, "POST", "/api/katalog", {
    nama: `Cuci Standar 5B ${Date.now()}`,
    harga: 35_000,
    estimasi_hari: 2,
  });
  assert.equal(s.res.status, 201);
  layananUji = s.data.data;
});

after(async () => {
  await app.end();
  await admin.end();
});

// ---------- 1. Otorisasi, Request-Guard, Validasi ID, Field Asing, & status_sebelumnya ----------

test("PATCH /api/tiket/[id]: tanpa login diarahkan ke /login; owner ditolak 403; request-guard memeriksa Origin dan Content-Type", async () => {
  const tiket = await buatTiketBaru();

  // 1. Tanpa login -> redirect /login
  const tanpaLogin = await api(null, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.ok(
    tanpaLogin.res.status === 307 || tanpaLogin.res.status === 302,
    `tanpa login harus redirect, dapat ${tanpaLogin.res.status}`
  );
  assert.match(tanpaLogin.res.headers.get("location") ?? "", /\/login/);

  // 2. Owner -> 403
  const dariOwner = await api(ownerCookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(dariOwner.res.status, 403);

  // 3. Tanpa Origin -> 403
  const tanpaOrigin = await api(
    kasir1Cookie,
    "PATCH",
    `/api/tiket/${tiket.id}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Diproses",
      status_sebelumnya: "Belum dicuci",
    },
    { origin: null }
  );
  assert.equal(tanpaOrigin.res.status, 403);

  // 4. Origin situs lain -> 403
  const originAsing = await api(
    kasir1Cookie,
    "PATCH",
    `/api/tiket/${tiket.id}`,
    {
      jenis: "status_pesanan",
      status_pesanan: "Diproses",
      status_sebelumnya: "Belum dicuci",
    },
    { origin: "https://penyerang.example" }
  );
  assert.equal(originAsing.res.status, 403);

  // 5. Content-Type bukan application/json -> 415
  const salahCt = await api(
    kasir1Cookie,
    "PATCH",
    `/api/tiket/${tiket.id}`,
    undefined,
    { contentType: "text/plain", mentah: "{}" }
  );
  assert.equal(salahCt.res.status, 415);

  // Pastikan status di DB tidak berubah sama sekali
  const cek = await admin.query(`SELECT status_pesanan FROM orders WHERE id = $1`, [tiket.id]);
  assert.equal(cek.rows[0].status_pesanan, "Belum dicuci");
});

test("PATCH /api/tiket/[id]: ID tidak valid, field tak dikenal, total/tanggal dari klien, dan ketiadaan status_sebelumnya ditolak 400", async () => {
  const tiket = await buatTiketBaru();

  // ID tidak valid -> 400
  for (const idBuruk of ["0", "-5", "01", "abc", "1.5", "999999999999"]) {
    const r = await api(kasir1Cookie, "PATCH", `/api/tiket/${idBuruk}`, {
      jenis: "status_pesanan",
      status_pesanan: "Diproses",
      status_sebelumnya: "Belum dicuci",
    });
    assert.equal(r.res.status, 400, `ID '${idBuruk}' harus 400`);
  }

  // ID valid namun tidak ada -> 404
  const tidakAda = await api(kasir1Cookie, "PATCH", `/api/tiket/99999999`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(tidakAda.res.status, 404);

  // status_sebelumnya wajib pada setiap jenis PATCH -> 400 jika hilang
  for (const bodyTanpaSebelumnya of [
    { jenis: "status_pesanan", status_pesanan: "Diproses" },
    { jenis: "pembayaran", status_bayar: "Lunas", metode_bayar: "Cash" },
    { jenis: "batalkan", alasan_batal: "Pelanggan batal" },
  ]) {
    const r = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, bodyTanpaSebelumnya);
    assert.equal(
      r.res.status,
      400,
      `Tanpa status_sebelumnya (${bodyTanpaSebelumnya.jenis}) harus 400, dapat ${r.res.status}`
    );
    assert.equal(r.data?.field, "status_sebelumnya");
  }

  // Field asing, total dari klien, tanggal_bayar dari klien -> semuanya ditolak 400
  for (const bodyAsing of [
    {
      jenis: "status_pesanan",
      status_pesanan: "Diproses",
      status_sebelumnya: "Belum dicuci",
      kolom_siluman: true,
    },
    {
      jenis: "pembayaran",
      status_bayar: "Lunas",
      metode_bayar: "Cash",
      status_sebelumnya: "Belum bayar",
      total: 100,
    },
    {
      jenis: "pembayaran",
      status_bayar: "Lunas",
      metode_bayar: "Cash",
      status_sebelumnya: "Belum bayar",
      tanggal_bayar: "2020-01-01T00:00:00Z",
    },
    {
      jenis: "status_pesanan",
      status_pesanan: "Siap diambil",
      status_sebelumnya: "Diproses",
      siap_diambil_pada: "2020-01-01T00:00:00Z",
    },
  ]) {
    const r = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, bodyAsing);
    assert.equal(r.res.status, 400, `Body ${JSON.stringify(bodyAsing)} harus ditolak 400`);
  }
});

// ---------- 2. Transisi Status Pesanan, Koreksi Mundur, & siap_diambil_pada Tidak Bergeser ----------

test("alur transisi maju, koreksi mundur 1 langkah, lompat langkah 409, dan siap_diambil_pada tidak bergeser saat mundur-maju", async () => {
  // Buat tiket Lunas supaya sampai Sudah diambil tanpa perlu konfirmasi belum bayar
  const tiket = await buatTiketBaru({
    status_bayar: "Lunas",
    metode_bayar: "Cash",
  });

  // Lompat langkah Belum dicuci -> Siap diambil ditolak 409
  const lompat1 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(lompat1.res.status, 409);

  // Lompat langkah Belum dicuci -> Sudah diambil ditolak 409
  const lompat2 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(lompat2.res.status, 409);

  // 1. Maju: Belum dicuci -> Diproses
  const r1 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(r1.res.status, 200);
  assert.equal(r1.data.data.status_pesanan, "Diproses");
  assert.equal(r1.data.data.siap_diambil_pada, null);

  // Lompat Diproses -> Sudah diambil ditolak 409
  const lompat3 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Diproses",
  });
  assert.equal(lompat3.res.status, 409);

  // 2. Maju: Diproses -> Siap diambil (mengisi siap_diambil_pada pertama kali)
  const r2 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Diproses",
  });
  assert.equal(r2.res.status, 200);
  assert.equal(r2.data.data.status_pesanan, "Siap diambil");
  const jamSiapAwal = r2.data.data.siap_diambil_pada;
  assert.ok(jamSiapAwal, "siap_diambil_pada wajib terisi saat masuk Siap diambil");

  // Lompat mundur 2 langkah Siap diambil -> Belum dicuci ditolak 409
  const lompatMundur = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Belum dicuci",
    status_sebelumnya: "Siap diambil",
  });
  assert.equal(lompatMundur.res.status, 409);

  // 3. Koreksi mundur 1 langkah: Siap diambil -> Diproses (siap_diambil_pada TIDAK dikosongkan)
  const rMundur = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Siap diambil",
  });
  assert.equal(rMundur.res.status, 200);
  assert.equal(rMundur.data.data.status_pesanan, "Diproses");
  assert.equal(
    rMundur.data.data.siap_diambil_pada,
    jamSiapAwal,
    "siap_diambil_pada tidak boleh dikosongkan saat koreksi mundur"
  );

  // Tunggu sebentar untuk membuktikan jam benar-benar tidak di-reset ke now() baru
  await new Promise((resolve) => setTimeout(resolve, 40));

  // 4. Maju kembali: Diproses -> Siap diambil (siap_diambil_pada TIDAK bergeser!)
  const rMajuLagi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Diproses",
  });
  assert.equal(rMajuLagi.res.status, 200);
  assert.equal(
    rMajuLagi.data.data.siap_diambil_pada,
    jamSiapAwal,
    "mundur lalu maju ke Siap diambil tidak boleh menggeser siap_diambil_pada"
  );

  // 5. Maju: Siap diambil -> Sudah diambil
  const rAmbil = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Siap diambil",
  });
  assert.equal(rAmbil.res.status, 200);
  assert.equal(rAmbil.data.data.status_pesanan, "Sudah diambil");

  // 6. Koreksi mundur 1 langkah dari Sudah diambil -> Siap diambil diizinkan
  const rKoreksiAmbil = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Sudah diambil",
  });
  assert.equal(rKoreksiAmbil.res.status, 200);
  assert.equal(rKoreksiAmbil.data.data.siap_diambil_pada, jamSiapAwal);

  // Pastikan aksi KOREKSI dan UBAH_STATUS tercatat tanpa nomor WA di audit_logs
  const daftarAksi = rKoreksiAmbil.data.data.riwayat_audit.map((a) => a.aksi);
  assert.ok(daftarAksi.includes("UBAH_STATUS"));
  assert.ok(daftarAksi.includes("KOREKSI"));
  for (const a of rKoreksiAmbil.data.data.riwayat_audit) {
    assert.ok(!JSON.stringify(a).includes(tiket.pelanggan.nomor_wa));
  }

  // Unit check fungsi murni konfigurasi transisi
  assert.equal(periksaTransisiStatusPesanan("Diproses", "Belum dicuci").izinkan, true);
  assert.equal(periksaTransisiStatusPesanan("Sudah diambil", "Diproses").izinkan, false);
});

// ---------- 3. "Sudah diambil" Saat Belum Bayar Wajib Konfirmasi & Dicatat di Audit ----------

test("transisi ke Sudah diambil saat Belum bayar wajib konfirmasi eksplisit dan mencatat belum_bayar_saat_diambil: true di audit", async () => {
  const tiket = await buatTiketBaru({ status_bayar: "Belum bayar" });

  await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Diproses",
  });

  // Tanpa konfirmasi_belum_bayar -> ditolak 409
  const tanpaKonfirmasi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Siap diambil",
  });
  assert.equal(tanpaKonfirmasi.res.status, 409);
  assert.equal(tanpaKonfirmasi.data?.kode_konflik, "BUTUH_KONFIRMASI_BELUM_BAYAR");

  // Dengan konfirmasi_belum_bayar: true -> berhasil 200 dan tercatat di audit
  const denganKonfirmasi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Siap diambil",
    konfirmasi_belum_bayar: true,
  });
  assert.equal(denganKonfirmasi.res.status, 200);
  assert.equal(denganKonfirmasi.data.data.status_pesanan, "Sudah diambil");
  assert.equal(denganKonfirmasi.data.data.status_bayar, "Belum bayar");

  const auditTerakhir =
    denganKonfirmasi.data.data.riwayat_audit[
      denganKonfirmasi.data.data.riwayat_audit.length - 1
    ];
  assert.equal(auditTerakhir.aksi, "UBAH_STATUS");
  assert.equal(auditTerakhir.nilai_baru?.belum_bayar_saat_diambil, true);
});

// ---------- 4. Transisi Pembayaran, Lunas->Lunas Beda Metode 409, & Balik Lunas Wajib Alasan ----------

test("pembayaran: Lunas tanpa metode 400; Lunas->Lunas beda metode 409; balik Lunas wajib alasan bebas karakter terlarang", async () => {
  const tiket = await buatTiketBaru({ status_bayar: "Belum bayar" });

  // 1. Lunas tanpa metode_bayar -> 400
  const tanpaMetode = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(tanpaMetode.res.status, 400);
  assert.equal(tanpaMetode.data?.field, "metode_bayar");

  // 2. Belum bayar -> Lunas (Cash) -> 200, tanggal_bayar diisi server
  const jadiLunas = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(jadiLunas.res.status, 200);
  assert.equal(jadiLunas.data.data.status_bayar, "Lunas");
  assert.equal(jadiLunas.data.data.metode_bayar, "Cash");
  assert.ok(jadiLunas.data.data.tanggal_bayar, "tanggal_bayar wajib diisi server");

  // 3. Lunas -> Lunas dengan metode_bayar berbeda (Cash -> Non-cash) ditolak 409
  //    dengan pesan mengarahkan balik ke Belum bayar dengan alasan lalu Lunas lagi
  const gantiMetodeLangsung = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    status_sebelumnya: "Lunas",
  });
  assert.equal(gantiMetodeLangsung.res.status, 409);
  assert.match(gantiMetodeLangsung.data?.error ?? "", /Belum bayar.*alasan.*Lunas/i);

  // 4. Lunas -> Belum bayar tanpa alasan / kosong / >200 karakter / karakter kontrol-bidi-lebar-nol -> 400
  for (const alasanBuruk of [
    undefined,
    "",
    "   ",
    "x".repeat(201),
    "Salah\npencet",
    "Salah\tpencet",
    "Salah\u0000byte",
    "Salah\u202Ebidi",
    "Salah\u200Blebarnol",
  ]) {
    const bodyUji = {
      jenis: "pembayaran",
      status_bayar: "Belum bayar",
      status_sebelumnya: "Lunas",
      ...(alasanBuruk !== undefined ? { alasan: alasanBuruk } : {}),
    };
    const gagal = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, bodyUji);
    assert.equal(
      gagal.res.status,
      400,
      `Alasan '${String(alasanBuruk)}' seharusnya ditolak 400`
    );
    assert.equal(gagal.data?.field, "alasan");
  }

  // 5. Lunas -> Belum bayar dengan alasan valid -> 200, metode_bayar & tanggal_bayar jadi NULL
  const balikOk = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Belum bayar",
    alasan: "Salah pilih Cash, seharusnya Non-cash",
    status_sebelumnya: "Lunas",
  });
  assert.equal(balikOk.res.status, 200);
  assert.equal(balikOk.data.data.status_bayar, "Belum bayar");
  assert.equal(balikOk.data.data.metode_bayar, null);
  assert.equal(balikOk.data.data.tanggal_bayar, null);

  const auditBalik =
    balikOk.data.data.riwayat_audit[balikOk.data.data.riwayat_audit.length - 1];
  assert.equal(auditBalik.aksi, "UBAH_PEMBAYARAN");
  assert.equal(auditBalik.nilai_baru?.alasan, "Salah pilih Cash, seharusnya Non-cash");

  // 6. Setelah balik ke Belum bayar, tandai Lunas kembali dengan Non-cash berhasil
  const lunasBaru = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Non-cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(lunasBaru.res.status, 200);
  assert.equal(lunasBaru.data.data.metode_bayar, "Non-cash");
});

// ---------- 5. Pembatalan Tiket, Sudah Diambil Tidak Bisa Batal, & Dibatalkan Final ----------

test("pembatalan: wajib alasan valid; tiket Lunas wajib konfirmasi & dicatat di luar sistem; Sudah diambil tidak bisa batal; Dibatalkan bersifat final", async () => {
  // Bagian A: Batal tanpa alasan / karakter terlarang ditolak 400
  const t1 = await buatTiketBaru();
  for (const alasanSalah of [undefined, "", "  ", "a".repeat(201), "Batal\nbaris", "Batal\u202E"]) {
    const r = await api(kasir1Cookie, "PATCH", `/api/tiket/${t1.id}`, {
      jenis: "batalkan",
      ...(alasanSalah !== undefined ? { alasan_batal: alasanSalah } : {}),
      status_sebelumnya: "Belum dicuci",
    });
    assert.equal(r.res.status, 400);
    assert.equal(r.data?.field, "alasan_batal");
  }

  // Bagian B: Tiket Lunas dibatalkan tanpa konfirmasi_sudah_lunas -> 409; dengan konfirmasi -> 200 + catatan audit
  const tLunas = await buatTiketBaru({ status_bayar: "Lunas", metode_bayar: "Cash" });

  const batalTanpaKonfirmasi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tLunas.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan batal jadi mencuci",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(batalTanpaKonfirmasi.res.status, 409);
  assert.equal(batalTanpaKonfirmasi.data?.kode_konflik, "BUTUH_KONFIRMASI_LUNAS");

  const batalDenganKonfirmasi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tLunas.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan batal jadi mencuci",
    konfirmasi_sudah_lunas: true,
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(batalDenganKonfirmasi.res.status, 200);
  assert.equal(batalDenganKonfirmasi.data.data.status_pesanan, "Dibatalkan");
  assert.equal(batalDenganKonfirmasi.data.data.alasan_batal, "Pelanggan batal jadi mencuci");

  const auditBatal =
    batalDenganKonfirmasi.data.data.riwayat_audit[
      batalDenganKonfirmasi.data.data.riwayat_audit.length - 1
    ];
  assert.equal(auditBatal.aksi, "BATALKAN_TIKET");
  assert.equal(auditBatal.nilai_baru?.uang_dikembalikan_di_luar_sistem, true);

  // Bagian C: Dibatalkan bersifat final — ubah status, ubah bayar, atau batal ulang dari Dibatalkan semuanya 409
  const ubahSetelahBatal = await api(kasir1Cookie, "PATCH", `/api/tiket/${tLunas.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Dibatalkan",
  });
  assert.equal(ubahSetelahBatal.res.status, 409);

  const bayarSetelahBatal = await api(kasir1Cookie, "PATCH", `/api/tiket/${tLunas.id}`, {
    jenis: "pembayaran",
    status_bayar: "Belum bayar",
    alasan: "Coba ubah setelah batal",
    status_sebelumnya: "Lunas",
  });
  assert.equal(bayarSetelahBatal.res.status, 409);

  const batalLagi = await api(kasir1Cookie, "PATCH", `/api/tiket/${tLunas.id}`, {
    jenis: "batalkan",
    alasan_batal: "Alasan baru setelah batal",
    konfirmasi_sudah_lunas: true,
    status_sebelumnya: "Dibatalkan",
  });
  assert.equal(batalLagi.res.status, 409);

  // Bagian D: Tiket berstatus "Sudah diambil" tidak bisa dibatalkan -> 409
  const tAmbil = await buatTiketBaru({ status_bayar: "Lunas", metode_bayar: "Non-cash" });
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tAmbil.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tAmbil.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Diproses",
  });
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tAmbil.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Sudah diambil",
    status_sebelumnya: "Siap diambil",
  });

  const batalSudahDiambil = await api(kasir1Cookie, "PATCH", `/api/tiket/${tAmbil.id}`, {
    jenis: "batalkan",
    alasan_batal: "Mencoba membatalkan tiket yang sudah diambil",
    status_sebelumnya: "Sudah diambil",
  });
  assert.equal(batalSudahDiambil.res.status, 409);
  assert.equal(batalSudahDiambil.data?.kode_konflik, "TIDAK_DAPAT_DIBATALKAN");
});

// ---------- 6. Idempotensi (Tidak Menimbulkan Audit Ganda) ----------

test("idempoten: mengirim target status pesanan, pembayaran, atau pembatalan yang sama dua kali tidak membuat baris audit ganda", async () => {
  const tiket = await buatTiketBaru();

  async function hitungAudit() {
    const r = await admin.query(
      `SELECT COUNT(*)::int AS jml FROM audit_logs WHERE entitas = 'orders' AND entitas_id = $1`,
      [tiket.id]
    );
    return r.rows[0].jml;
  }

  const awal = await hitungAudit();
  assert.equal(awal, 1); // TAMBAH_TIKET

  // 1. Kirim ubah status ke Diproses dua kali (baik retry body identik maupun status_sebelumnya = Diproses)
  const s1 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(s1.res.status, 200);
  assert.equal(s1.data.idempoten, false);
  assert.equal(await hitungAudit(), 2);

  const s2 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(s2.res.status, 200);
  assert.equal(s2.data.idempoten, true);
  assert.equal(await hitungAudit(), 2, "audit tidak boleh bertambah saat idempoten");

  const s3 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Diproses",
  });
  assert.equal(s3.res.status, 200);
  assert.equal(s3.data.idempoten, true);
  assert.equal(await hitungAudit(), 2);

  // 2. Kirim pembayaran Lunas (Cash) dua kali
  const p1 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(p1.res.status, 200);
  assert.equal(await hitungAudit(), 3);

  const p2 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "pembayaran",
    status_bayar: "Lunas",
    metode_bayar: "Cash",
    status_sebelumnya: "Belum bayar",
  });
  assert.equal(p2.res.status, 200);
  assert.equal(p2.data.idempoten, true);
  assert.equal(await hitungAudit(), 3, "audit pembayaran tidak boleh ganda");

  // 3. Kirim pembatalan yang persis sama dua kali (retry jaringan)
  const b1 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan membatalkan via telepon",
    konfirmasi_sudah_lunas: true,
    status_sebelumnya: "Diproses",
  });
  assert.equal(b1.res.status, 200);
  assert.equal(await hitungAudit(), 4);

  const b2 = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "batalkan",
    alasan_batal: "Pelanggan membatalkan via telepon",
    konfirmasi_sudah_lunas: true,
    status_sebelumnya: "Diproses",
  });
  assert.equal(b2.res.status, 200);
  assert.equal(b2.data.idempoten, true);
  assert.equal(await hitungAudit(), 4, "audit pembatalan tidak boleh ganda");
});

// ---------- 7. Konkurensi Dua Kasir Serentak (SELECT ... FOR UPDATE) ----------

test("konkurensi: dua kasir mengubah tiket yang sama serentak — tepat satu menang (200) dan satu ditolak (409) disertai data terbaru", async () => {
  const tiket = await buatTiketBaru({ status_bayar: "Lunas", metode_bayar: "Cash" });

  // Pindahkan dulu ke Diproses supaya kedua kasir melihat status_sebelumnya = "Diproses"
  const awal = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  assert.equal(awal.res.status, 200);

  // Kasir 1 memajukan ke "Siap diambil", Kasir 2 mengoreksi mundur ke "Belum dicuci" secara serentak
  const [hasilK1, hasilK2] = await Promise.all([
    api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
      jenis: "status_pesanan",
      status_pesanan: "Siap diambil",
      status_sebelumnya: "Diproses",
    }),
    api(kasir2Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
      jenis: "status_pesanan",
      status_pesanan: "Belum dicuci",
      status_sebelumnya: "Diproses",
    }),
  ]);

  const daftarStatusHttp = [hasilK1.res.status, hasilK2.res.status].sort((a, b) => a - b);
  assert.deepEqual(
    daftarStatusHttp,
    [200, 409],
    `Harus tepat satu 200 dan satu 409, dapat ${daftarStatusHttp}`
  );

  const pemenang = hasilK1.res.status === 200 ? hasilK1 : hasilK2;
  const kalah = hasilK1.res.status === 409 ? hasilK1 : hasilK2;

  assert.ok(kalah.data?.data, "Respons 409 wajib menyertakan data tiket terbaru untuk penyegaran UI");
  assert.equal(
    kalah.data.data.status_pesanan,
    pemenang.data.data.status_pesanan,
    "Data terbaru pada respons 409 harus sama dengan hasil pemenang"
  );
});

// ---------- 8. Atomisitas Audit Satu Transaksi (Kegagalan Audit Membatalkan Perubahan) ----------

test("audit satu transaksi: kegagalan penulisan audit_logs membatalkan (rollback) perubahan pada orders", async () => {
  const tiket = await buatTiketBaru();

  // Skenario 1: panggil ubahTiket dengan user_id tidak terdaftar sehingga INSERT audit_logs gagal FK
  await assert.rejects(
    () =>
      ubahTiket(
        tiket.id,
        {
          jenis: "status_pesanan",
          status_pesanan: "Diproses",
          status_sebelumnya: "Belum dicuci",
          konfirmasi_belum_bayar: false,
        },
        999_999_999
      ),
    /foreign key|violates/i
  );

  const cek1 = await admin.query(`SELECT status_pesanan FROM orders WHERE id = $1`, [tiket.id]);
  assert.equal(
    cek1.rows[0].status_pesanan,
    "Belum dicuci",
    "Perubahan orders wajib ter-rollback ketika audit gagal FK"
  );

  // Skenario 2: uji lewat endpoint HTTP PATCH saat trigger sementara menggagalkan INSERT audit_logs
  await admin.query(`
    CREATE OR REPLACE FUNCTION public._uji_gagalkan_audit_5b()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entitas = 'orders' AND NEW.entitas_id = ${Number(tiket.id)} THEN
        RAISE EXCEPTION 'Simulasi kegagalan tulis audit_logs';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER _trg_uji_gagalkan_audit_5b
      BEFORE INSERT ON public.audit_logs
      FOR EACH ROW EXECUTE FUNCTION public._uji_gagalkan_audit_5b();
  `);

  try {
    const gagalHttp = await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
      jenis: "pembayaran",
      status_bayar: "Lunas",
      metode_bayar: "Cash",
      status_sebelumnya: "Belum bayar",
    });
    assert.equal(gagalHttp.res.status, 500);
  } finally {
    await admin.query(`
      DROP TRIGGER IF EXISTS _trg_uji_gagalkan_audit_5b ON public.audit_logs;
      DROP FUNCTION IF EXISTS public._uji_gagalkan_audit_5b();
    `);
  }

  const cek2 = await admin.query(
    `SELECT status_pesanan, status_bayar, metode_bayar, tanggal_bayar FROM orders WHERE id = $1`,
    [tiket.id]
  );
  assert.equal(cek2.rows[0].status_bayar, "Belum bayar");
  assert.equal(cek2.rows[0].metode_bayar, null);
  assert.equal(cek2.rows[0].tanggal_bayar, null);
});

// ---------- 9. Pertahanan Database Migrasi 0009 ----------

test("migrasi 0009: solemate_app ditolak UPDATE kolom permanen orders, UPDATE order_items, UPDATE tiket Dibatalkan, dan UPDATE pembayaran tak konsisten", async () => {
  const tiket = await buatTiketBaru();
  const itemRes = await admin.query(
    `SELECT id FROM order_items WHERE order_id = $1 LIMIT 1`,
    [tiket.id]
  );
  const itemId = itemRes.rows[0].id;

  // 1. Hak UPDATE pada order_items sudah dicabut dari solemate_app
  const privRes = await admin.query(
    `SELECT has_table_privilege('solemate_app', 'public.order_items', 'UPDATE') AS boleh_update`
  );
  assert.equal(privRes.rows[0].boleh_update, false);

  await assert.rejects(
    app.query(`UPDATE order_items SET jumlah = 5 WHERE id = $1`, [itemId]),
    /permission denied/i
  );

  // 2. Percobaan UPDATE kolom permanen pada orders sebagai solemate_app semuanya ditolak trigger 0009
  const percobaanKolomPermanen = [
    [`UPDATE orders SET total = 1000 WHERE id = $1`, /Kolom total/],
    [`UPDATE orders SET kode_tiket = 'SM-PALSU-999' WHERE id = $1`, /Kolom kode_tiket/],
    [`UPDATE orders SET sumber = 'wa' WHERE id = $1`, /Kolom sumber/],
    [`UPDATE orders SET dibuat_oleh = NULL WHERE id = $1`, /Kolom dibuat_oleh/],
    [`UPDATE orders SET tanggal_masuk = now() - interval '2 days' WHERE id = $1`, /Kolom tanggal_masuk/],
    [`UPDATE orders SET estimasi_selesai = now() + interval '10 days' WHERE id = $1`, /Kolom estimasi_selesai/],
  ];

  for (const [sql, polaPesan] of percobaanKolomPermanen) {
    await assert.rejects(app.query(sql, [tiket.id]), polaPesan);
  }

  // 3. Setelah siap_diambil_pada terisi, upaya mengosongkan atau menggeser langsung di SQL ditolak trigger
  await app.query(
    `UPDATE orders SET status_pesanan = 'Siap diambil', siap_diambil_pada = now() WHERE id = $1`,
    [tiket.id]
  );
  await assert.rejects(
    app.query(`UPDATE orders SET siap_diambil_pada = NULL WHERE id = $1`, [tiket.id]),
    /siap_diambil_pada tidak boleh dikosongkan atau di-reset/
  );
  await assert.rejects(
    app.query(
      `UPDATE orders SET siap_diambil_pada = now() + interval '1 hour' WHERE id = $1`,
      [tiket.id]
    ),
    /siap_diambil_pada tidak boleh dikosongkan atau di-reset/
  );

  // 4. Constraint CHECK orders_pembayaran_konsisten_check menolak pembayaran inkonsisten
  await assert.rejects(
    app.query(
      `UPDATE orders SET status_bayar = 'Lunas', metode_bayar = NULL, tanggal_bayar = now() WHERE id = $1`,
      [tiket.id]
    ),
    /orders_pembayaran_konsisten_check/
  );
  await assert.rejects(
    app.query(
      `UPDATE orders SET status_bayar = 'Lunas', metode_bayar = 'Cash', tanggal_bayar = NULL WHERE id = $1`,
      [tiket.id]
    ),
    /orders_pembayaran_konsisten_check/
  );
  await assert.rejects(
    app.query(
      `UPDATE orders SET status_bayar = 'Belum bayar', metode_bayar = 'Cash', tanggal_bayar = NULL WHERE id = $1`,
      [tiket.id]
    ),
    /orders_pembayaran_konsisten_check/
  );

  // 5. Setelah tiket Dibatalkan, UPDATE apa pun sebagai solemate_app (maupun admin) ditolak trigger
  await app.query(
    `UPDATE orders SET status_pesanan = 'Dibatalkan', alasan_batal = 'Uji proteksi trigger' WHERE id = $1`,
    [tiket.id]
  );

  await assert.rejects(
    app.query(`UPDATE orders SET status_pesanan = 'Diproses' WHERE id = $1`, [tiket.id]),
    /Dibatalkan bersifat final/
  );
  await assert.rejects(
    app.query(
      `UPDATE orders SET status_bayar = 'Lunas', metode_bayar = 'Cash', tanggal_bayar = now() WHERE id = $1`,
      [tiket.id]
    ),
    /Dibatalkan bersifat final/
  );
  await assert.rejects(
    admin.query(`UPDATE orders SET alasan_batal = 'Ubah alasan' WHERE id = $1`, [tiket.id]),
    /Dibatalkan bersifat final/
  );
});

// ---------- 10. Lencana & Filter Tiket Lama Belum Diambil di Sekitar Tengah Malam WIB ----------

test("FR-17: lencana dan filter tiket lama (>= MIN_HARI_BELUM_DIAMBIL hari) akurat di sekitar batas hari & tengah malam WIB", async () => {
  assert.equal(MIN_HARI_BELUM_DIAMBIL, 2);

  const hariIni = tanggalHariIniWib(new Date());
  const duaHariLalu = geserHariKalender(hariIni, -2);
  const satuHariLalu = geserHariKalender(hariIni, -1);

  // Buat 3 tiket uji dengan penanda kode/nama unik:
  // A: Siap diambil pada 23:59:59 WIB dua hari kalender lalu -> selisih hari kalender WIB = 2 (>= 2, LAMA!)
  // B: Siap diambil pada 00:15:00 WIB kemarin (dalam UTC masih pukul 17:15 dua hari lalu!) -> di WIB selisih = 1 (< 2, TIDAK LAMA!)
  // C: Sudah diambil meski siap_diambil_pada 5 hari lalu -> bukan status Siap diambil -> TIDAK LAMA!
  const tagUji = `UJIWIB${Date.now()}`;
  const tLama = await buatTiketBaru({ nama_pelanggan: `${tagUji} Lama Tepat Dua Hari` });
  const tBaruLewatTengahMalam = await buatTiketBaru({
    nama_pelanggan: `${tagUji} Baru Lewat Tengah Malam`,
  });
  const tSudahDiambil = await buatTiketBaru({
    nama_pelanggan: `${tagUji} Sudah Diambil Lama`,
    status_bayar: "Lunas",
    metode_bayar: "Cash",
  });

  const limaHariLalu = geserHariKalender(hariIni, -5);

  await admin.query(
    `UPDATE orders SET status_pesanan = 'Siap diambil', siap_diambil_pada = $1 WHERE id = $2`,
    [`${duaHariLalu}T23:59:59+07:00`, tLama.id]
  );
  await admin.query(
    `UPDATE orders SET status_pesanan = 'Siap diambil', siap_diambil_pada = $1 WHERE id = $2`,
    [`${satuHariLalu}T00:15:00+07:00`, tBaruLewatTengahMalam.id]
  );
  await admin.query(
    `UPDATE orders SET status_pesanan = 'Sudah diambil', siap_diambil_pada = $1 WHERE id = $2`,
    [`${limaHariLalu}T10:00:00+07:00`, tSudahDiambil.id]
  );

  // 1. Uji di sekitar pukul 00:05 WIB hari ini lewat fungsi daftarTiket (membuktikan pergantian tengah malam WIB vs UTC)
  const jamAcuanDiniHariWib = new Date(`${hariIni}T00:05:00+07:00`);
  const vSemua = validasiQueryDaftarTiket(
    new URLSearchParams({ cari: tagUji }),
    jamAcuanDiniHariWib
  );
  assert.equal(vSemua.ok, true);
  const hasilSemua = await daftarTiket(vSemua.data, jamAcuanDiniHariWib);

  const mapBaris = new Map(hasilSemua.data.map((b) => [b.id, b]));
  assert.equal(mapBaris.get(tLama.id)?.hari_belum_diambil, 2);
  assert.equal(mapBaris.get(tLama.id)?.terlambat_ambil, true);

  assert.equal(
    mapBaris.get(tBaruLewatTengahMalam.id)?.hari_belum_diambil,
    1,
    "00:15 WIB kemarin tidak boleh terhitung 2 hari walau tanggal UTC-nya masih 2 hari lalu"
  );
  assert.equal(mapBaris.get(tBaruLewatTengahMalam.id)?.terlambat_ambil, false);

  assert.equal(mapBaris.get(tSudahDiambil.id)?.hari_belum_diambil, null);
  assert.equal(mapBaris.get(tSudahDiambil.id)?.terlambat_ambil, false);

  // 2. Uji endpoint HTTP GET /api/tiket?belum_diambil=1&cari=...
  const resFilter = await api(
    kasir1Cookie,
    "GET",
    `/api/tiket?belum_diambil=1&cari=${encodeURIComponent(tagUji)}`
  );
  assert.equal(resFilter.res.status, 200);
  const idTerfilter = resFilter.data.data.map((b) => b.id);
  assert.deepEqual(
    idTerfilter,
    [tLama.id],
    "Filter belum_diambil=1 hanya boleh mengembalikan tiket Siap diambil yang >= 2 hari kalender WIB"
  );

  // Parameter belum_diambil salah format ditolak 400
  const salahFilter = await api(kasir1Cookie, "GET", `/api/tiket?belum_diambil=abc`);
  assert.equal(salahFilter.res.status, 400);
});

// ---------- 11. Tautan wa.me Sesuai Status (FR-23) ----------

test("FR-23: pesan wa.me terisi sesuai tiap status pesanan, ter-encode aman, tanpa membocorkan alasan batal internal", () => {
  const statusDaftar = [
    "Belum dicuci",
    "Diproses",
    "Siap diambil",
    "Sudah diambil",
    "Dibatalkan",
  ];

  const kumpulanPesan = new Set();
  for (const st of statusDaftar) {
    const pesan = buatPesanWaTiket({
      kodeTiket: "SM-20261107-077",
      namaPelanggan: "Sari & Budi",
      statusPesanan: st,
      statusBayar: "Belum bayar",
      totalRupiah: "Rp 35.000",
    });
    assert.ok(pesan.includes("SM-20261107-077"));
    assert.ok(pesan.includes("Sari & Budi"));
    kumpulanPesan.add(pesan);

    const url = buatUrlWaMe("081234567890", pesan);
    assert.ok(url.startsWith("https://wa.me/6281234567890?text="));
    // Karakter '&' dan spasi pada nama wajib ter-encode di query string
    assert.ok(url.includes("Sari%20%26%20Budi"));
  }

  assert.equal(
    kumpulanPesan.size,
    statusDaftar.length,
    "Setiap status pesanan harus menghasilkan pesan wa.me yang spesifik"
  );

  // Unit check validasiUbahTiket murni
  assert.equal(validasiUbahTiket(null).ok, false);
});

// ---------- 12. SSR Kasir vs Owner & Kepatuhan Ruang Lingkup PRD ----------

test("SSR /tiket dan /tiket/[id]: kontrol ubah & wa.me hanya untuk kasir; lencana tiket lama & riwayat tampil; tanpa elemen di luar PRD", async () => {
  const tagSsr = `SSR5B${Date.now()}`;
  const tiket = await buatTiketBaru({ nama_pelanggan: `${tagSsr} Pelanggan` });

  // Majukan ke Diproses -> Siap diambil supaya ada riwayat UBAH_STATUS, lalu set 3 hari lalu agar muncul lencana tiket lama
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Diproses",
    status_sebelumnya: "Belum dicuci",
  });
  await api(kasir1Cookie, "PATCH", `/api/tiket/${tiket.id}`, {
    jenis: "status_pesanan",
    status_pesanan: "Siap diambil",
    status_sebelumnya: "Diproses",
  });

  const tigaHariLalu = geserHariKalender(tanggalHariIniWib(new Date()), -3);
  // Buat juga satu tiket terpisah yang siap_diambil_pada langsung 3 hari lalu untuk verifikasi lencana SSR
  const tiketLamaSsr = await buatTiketBaru({ nama_pelanggan: `${tagSsr} TigaHari` });
  await admin.query(
    `UPDATE orders SET status_pesanan = 'Siap diambil', siap_diambil_pada = $1 WHERE id = $2`,
    [`${tigaHariLalu}T09:00:00+07:00`, tiketLamaSsr.id]
  );

  // 1. SSR Daftar Tiket (/tiket) untuk Kasir vs Owner
  const daftarKasir = await ambilHtml(
    kasir1Cookie,
    `/tiket?cari=${encodeURIComponent(tagSsr)}`
  );
  assert.equal(daftarKasir.res.status, 200);
  assert.match(daftarKasir.html, /Ubah status pesanan/);
  assert.match(daftarKasir.html, /Tandai Lunas/);
  assert.match(daftarKasir.html, /Batalkan/);
  assert.match(daftarKasir.html, /3 hari belum diambil/);
  assert.match(daftarKasir.html, /https:\/\/wa\.me\/628/);
  assert.match(daftarKasir.html, /rel="noopener noreferrer"/);

  const daftarOwner = await ambilHtml(
    ownerCookie,
    `/tiket?cari=${encodeURIComponent(tagSsr)}`
  );
  assert.equal(daftarOwner.res.status, 200);
  assert.match(daftarOwner.html, /Hanya lihat/);
  assert.match(daftarOwner.html, /3 hari belum diambil/);
  assert.doesNotMatch(daftarOwner.html, /Ubah status pesanan/);
  assert.doesNotMatch(daftarOwner.html, /Tandai Lunas/);
  assert.doesNotMatch(daftarOwner.html, /Ubah ke Belum Bayar/);
  assert.doesNotMatch(daftarOwner.html, />Batalkan</);
  assert.doesNotMatch(daftarOwner.html, /https:\/\/wa\.me\//);

  // 2. SSR Detail Tiket (/tiket/[id]) untuk Kasir vs Owner
  const detailKasir = await ambilHtml(kasir1Cookie, `/tiket/${tiket.id}`);
  assert.equal(detailKasir.res.status, 200);
  assert.match(detailKasir.html, /Kelola Status &amp; Pembayaran|Kelola Status & Pembayaran/);
  assert.match(detailKasir.html, /Batalkan Tiket/);
  assert.match(detailKasir.html, /Status pesanan diubah/);
  assert.match(detailKasir.html, /https:\/\/wa\.me\/628/);
  assert.match(detailKasir.html, /rel="noopener noreferrer"/);

  const detailOwner = await ambilHtml(ownerCookie, `/tiket/${tiket.id}`);
  assert.equal(detailOwner.res.status, 200);
  assert.match(detailOwner.html, /Hanya lihat/);
  assert.match(detailOwner.html, /Status pesanan diubah/);
  assert.doesNotMatch(detailOwner.html, /Kelola Status/);
  assert.doesNotMatch(detailOwner.html, /Batalkan Tiket/);
  assert.doesNotMatch(detailOwner.html, /https:\/\/wa\.me\//);

  // 3. Tidak ada fitur di luar PRD (cetak resi, hapus tiket, QRIS, kurir, ekspor)
  for (const html of [daftarKasir.html, daftarOwner.html, detailKasir.html, detailOwner.html]) {
    assert.doesNotMatch(html, /Cetak Resi|Hapus Tiket|QRIS|Ekspor CSV|Ekspor Excel/i);
  }
});
