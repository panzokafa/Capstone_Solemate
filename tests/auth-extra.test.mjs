// Tes tambahan Phase 3 yang belum ada di tests/auth.test.mjs:
//   - sesi akun nonaktif tidak berlaku lagi
//   - sesi kedaluwarsa ditolak
//   - halaman owner (bukan hanya API) menolak kasir
//   - /absensi membalas 404 untuk semua pengunjung (owner, kasir, anonim); /karyawan & /rekap-absensi 404 identik untuk owner & kasir, anonim -> /login
//   - sidebar dan halaman aktif tidak memuat kata Karyawan atau Absensi
//   - aturan PIN baru: tepat 6 digit (000000 diterima; 5/7 digit dan huruf ditolak)
//   - skrip create-user dan reset-pin menolak PIN bukan 6 digit
//   - form login tidak mengirim sebelum 6 digit
//   - IP tidak diketahui tidak mengunci semua pengguna
//   - X-Forwarded-For diabaikan saat TRUST_PROXY=false, dipakai saat true
//
// Jalankan: npm run test:auth (server tes disiapkan oleh scripts/with-test-db.mjs)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buatAkunUji } from "./helpers/akun.mjs";
import { Pool } from "pg";
import { cekPINValid } from "../scripts/pin-policy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner Extra ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_NAMA = `Kasir Extra ${Date.now()}`;
const KASIR_PIN = pin6();
const NONAKTIF_NAMA = `Nonaktif ${Date.now()}`;
const NONAKTIF_PIN = pin6();

let nonaktifId;

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function login(username, pin, headers = {}) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username, pin }),
  });
  return { res, cookie: res.headers.get("set-cookie") ?? "" };
}

// ID sesi dari header Set-Cookie.
function sesiDariCookie(cookie) {
  const c = cookie.split(";")[0];
  return decodeURIComponent(c.slice(c.indexOf("=") + 1));
}

before(async () => {
  await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);
  nonaktifId = await buatAkunUji(NONAKTIF_NAMA, "owner", NONAKTIF_PIN);
});

// ---------- Sesi akun nonaktif tidak berlaku lagi ----------

test("sesi akun yang dinonaktifkan tidak berlaku lagi (halaman & API)", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { res: loginRes, cookie } = await login(NONAKTIF_NAMA, NONAKTIF_PIN);
    assert.equal(loginRes.status, 200, "login awal harus berhasil");

    // Sebelum dinonaktifkan, halaman terlindungi terbuka.
    const sebelum = await fetch(`${BASE}/tiket`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.notEqual(sebelum.status, 302, "sesi aktif harus bisa membuka /tiket");

    await pool.query(`UPDATE users SET aktif = false WHERE id = $1`, [nonaktifId]);

    // Halaman owner harus menolak (redirect login atau tampil "Akses ditolak").
    const halaman = await fetch(`${BASE}/katalog`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [302, 307, 403].includes(halaman.status) ||
        (halaman.status === 200 && /akses ditolak/i.test(await halaman.text())),
      `halaman owner harus menolak sesi nonaktif, dapat ${halaman.status}`
    );

    // API owner juga ditolak.
    const api = await fetch(`${BASE}/api/katalog`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [401, 403, 302, 307].includes(api.status),
      `API owner harus menolak sesi nonaktif, dapat ${api.status}`
    );

    // Halaman requireAuth biasa juga ditolak.
    const tiket = await fetch(`${BASE}/tiket`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [302, 307, 403].includes(tiket.status),
      `halaman /tiket harus menolak sesi nonaktif, dapat ${tiket.status}`
    );
  } finally {
    await pool.query(`UPDATE users SET aktif = true WHERE id = $1`, [nonaktifId]);
    await pool.end();
  }
});

test("akun nonaktif tidak bisa login dan pesannya tidak membocorkan status", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`UPDATE users SET aktif = false WHERE id = $1`, [nonaktifId]);
  try {
    const { res } = await login(NONAKTIF_NAMA, NONAKTIF_PIN);
    assert.equal(res.status, 403, "akun nonaktif harus ditolak");
    const data = await json(res);
    assert.ok(
      !/nonaktif|non-aktif/i.test(data.error ?? ""),
      `pesan tidak boleh bocor status akun: ${data.error}`
    );
  } finally {
    await pool.query(`UPDATE users SET aktif = true WHERE id = $1`, [nonaktifId]);
    await pool.end();
  }
});

// ---------- Sesi kedaluwarsa ditolak ----------

test("sesi kedaluwarsa ditolak (kedaluwarsa_pada di masa lalu)", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { res: loginRes, cookie } = await login(OWNER_NAMA, OWNER_PIN);
  assert.equal(loginRes.status, 200);
  const sesiId = sesiDariCookie(cookie);
  assert.ok(sesiId, "cookie harus membawa ID sesi");

  // Mundurkan masa berlaku 9 jam (TTL normal 8 jam).
  await pool.query(
    `UPDATE sessions SET kedaluwarsa_pada = now() - interval '9 hours' WHERE id = $1`,
    [sesiId]
  );
  try {
    const halaman = await fetch(`${BASE}/tiket`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [302, 307].includes(halaman.status),
      `sesi kedaluwarsa harus redirect ke login, dapat ${halaman.status}`
    );
    assert.ok(
      (halaman.headers.get("location") ?? "").includes("/login"),
      "halaman harus diarahkan ke /login"
    );

    const api = await fetch(`${BASE}/api/katalog`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [401, 403, 302, 307].includes(api.status),
      `API harus menolak sesi kedaluwarsa, dapat ${api.status}`
    );
  } finally {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sesiId]);
    await pool.end();
  }
});

test("sesi yang belum kedaluwarsa (8 jam) masih berlaku", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { res: loginRes, cookie } = await login(OWNER_NAMA, OWNER_PIN);
  assert.equal(loginRes.status, 200);
  const sesiId = sesiDariCookie(cookie);

  // 7 jam 59 menit ke depan → masih valid.
  await pool.query(
    `UPDATE sessions SET kedaluwarsa_pada = now() + interval '7 hours 59 minutes'
      WHERE id = $1`,
    [sesiId]
  );
  try {
    const res = await fetch(`${BASE}/api/katalog`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.equal(res.status, 200, "sesi yang belum kedaluwarsa harus diterima");
  } finally {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sesiId]);
    await pool.end();
  }
});

// ---------- Halaman owner menolak kasir (bukan hanya API) ----------

test("kasir ditolak di HALAMAN owner, bukan hanya API", async () => {
  const { res: loginRes, cookie } = await login(KASIR_NAMA, KASIR_PIN);
  assert.equal(loginRes.status, 200);

  const halamanOwner = [
    "/katalog",
    "/laporan-harian",
    "/rekap-bulanan",
  ];
  for (const rute of halamanOwner) {
    const res = await fetch(`${BASE}${rute}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.ok(
      [200, 403, 302, 307].includes(res.status),
      `halaman ${rute} untuk kasir harus ditolak/redirect, dapat ${res.status}`
    );
    // Halaman owner yang benar-benar tampil untuk kasir = bocor. Halaman harus
    // menampilkan penolakan (atau redirect).
    if (res.status === 200) {
      const body = await res.text();
      assert.ok(
        /akses ditolak/i.test(body),
        `halaman ${rute} untuk kasir harus menampilkan "Akses ditolak"`
      );
    }
  }

  // Kasir tetap boleh buka halaman kasir.
  const tiket = await fetch(`${BASE}/tiket`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.notEqual(tiket.status, 302, "kasir harus bisa buka /tiket");
});

// ---------- Phase 8A: Fitur Karyawan & Absensi disembunyikan (KARYAWAN_ABSENSI_AKTIF = false) ----------

// Pola deteksi teks/href terlarang pada HTML tanpa memicu positif palsu dari kata lain (mis. "dibuat_oleh", peran "Kasir"/"Owner").
const POLA_KARYAWAN_ABSENSI_HTML =
  /\bkaryawan\b|\babsen(?:si)?\b|\/(?:karyawan|absensi|rekap-absensi)\b/i;

function bersihkanScriptStyle(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

// Next.js dev menyisipkan request ID acak pada <script id="_R_">self.__next_r="..."</script>
// serta jejak stack async di <template data-next-error-stack="...">; normalisasi hanya bagian runtime acak tersebut.
function normalisasiHtml404Next(html) {
  return html
    .replace(/self\.__next_r="[^"]+"/g, 'self.__next_r="__REQ_ID__"')
    .replace(/data-next-error-stack="[^"]*"/g, 'data-next-error-stack="__STACK__"');
}

test("/absensi membalas 404 untuk semua pengunjung termasuk anonim (tanpa redirect /login)", async () => {
  const { cookie: ownerCookie } = await login(OWNER_NAMA, OWNER_PIN);
  const { cookie: kasirCookie } = await login(KASIR_NAMA, KASIR_PIN);

  const resAnon = await fetch(`${BASE}/absensi`, { redirect: "manual" });
  const resOwner = await fetch(`${BASE}/absensi`, {
    headers: { Cookie: ownerCookie },
    redirect: "manual",
  });
  const resKasir = await fetch(`${BASE}/absensi`, {
    headers: { Cookie: kasirCookie },
    redirect: "manual",
  });

  assert.equal(resAnon.status, 404, "anonim di /absensi harus mendapat HTTP 404");
  assert.equal(resOwner.status, 404, "owner di /absensi harus mendapat HTTP 404");
  assert.equal(resKasir.status, 404, "kasir di /absensi harus mendapat HTTP 404");
  assert.equal(resAnon.headers.get("location"), null, "/absensi anonim tidak boleh redirect ke /login");

  const bodyAnon = await resAnon.text();
  const bodyOwner = await resOwner.text();
  const bodyKasir = await resKasir.text();
  assert.equal(
    normalisasiHtml404Next(bodyOwner),
    normalisasiHtml404Next(bodyKasir),
    "respons 404 /absensi owner dan kasir harus identik"
  );
  assert.equal(
    normalisasiHtml404Next(bodyAnon),
    normalisasiHtml404Next(bodyOwner),
    "respons 404 /absensi anonim dan owner harus identik"
  );
  assert.doesNotMatch(bodyOwner, /Absensi Karyawan|Clock-in|Akses ditolak/i);
});

test("/karyawan, /rekap-absensi, /api/karyawan, /api/rekap-absensi: 404 identik untuk owner & kasir; anonim 307 ke /login", async () => {
  const { cookie: ownerCookie } = await login(OWNER_NAMA, OWNER_PIN);
  const { cookie: kasirCookie } = await login(KASIR_NAMA, KASIR_PIN);

  for (const rute of ["/karyawan", "/rekap-absensi", "/api/karyawan", "/api/rekap-absensi"]) {
    const resAnon = await fetch(`${BASE}${rute}`, { redirect: "manual" });
    assert.ok(
      resAnon.status === 307 || resAnon.status === 302,
      `anonim di ${rute} harus diarahkan ke /login, dapat ${resAnon.status}`
    );
    assert.ok(
      (resAnon.headers.get("location") ?? "").includes("/login"),
      `anonim di ${rute} harus mengarah ke /login`
    );

    const resOwner = await fetch(`${BASE}${rute}`, {
      headers: { Cookie: ownerCookie },
      redirect: "manual",
    });
    const resKasir = await fetch(`${BASE}${rute}`, {
      headers: { Cookie: kasirCookie },
      redirect: "manual",
    });
    assert.equal(resOwner.status, 404, `owner di ${rute} harus HTTP 404 asli, dapat ${resOwner.status}`);
    assert.equal(resKasir.status, 404, `kasir di ${rute} harus HTTP 404 asli, dapat ${resKasir.status}`);

    const bodyOwner = await resOwner.text();
    const bodyKasir = await resKasir.text();
    assert.doesNotMatch(bodyOwner, /Akses ditolak/i, `${rute} owner tidak boleh berisi Akses ditolak`);
    assert.doesNotMatch(bodyKasir, /Akses ditolak/i, `${rute} kasir tidak boleh berisi Akses ditolak`);
    assert.equal(
      rute.startsWith("/api/") ? bodyOwner : normalisasiHtml404Next(bodyOwner),
      rute.startsWith("/api/") ? bodyKasir : normalisasiHtml404Next(bodyKasir),
      `respons 404 ${rute} untuk owner dan kasir harus identik`
    );
  }
});

test("sidebar dan halaman utama ter-render untuk owner, kasir, dan login tidak memuat Karyawan atau Absensi", async () => {
  const { cookie: ownerCookie } = await login(OWNER_NAMA, OWNER_PIN);
  const { cookie: kasirCookie } = await login(KASIR_NAMA, KASIR_PIN);

  const ujiOwner = ["/", "/tiket", "/laporan-harian", "/rekap-bulanan", "/katalog"];
  for (const rute of ujiOwner) {
    const res = await fetch(`${BASE}${rute}`, { headers: { Cookie: ownerCookie } });
    assert.equal(res.status, 200, `owner harus bisa buka ${rute}`);
    const html = bersihkanScriptStyle(await res.text());
    assert.doesNotMatch(
      html,
      POLA_KARYAWAN_ABSENSI_HTML,
      `halaman owner ${rute} (termasuk sidebar) tidak boleh memuat kata Karyawan/Absensi`
    );
  }

  const ujiKasir = ["/", "/tiket", "/buat-tiket"];
  for (const rute of ujiKasir) {
    const res = await fetch(`${BASE}${rute}`, { headers: { Cookie: kasirCookie } });
    assert.equal(res.status, 200, `kasir harus bisa buka ${rute}`);
    const html = bersihkanScriptStyle(await res.text());
    assert.doesNotMatch(
      html,
      POLA_KARYAWAN_ABSENSI_HTML,
      `halaman kasir ${rute} (termasuk sidebar) tidak boleh memuat kata Karyawan/Absensi`
    );
  }

  const resLogin = await fetch(`${BASE}/login`);
  assert.equal(resLogin.status, 200);
  const htmlLogin = bersihkanScriptStyle(await resLogin.text());
  assert.doesNotMatch(
    htmlLogin,
    POLA_KARYAWAN_ABSENSI_HTML,
    "halaman /login tidak boleh memuat tautan atau teks Absen Karyawan"
  );
});

// ---------- Aturan PIN baru: tepat 6 digit angka (keputusan pemilik toko) ----------

test("aturan PIN: 000000 diterima; 5/7 digit dan huruf ditolak", () => {
  // Kekuatan bebas — 000000, 123456, angka berulang/berurutan sah (keputusan pemilik).
  for (const pin of ["000000", "123456", "111111", "654321", "888888"]) {
    assert.equal(cekPINValid(pin), true, `PIN ${pin} harus diterima (6 digit)`);
  }
  // Panjang salah dan non-digit ditolak.
  for (const pin of ["12345", "1234567", "", "12345a", "abcdef", "12345678", "1234"]) {
    assert.equal(cekPINValid(pin), false, `PIN "${pin}" harus ditolak`);
  }
});

test("API menolak PIN yang bukan tepat 6 digit angka", async () => {
  const { res: loginRes } = await login(OWNER_NAMA, OWNER_PIN);
  assert.equal(loginRes.status, 200);

  for (const pin of ["12345", "1234567", "12345a"]) {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: OWNER_NAMA, pin }),
    });
    assert.equal(res.status, 400, `PIN "${pin}" harus ditolak server (400)`);
    const data = await json(res);
    assert.ok(/6 digit/i.test(data.error ?? ""), `pesan: ${data.error}`);
  }
});

test("skrip create-user menolak PIN bukan 6 digit dan tidak membuat akun", async () => {
  const { spawnSync } = await import("node:child_process");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const pinUji of ["12345", "1234567", "abcdef"]) {
    const namaUji = `PIN Panjang ${Date.now()} ${pinUji}`;
    // Skrip membaca nama, peran, lalu PIN dari stdin. DATABASE_URL diwariskan
    // dari proses tes (database solemate_test), BUKAN dari .env.
    const r = spawnSync(process.execPath, ["scripts/create-user.mjs"], {
      input: `${namaUji}\nowner\n${pinUji}\n`,
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
    const keluaran = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.notEqual(r.status, 0, `skrip harus gagal untuk PIN "${pinUji}"`);
    assert.ok(
      /6 digit/i.test(keluaran),
      `keluaran harus menyebut 6 digit, dapat: ${keluaran.slice(0, 400)}`
    );

    const r2 = await pool.query(
      `SELECT count(*)::int n FROM users WHERE nama = $1`,
      [namaUji]
    );
    assert.equal(r2.rows[0].n, 0, "skrip tidak boleh membuat akun saat PIN invalid");
  }
  await pool.end();
});

test("skrip create-user menerima PIN 000000 dan membuat akun", async () => {
  const { spawnSync } = await import("node:child_process");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const namaUji = `PIN Nol ${Date.now()}`;
  try {
    const r = spawnSync(process.execPath, ["scripts/create-user.mjs"], {
      input: `${namaUji}\nkasir\n000000\n`,
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
    assert.equal(r.status, 0, `skrip harus sukses, keluaran: ${(r.stdout ?? "") + (r.stderr ?? "")}`);
    const r2 = await pool.query(
      `SELECT count(*)::int n FROM users WHERE nama = $1`,
      [namaUji]
    );
    assert.equal(r2.rows[0].n, 1, "akun dengan PIN 000000 harus terbuat");
  } finally {
    await pool.end();
  }
});

// ---------- Form login tidak mengirim sebelum 6 digit ----------

test("form login tidak mengirim sebelum 6 digit terisi", async () => {
  // Uji logika form di level kode: batas pin di login-form harus 6 digit,
  // tidak ada pengiriman otomatis saat digit ke-4. Dipastikan lewat sumber:
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/app/login/login-form.tsx", "utf8");

  // Tidak ada pemanggilan kirim otomatis di dalam tekan().
  const bagianTekan = src.slice(src.indexOf("function tekan"), src.indexOf("// Keyboard"));
  assert.ok(
    !bagianTekan.includes("kirim"),
    "tekan() tidak boleh memanggil kirim() (pengiriman hanya via tombol/Enter)"
  );
  // Tombol Masuk hanya aktif saat tepat 6 digit.
  assert.ok(
    src.includes("pin.length !== 6") || src.includes("pin.length !==6"),
    "tombol Masuk harus disabled sampai tepat 6 digit"
  );
  // Enter hanya mengirim saat 6 digit.
  assert.ok(
    src.includes("pin.length === 6"),
    "Enter hanya boleh mengirim saat PIN 6 digit"
  );
  // Tampilan 6 titik, bukan 8.
  assert.ok(
    src.includes("Array.from({ length: 6 })"),
    "PIN display harus 6 titik"
  );
});

// ---------- Skrip reset-pin: ganti PIN + buka kunci ----------

test("skrip reset-pin mengganti PIN dan membuka kunci akun", async () => {
  const { spawnSync } = await import("node:child_process");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const namaUji = `Reset Pin ${Date.now()}`;
  const pinLama = pin6();
  const pinBaru = pin6();
  try {
    await buatAkunUji(namaUji, "kasir", pinLama);

    // Kunci akunnya dulu: 5 percobaan salah.
    for (let i = 0; i < 5; i++) {
      await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: namaUji, pin: "000000" }),
      });
    }
    const terkunci = await pool.query(
      `SELECT 1 FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`,
      [namaUji]
    );
    assert.ok(terkunci.rowCount === 1, "akun harus terkunci dulu sebelum reset");

    // PIN lama ditolak (akun terkunci).
    const resLama = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: namaUji, pin: pinLama }),
    });
    assert.equal(resLama.status, 403, "akun terkunci harus ditolak");

    // Jalankan reset-pin lewat stdin pipe.
    const r = spawnSync(process.execPath, ["scripts/reset-pin.mjs"], {
      input: `${namaUji}\n${pinBaru}\n`,
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
    const keluaran = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(r.status, 0, `skrip harus sukses, keluaran: ${keluaran.slice(0, 400)}`);

    // Kunci terbuka.
    const kunci = await pool.query(
      `SELECT count(*)::int n FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`,
      [namaUji]
    );
    assert.equal(kunci.rows[0].n, 0, "kunci rate-limit harus terhapus");

    // PIN baru diterima, PIN lama ditolak.
    const resBaru = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: namaUji, pin: pinBaru }),
    });
    assert.equal(resBaru.status, 200, "PIN baru harus bisa login");

    const resLama2 = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: namaUji, pin: pinLama }),
    });
    assert.equal(resLama2.status, 403, "PIN lama harus ditolak setelah reset");

    // PIN tidak boleh bocor ke keluaran skrip.
    assert.ok(
      !keluaran.includes(pinBaru) && !keluaran.includes(pinLama),
      "PIN tidak boleh muncul di keluaran skrip"
    );
  } finally {
    await pool.end();
  }
});

// ---------- IP tidak diketahui tidak mengunci semua pengguna ----------

test("IP tidak diketahui: batas per-IP dilewati, akun lain tidak ikut terkunci", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const akunA = `TanpaIP A ${Date.now()}`;
  const akunB = `TanpaIP B ${Date.now()}`;
  const pinA = pin6();
  const pinB = pin6();
  await buatAkunUji(akunA, "owner", pinA);
  await buatAkunUji(akunB, "owner", pinB);
  try {
    // Server tes TRUST_PROXY=true. Tanpa header XFF → ambilIp = null.
    // 6 percobaan salah untuk akun A tanpa IP.
    for (let i = 0; i < 6; i++) {
      await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: akunA, pin: "000000" }),
      });
    }

    const { res: resA } = await login(akunA, pinA);
    assert.equal(resA.status, 403, "akun A harus terkunci (batas per-akun)");

    // Akun B tanpa IP harus tetap bisa login. Kalau IP tak dikenal dipakai
    // sebagai satu keranjang bersama, B ikut terkunci.
    const { res: resB } = await login(akunB, pinB);
    assert.equal(resB.status, 200, `akun B harus tetap bisa login, dapat ${resB.status}`);

    // Tidak boleh ada kunci IP kosong di database.
    const kosong = await pool.query(
      `SELECT count(*)::int n FROM login_rate_limit WHERE tipe = 'ip' AND kunci = ''`
    );
    assert.equal(kosong.rows[0].n, 0, "IP tak dikenal tidak boleh jadi kunci kosong");
  } finally {
    await pool.end();
  }
});

// ---------- X-Forwarded-For: hanya dipercaya saat TRUST_PROXY=true ----------

test("X-Forwarded-For diabaikan saat TRUST_PROXY=false dan dipakai saat true", async () => {
  const { ambilIp } = await import("../src/lib/ip.ts");
  const xff = "203.0.113.7, 10.0.0.1";

  const lama = process.env.TRUST_PROXY;
  try {
    process.env.TRUST_PROXY = "false";
    const reqOff = new Request("http://x/", { headers: { "x-forwarded-for": xff } });
    assert.equal(ambilIp(reqOff), null, "XFF harus diabaikan saat TRUST_PROXY=false");

    process.env.TRUST_PROXY = "true";
    const reqOn = new Request("http://x/", { headers: { "x-forwarded-for": xff } });
    assert.equal(ambilIp(reqOn), "203.0.113.7", "entri pertama XFF dipakai saat true");

    // Tanpa header: tetap null walau TRUST_PROXY=true.
    assert.equal(ambilIp(new Request("http://x/")), null);
  } finally {
    if (lama === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = lama;
  }
});
