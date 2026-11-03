// scripts/reset-pin.mjs — Ganti PIN akun yang sudah ada + buka kuncinya.
// PIN diminta lewat prompt tersembunyi (tidak lewat argumen, tidak ditulis ke log).
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import argon2 from "argon2";
import { cekPINValid } from "./pin-policy.mjs";

const { Pool } = pg;

// stdin bukan terminal (mis. dites lewat pipe): baca semua baris di depan.
let antrianBaris = null;
async function jawab(pertanyaan) {
  if (antrianBaris === null) {
    let data = "";
    for await (const c of stdin) data += c;
    antrianBaris = data.split(/\r?\n/);
  }
  stdout.write(pertanyaan);
  return antrianBaris.shift() ?? "";
}

let rl = null;
function tanya(pertanyaan) {
  return stdin.isTTY ? rl.question(pertanyaan) : jawab(pertanyaan);
}

function tanyaRahasia(pertanyaan) {
  if (!stdin.isTTY) return jawab(pertanyaan);
  return new Promise((resolve) => {
    rl.question(pertanyaan, (ans) => {
      stdout.write("\n");
      resolve(ans);
    });
    // Matikan echo agar tidak terlihat di layar.
    stdin.setRawMode(true);
    let buf = "";
    const onData = (ch) => {
      ch = ch.toString("utf8");
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        resolve(buf);
      } else if (ch === "\u0003") {
        // Ctrl+C
        stdin.setRawMode(false);
        process.exit(1);
      } else if (ch === "\b" || ch === "\x7f") {
        // backspace
        buf = buf.slice(0, -1);
      } else if (ch.charCodeAt(0) >= 32) {
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL belum diisi di .env");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });

  rl = createInterface({ input: stdin, output: stdout });

  console.log("=== Reset PIN Akun Solemate ===\n");
  const nama = await tanya("Nama akun: ");
  if (!nama.trim()) {
    console.error("Nama tidak boleh kosong.");
    process.exit(1);
  }

  const ada = await pool.query(`SELECT id, aktif FROM users WHERE nama = $1`, [nama.trim()]);
  if (ada.rowCount === 0) {
    console.error(`Akun "${nama.trim()}" tidak ditemukan.`);
    process.exit(1);
  }

  const pin = await tanyaRahasia("PIN baru (6 digit, tidak terlihat saat diketik): ");
  rl.close();

  if (!cekPINValid(pin)) {
    console.error("PIN harus tepat 6 digit angka.");
    process.exit(1);
  }

  const hash = await argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MiB
    timeCost: 2,
    parallelism: 1,
  });

  try {
    // Ganti PIN dan buka kunci rate-limit akun dalam satu transaksi.
    await pool.query("BEGIN");
    await pool.query(`UPDATE users SET pin_hash = $1 WHERE nama = $2`, [hash, nama.trim()]);
    await pool.query(`DELETE FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`, [
      nama.trim(),
    ]);
    await pool.query("COMMIT");
    console.log(`\nPIN akun "${nama.trim()}" sudah diganti dan kuncinya dibuka.`);
  } catch (e) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("Gagal reset PIN:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
