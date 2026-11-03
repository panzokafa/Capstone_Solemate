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
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Server tes memakai distDir terpisah (.next-test) supaya tidak bentrok
// dengan server dev yang sedang berjalan di folder .next.
async function mulaiServer() {
  // Log server ditulis ke file supaya tes bisa memeriksa bocornya PIN.
  // Path tetap supaya proses tes bisa membacanya lewat SERVER_LOG_PATH.
  const logPath = join(tmpdir(), "solemate-test-server.log");
  const logFd = openSync(logPath, "w");
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", PORT],
    {
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
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.status === 200) return { server, logPath };
    } catch {
      // server belum siap
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.kill("SIGKILL");
  throw new Error("Server tes tidak siap dalam 90 detik");
}

await dropDanBuat();
jalankan(
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "-m", "migrations"],
  { DATABASE_URL: TEST_URL }
);

const envTes = { DATABASE_URL: TEST_URL, DATABASE_URL_APP: APP_URL };

if (process.env.START_TEST_SERVER === "1") {
  const { server, logPath } = await mulaiServer();
  try {
    jalankan(process.argv.slice(2), { ...envTes, BASE_URL, SERVER_LOG_PATH: logPath });
  } finally {
    server.kill("SIGTERM");
  }
} else {
  jalankan(process.argv.slice(2), envTes);
}