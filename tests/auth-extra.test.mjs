// Tes tambahan Phase 3 yang belum ada di tests/auth.test.mjs:
//   - sesi akun nonaktif tidak berlaku lagi
//   - sesi kedaluwarsa ditolak
//   - halaman owner (bukan hanya API) menolak kasir
//   - /absensi bisa dibuka tanpa login
//   - skrip create-user menolak PIN lemah
//   - IP tidak diketahui tidak mengunci semua pengguna
//   - X-Forwarded-For diabaikan saat TRUST_PROXY=false, dipakai saat true
//
// Jalankan: npm run test:auth (server tes disiapkan oleh scripts/with-test-db.mjs)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buatAkunUji } from "./helpers/akun.mjs";
import { Pool } from "pg";
import { cekPINLemah } from "../scripts/pin-policy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const OWNER_NAMA = `Owner Extra ${Date.now()}`;
const OWNER_PIN = `6${Math.floor(Math.random() * 900000)}`;
const KASIR_NAMA = `Kasir Extra ${Date.now()}`;
const KASIR_PIN = String(Math.floor(Math.random() * 9000) + 1000);
const NONAKTIF_NAMA = `Nonaktif ${Date.now()}`;
const NONAKTIF_PIN = `5${Math.floor(Math.random() * 900000)}`;

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
    "/karyawan",
    "/laporan-harian",
    "/rekap-absensi",
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

// ---------- /absensi tanpa login ----------

test("/absensi bisa dibuka tanpa login", async () => {
  const res = await fetch(`${BASE}/absensi`, { redirect: "manual" });
  assert.equal(res.status, 200, "/absensi harus terbuka tanpa login");
  const body = await res.text();
  assert.ok(/absensi/i.test(body), "halaman harus menampilkan isi absensi");
  assert.ok(
    !(res.headers.get("location") ?? "").includes("/login"),
    "/absensi tidak boleh diarahkan ke /login"
  );
});

// ---------- PIN lemah ditolak oleh skrip create-user ----------

test("aturan PIN lemah menolak 1234, 0000, 123456, berulang, dan berurutan", () => {
  const lemah = [
    "0000",
    "111111",
    "1234",
    "123456",
    "0123",
    "9876",
    "456789",
    "6789",
  ];
  for (const pin of lemah) {
    assert.equal(cekPINLemah(pin), true, `PIN ${pin} harus dianggap lemah`);
  }
  const kuat = ["472913", "830274", "918273", "524183", "739162", "9037"];
  for (const pin of kuat) {
    assert.equal(cekPINLemah(pin), false, `PIN ${pin} seharusnya tidak lemah`);
  }
});

test("skrip create-user menolak PIN lemah dan tidak membuat akun", async () => {
  const { spawnSync } = await import("node:child_process");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const namaUji = `PIN Lemah ${Date.now()}`;
  try {
    // Skrip membaca nama, peran, lalu PIN dari stdin. DATABASE_URL diwariskan
    // dari proses tes (database solemate_test), BUKAN dari .env.
    const r = spawnSync(process.execPath, ["scripts/create-user.mjs"], {
      input: `${namaUji}\nowner\n123456\n`,
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
    const keluaran = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.notEqual(r.status, 0, "skrip harus gagal untuk PIN lemah");
    assert.ok(
      /lemah/i.test(keluaran),
      `keluaran harus menyebut PIN lemah, dapat: ${keluaran.slice(0, 400)}`
    );

    const r2 = await pool.query(
      `SELECT count(*)::int n FROM users WHERE nama = $1`,
      [namaUji]
    );
    assert.equal(r2.rows[0].n, 0, "skrip tidak boleh membuat akun saat PIN lemah");
  } finally {
    await pool.end();
  }
});

// ---------- IP tidak diketahui tidak mengunci semua pengguna ----------

test("IP tidak diketahui: batas per-IP dilewati, akun lain tidak ikut terkunci", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const akunA = `TanpaIP A ${Date.now()}`;
  const akunB = `TanpaIP B ${Date.now()}`;
  const pinA = `4${Math.floor(Math.random() * 900000)}`;
  const pinB = `3${Math.floor(Math.random() * 900000)}`;
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
