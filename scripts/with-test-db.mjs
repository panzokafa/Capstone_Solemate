// Siapkan database sekali pakai `solemate_test`, lalu jalankan perintah tes.
//
// Alur: putuskan koneksi lama → drop database → create ulang → migrate up →
// (opsional) nyalakan server Next untuk tes → jalankan perintah → matikan server.
//
// DATABASE_URL tetap dipakai untuk admin; nama database diganti jadi
// solemate_test (password tidak ditulis di skrip ini).
//
// Pemakaian:
//   node --env-file=.env scripts/with-test-db.mjs <perintah> [arg...]
//   START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs <perintah> ...
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const TEST_DB = "solemate_test";
const PORT = process.env.TEST_SERVER_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;
const admin = process.env.DATABASE_URL;
if (!admin) {
  console.error("DATABASE_URL belum diisi di .env");
  process.exit(1);
}

function gantiDb(url, nama) {
  const u = new URL(url);
  u.pathname = "/" + nama;
  return u.toString();
}

const TEST_URL = gantiDb(admin, TEST_DB);
const APP_URL = process.env.DATABASE_URL_APP
  ? gantiDb(process.env.DATABASE_URL_APP, TEST_DB)
  : TEST_URL;

function apakahHostTerpakai(port, host) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    const selesai = (terpakai) => {
      sock.destroy();
      resolve(terpakai);
    };
    sock.setTimeout(300, () => selesai(false));
    sock.once("connect", () => selesai(true));
    sock.once("error", () => selesai(false));
  });
}

async function apakahPortTerpakai(port) {
  const [v4, v6] = await Promise.all([
    apakahHostTerpakai(port, "127.0.0.1"),
    apakahHostTerpakai(port, "::1"),
  ]);
  return v4 || v6;
}

async function tungguPortBebas(port, timeoutMs = 10_000) {
  const batas = Date.now() + timeoutMs;
  while (Date.now() < batas) {
    if (!(await apakahPortTerpakai(port))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !(await apakahPortTerpakai(port));
}

async function dropDanBuat() {
  const pool = new pg.Pool({ connectionString: admin });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    );
    await pool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await pool.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await pool.end();
  }
}

function jalankan(args, env) {
  const r = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
}

function kirimSinyalGrup(server, sinyal) {
  if (server.pid) {
    try {
      process.kill(-server.pid, sinyal);
      return;
    } catch {
      // Abaikan jika process group sudah tidak ada, jatuh kembali ke child langsung.
    }
  }
  try {
    server.kill(sinyal);
  } catch {
    // Abaikan jika proses sudah keluar.
  }
}

function tungguServerTutup(server, timeoutMs) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.removeListener("close", onClose);
      resolve(false);
    }, timeoutMs);
    timer.unref();
    function onClose() {
      clearTimeout(timer);
      resolve(true);
    }
    server.once("close", onClose);
  });
}

async function hentikanServer(server) {
  if (server && server.exitCode === null && server.signalCode === null) {
    const janjiTutup = tungguServerTutup(server, 10_000);
    kirimSinyalGrup(server, "SIGTERM");
    const tertutup = await janjiTutup;
    if (!tertutup && server.exitCode === null && server.signalCode === null) {
      const janjiPaksa = tungguServerTutup(server, 3_000);
      kirimSinyalGrup(server, "SIGKILL");
      await janjiPaksa;
    }
  }
  await tungguPortBebas(Number(PORT), 5_000);
}

// Server tes memakai distDir terpisah (.next-test) supaya tidak bentrok
// dengan server dev yang sedang berjalan di folder .next.
async function mulaiServer() {
  const portAngka = Number(PORT);
  const portBebas = await tungguPortBebas(portAngka, 5_000);
  if (!portBebas) {
    throw new Error(`Port ${PORT} masih digunakan proses lain sebelum server tes dinyalakan.`);
  }

  // Log server ditulis ke file supaya tes bisa memeriksa bocornya PIN.
  // Path tetap supaya proses tes bisa membacanya lewat SERVER_LOG_PATH.
  const logPath = join(tmpdir(), "solemate-test-server.log");
  const logFd = openSync(logPath, "w");
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", PORT],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        DATABASE_URL: TEST_URL,
        DATABASE_URL_APP: APP_URL,
        NEXT_DIST_DIR: ".next-test",
        // Tes membutuhkan IP dari X-Forwarded-For agar batas per-IP teruji.
        TRUST_PROXY: "true",
      },
    }
  );

  const batas = Date.now() + 90_000;
  while (Date.now() < batas) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `Server tes berhenti sebelum siap (exit=${server.exitCode}, signal=${server.signalCode}). Lihat ${logPath}`
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.status === 200) return { server, logPath };
    } catch {
      // server belum siap
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await hentikanServer(server);
  throw new Error("Server tes tidak siap dalam 90 detik");
}

await dropDanBuat();
const kodeMigrate = jalankan(
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "-m", "migrations"],
  { DATABASE_URL: TEST_URL }
);
if (kodeMigrate !== 0) process.exit(kodeMigrate);

const envTes = { DATABASE_URL: TEST_URL, DATABASE_URL_APP: APP_URL };

if (process.env.START_TEST_SERVER === "1") {
  const { server, logPath } = await mulaiServer();
  let kodeTes = 1;
  try {
    kodeTes = jalankan(process.argv.slice(2), {
      ...envTes,
      BASE_URL,
      SERVER_LOG_PATH: logPath,
    });
  } finally {
    await hentikanServer(server);
  }
  if (kodeTes !== 0) process.exit(kodeTes);
} else {
  const kodeTes = jalankan(process.argv.slice(2), envTes);
  if (kodeTes !== 0) process.exit(kodeTes);
}