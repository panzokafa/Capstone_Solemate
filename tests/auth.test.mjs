// Tes autentikasi & otorisasi. Pakai DATABASE_URL (admin) untuk setup, tapi
// aplikasi dipakai melalui route handler yang pakai DATABASE_URL_APP (user terbatas).
//
// Jalankan: npm run test:auth
// Sebelum dijalankan: database hidup dan migrasi selesai.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buatAkunUji } from "./helpers/akun.mjs";
import { Pool } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

// Kredensial tes (acak per run). Tidak disimpan di kode.
// PIN selalu tepat 6 digit (aturan pemilik toko).
const pin6 = () => String(Math.floor(Math.random() * 900000) + 100000);
const OWNER_NAMA = `Owner Tes ${Date.now()}`;
const OWNER_PIN = pin6();
const KASIR_NAMA = `Kasir Tes ${Date.now()}`;
const KASIR_PIN = pin6();

// Ambil body JSON dari response.
async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

let ownerId;

const RATE_OWNER_NAMA = `Owner Rate ${Date.now()}`;
const RATE_OWNER_PIN = pin6();

before(async () => {
  ownerId = await buatAkunUji(OWNER_NAMA, "owner", OWNER_PIN);
  await buatAkunUji(KASIR_NAMA, "kasir", KASIR_PIN);
  await buatAkunUji(RATE_OWNER_NAMA, "owner", RATE_OWNER_PIN);
});

// ---------- Login ----------

test("login owner berhasil, menyimpan sesi, dan login ulang ubah ID sesi", async () => {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: OWNER_PIN }),
  });
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.ok, true);

  const cookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
  assert.ok(cookie.includes("httponly"), "cookie harus HttpOnly");
  assert.ok(cookie.includes("samesite=lax"), "cookie harus SameSite");

  // Cek sesi tersimpan di DB.
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(
    "SELECT id FROM sessions WHERE user_id = $1 ORDER BY dibuat_pada DESC LIMIT 1",
    [ownerId]
  );
  const sesiSebelum = r.rows[0].id;
  assert.ok(sesiSebelum);

  // Login ulang → ID sesi baru.
  await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: OWNER_PIN }),
  });
  const r2 = await pool.query(
    "SELECT id FROM sessions WHERE user_id = $1 ORDER BY dibuat_pada DESC LIMIT 1",
    [ownerId]
  );
  const sesiSesudah = r2.rows[0].id;
  assert.notEqual(sesiSebelum, sesiSesudah, "ID sesi harus berubah setelah login ulang");

  // Peran & status aktif dibaca dari users (sesi owner aktif).
  const r3 = await pool.query("SELECT peran, aktif FROM users WHERE id = $1", [ownerId]);
  assert.equal(r3.rows[0].peran, "owner");
  assert.equal(r3.rows[0].aktif, true);
  await pool.end();
});

test("login gagal: PIN salah ditolak, tidak ada PIN di body gagal", async () => {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: "000000" }),
  });
  assert.equal(res.status, 403);
  const data = await json(res);
  assert.ok(typeof data.error === "string" && data.error.length > 0);

  // Pesan seragam: tidak membedakan PIN salah vs akun tidak ada.
  const res2 = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tidak-ada", pin: "000000" }),
  });
  assert.equal(res2.status, 403);
  const data2 = await json(res2);
  assert.ok(data2.error);
});

// ---------- Audit login gagal tanpa PIN ----------

test("login gagal tidak menyimpan PIN di audit_logs", async () => {
  const pinUji = `pinrahasia${Date.now()}`;
  await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: pinUji }),
  });

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Periksa SEMUA baris audit_logs (bukan hanya milik owner) supaya terbukti
  // PIN tidak bocor ke mana pun.
  const r = await pool.query(`SELECT nilai_lama, nilai_baru FROM audit_logs`);
  const semua = JSON.stringify(r.rows);
  assert.ok(!semua.includes(OWNER_PIN), "PIN owner tidak boleh ada di audit_logs");
  assert.ok(!semua.includes(pinUji), "PIN yang dikirim tidak boleh ada di audit_logs");
  await pool.end();
});

// ---------- Rate limiting per akun ----------

test("pembatasan percobaan per akun memblokir setelah batas", async () => {
  // 5 kali salah pada akun rate-limit (terpisah dari akun utama).
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: RATE_OWNER_NAMA, pin: "000000" }),
    });
    assert.equal(res.status, 403);
  }

  // Percobaan ke-6 harus diblokir (akun terkunci), walau PIN benar.
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: RATE_OWNER_NAMA, pin: RATE_OWNER_PIN }),
  });
  assert.equal(res.status, 403);
  const data = await json(res);
  assert.ok(data.error.includes("dikunci"), `pesan: ${data.error}`);
});

test("selama akun terkunci, PIN yang benar pun ditolak", async () => {
  // Akun rate-limit masih terkunci dari tes sebelumnya.
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: RATE_OWNER_NAMA, pin: RATE_OWNER_PIN }),
  });
  assert.equal(res.status, 403);
  const data = await json(res);
  assert.ok(data.error.includes("dikunci"), `pesan: ${data.error}`);
});

test("kunci berakhir sesuai masa kunci (counter direset setelah jendela lewat)", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Simulasi jendela lewat: mundurkan window_mulai lebih dari 15 menit.
  await pool.query(
    `UPDATE login_rate_limit SET window_mulai = now() - interval '16 minutes'
     WHERE tipe = 'akun' AND kunci = $1`,
    [RATE_OWNER_NAMA]
  );
  await pool.end();

  // Setelah jendela lewat, PIN benar harus diterima lagi.
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: RATE_OWNER_NAMA, pin: RATE_OWNER_PIN }),
  });
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.ok, true);
});

test("10 percobaan serentak tidak melewati batas 5", async () => {
  // Akun baru khusus tes serentak.
  const NAMA = `Owner Serentak ${Date.now()}`;
  const PIN = pin6();
  await buatAkunUji(NAMA, "owner", PIN);

  // 10 request salah dikirim bersamaan.
  const hasil = await Promise.all(
    Array.from({ length: 10 }, () =>
      fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: NAMA, pin: "000000" }),
      }).then((r) => r.status)
    )
  );

  // Tidak ada yang lolos login (semua 403), dan counter tidak melebihi batas.
  assert.ok(hasil.every((s) => s === 403), `status: ${hasil.join(",")}`);

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(
    `SELECT gagal FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`,
    [NAMA]
  );
  const gagal = r.rows[0]?.gagal ?? 0;
  assert.ok(gagal <= 5, `counter gagal tidak boleh melebihi 5, dapat ${gagal}`);
  await pool.end();
});

// ---------- Akses route owner ----------

test("owner bisa memanggil rute owner", async () => {
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: OWNER_PIN }),
  });
  const sc = loginRes.headers.get("set-cookie") ?? "";

  const res = await fetch(`${BASE}/api/laporan-harian`, {
    headers: { Cookie: sc },
  });
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.ok, true);
  assert.equal(data.peran, "owner");
});

test("kasir ditolak di semua rute owner (halaman dan API)", async () => {
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: KASIR_NAMA, pin: KASIR_PIN }),
  });
  assert.equal(loginRes.status, 200);
  const sc = loginRes.headers.get("set-cookie") ?? "";

  // Semua rute owner harus 403 untuk kasir.
  const ruteOwner = [
    "/api/laporan-harian",
    "/api/katalog",
    "/api/karyawan",
    "/api/rekap-bulanan",
    "/api/rekap-absensi",
  ];
  for (const r of ruteOwner) {
    const res = await fetch(`${BASE}${r}`, { headers: { Cookie: sc } });
    assert.equal(res.status, 403, `rute ${r} harus 403 untuk kasir`);
  }

  // Rute kasir-only (buat-tiket) diterima kasir, ditolak owner.
  const kasirRes = await fetch(`${BASE}/api/buat-tiket`, {
    method: "POST",
    headers: { Cookie: sc },
  });
  assert.equal(kasirRes.status, 200);

  const ownerLogin = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: OWNER_PIN }),
  });
  const scOwner = ownerLogin.headers.get("set-cookie") ?? "";
  const ownerAtKasir = await fetch(`${BASE}/api/buat-tiket`, {
    method: "POST",
    headers: { Cookie: scOwner },
  });
  assert.equal(ownerAtKasir.status, 403, "owner harus 403 di rute kasir");
});

// ---------- Logout ----------

test("logout menghapus sesi dan cookie", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [ownerId]);

  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: OWNER_PIN }),
  });
  const sc = loginRes.headers.get("set-cookie") ?? "";

  const sebelum = await pool.query(
    `SELECT count(*)::int n FROM sessions WHERE user_id = $1`,
    [ownerId]
  );
  assert.equal(sebelum.rows[0].n, 1);

  const logoutRes = await fetch(`${BASE}/api/logout`, {
    method: "POST",
    headers: { Cookie: sc },
  });
  assert.equal(logoutRes.status, 200);

  const setelah = await pool.query(
    `SELECT count(*)::int n FROM sessions WHERE user_id = $1`,
    [ownerId]
  );
  assert.equal(setelah.rows[0].n, 0);
  await pool.end();
});

// ---------- User database terbatas ----------

test("user solemate_app ditolak DELETE orders dan TRUNCATE orders", async () => {
  const appPool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Hak akses eksplisit via katalog sistem (bukan lewat pesan error).
  const priv = await appPool.query(
    `SELECT has_table_privilege('solemate_app','orders','DELETE') AS del,
            has_table_privilege('solemate_app','orders','TRUNCATE') AS trunc,
            has_table_privilege('solemate_app','audit_logs','UPDATE') AS aud_upd,
            has_table_privilege('solemate_app','audit_logs','DELETE') AS aud_del,
            has_table_privilege('solemate_app','audit_logs','TRUNCATE') AS aud_trunc`
  );
  const p = priv.rows[0];
  assert.equal(p.del, false, "solemate_app tidak boleh punya DELETE di orders");
  assert.equal(p.trunc, false, "solemate_app tidak boleh punya TRUNCATE di orders");
  assert.equal(p.aud_upd, false, "solemate_app tidak boleh punya UPDATE di audit_logs");
  assert.equal(p.aud_del, false, "solemate_app tidak boleh punya DELETE di audit_logs");
  assert.equal(p.aud_trunc, false, "solemate_app tidak boleh punya TRUNCATE di audit_logs");

  // Percobaan nyata sebagai solemate_app: errornya harus permission denied,
  // bukan pesan trigger (trigger hanya pengaman tambahan).
  await assert.rejects(
    () => appPool.query("DELETE FROM orders"),
    /permission denied/
  );
  await assert.rejects(
    () => appPool.query("TRUNCATE orders"),
    /permission denied/
  );

  await adminPool.end();
  await appPool.end();
});

test("user solemate_app ditolak UPDATE dan DELETE audit_logs", async () => {
  const appPool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi) VALUES ('test', 1, 'uji') RETURNING id`
  );

  await assert.rejects(
    () => appPool.query("UPDATE audit_logs SET aksi = 'x' WHERE entitas = 'test'"),
    /permission denied|hanya bisa ditambah/
  );
  await assert.rejects(
    () => appPool.query("DELETE FROM audit_logs WHERE entitas = 'test'"),
    /permission denied|hanya bisa ditambah/
  );

  const ins = await appPool.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi) VALUES ('test', 1, 'insert-ok') RETURNING id`
  );
  assert.equal(ins.rowCount, 1);
  await adminPool.end();
  await appPool.end();
});

// ---------- Tanpa sesi diarahkan ke Login ----------

test("tanpa sesi, halaman dan API mengarahkan ke Login", async () => {
  // Halaman terlindungi: redirect (307/302) ke /login.
  for (const rute of ["/", "/tiket", "/katalog", "/laporan-harian"]) {
    const res = await fetch(`${BASE}${rute}`, { redirect: "manual" });
    assert.ok(
      res.status === 302 || res.status === 307,
      `halaman ${rute} harus redirect, dapat ${res.status}`
    );
    assert.ok(
      (res.headers.get("location") ?? "").includes("/login"),
      `halaman ${rute} harus redirect ke /login`
    );
  }

  // API terlindungi: tanpa sesi harus ditolak (401/403) atau redirect ke login.
  // buat-tiket hanya menerima POST, jadi kirim POST.
  for (const [rute, metode] of [
    ["/api/laporan-harian", "GET"],
    ["/api/katalog", "GET"],
    ["/api/buat-tiket", "POST"],
  ]) {
    const res = await fetch(`${BASE}${rute}`, { method: metode, redirect: "manual" });
    assert.ok(
      res.status === 401 || res.status === 403 || res.status === 302 || res.status === 307,
      `API ${rute} tanpa sesi harus ditolak, dapat ${res.status}`
    );
  }
});

// ---------- PIN tidak bocor ke log aplikasi ----------

test("PIN uji acak tidak muncul di file log server dan audit_logs", async () => {
  const logPath = process.env.SERVER_LOG_PATH;
  assert.ok(logPath, "SERVER_LOG_PATH harus diisi oleh runner tes");

  const pinUnik = `pinlog${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: OWNER_NAMA, pin: pinUnik }),
  });

  const { readFileSync } = await import("node:fs");
  const log = readFileSync(logPath, "utf8");
  assert.ok(!log.includes(pinUnik), "PIN tidak boleh muncul di log server");

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query("SELECT nilai_lama, nilai_baru FROM audit_logs");
  assert.ok(
    !JSON.stringify(r.rows).includes(pinUnik),
    "PIN tidak boleh muncul di audit_logs"
  );
  await pool.end();
});

// ---------- Batas audit per IP dan per akun (bukan global) ----------

test("batas pencatatan audit dihitung per IP dan per akun, bukan global", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Kosongkan hitungan rate-limit akun uji agar tiap kombinasi mulai dari nol.
  const akunA = `AuditA ${Date.now()}`;
  const akunB = `AuditB ${Date.now()}`;
  const ip1 = `10.0.0.${Math.floor(Math.random() * 250) + 1}`;
  const ip2 = `10.9.9.${Math.floor(Math.random() * 250) + 1}`;

  // Kirim AUDIT_GAGAL_PER_JENDELA + beberapa percobaan untuk akun A dari IP1.
  // Lewat X-Forwarded-For (server tes TRUST_PROXY=true) → IP terbedakan.
  const N = 25;
  for (let i = 0; i < N; i++) {
    await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip1 },
      body: JSON.stringify({ username: akunA, pin: "000000" }),
    });
  }

  // Akun A / IP1: jumlah baris 'login_gagal' dibatasi (<= batas per jendela),
  // dan ada satu baris ringkasan.
  const a1 = await pool.query(
    `SELECT
       count(*) FILTER (WHERE aksi='login_gagal')::int AS gagal,
       count(*) FILTER (WHERE aksi='login_gagal_ringkasan')::int AS ringkasan
     FROM audit_logs
     WHERE nilai_baru->>'akun' = $1 AND nilai_baru->>'ip' = $2`,
    [akunA, ip1]
  );
  assert.ok(a1.rows[0].gagal <= 20, `baris login_gagal akunA/ip1 = ${a1.rows[0].gagal}`);
  assert.equal(a1.rows[0].ringkasan, 1, "harus ada tepat satu baris ringkasan akunA/ip1");

  // Akun B dari IP1: batasnya terpisah per AKUN — tetap tercatat penuh,
  // meski akunA sudah mentok. (Kalau batas global, ini akan 0.)
  await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip1 },
    body: JSON.stringify({ username: akunB, pin: "000000" }),
  });
  const b = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE nilai_baru->>'akun' = $1 AND nilai_baru->>'ip' = $2 AND aksi='login_gagal'`,
    [akunB, ip1]
  );
  assert.ok(b.rows[0].n >= 1, "akun B harus punya catatan audit sendiri (bukan global)");

  // Akun A dari IP2: batasnya terpisah per IP.
  await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip2 },
    body: JSON.stringify({ username: akunA, pin: "000000" }),
  });
  const a2 = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE nilai_baru->>'akun' = $1 AND nilai_baru->>'ip' = $2 AND aksi='login_gagal'`,
    [akunA, ip2]
  );
  assert.ok(a2.rows[0].n >= 1, "akun A dari IP2 harus tercatat (batas per IP terpisah)");

  await pool.end();
});
