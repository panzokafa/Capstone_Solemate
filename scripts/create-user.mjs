// scripts/create-user.mjs — Buat akun owner atau kasir.
// PIN diminta lewat prompt interaktif (tidak terlihat di layar).
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import argon2 from "argon2";
import { cekPINValid } from "./pin-policy.mjs";

const { Pool } = pg;

// stdin bukan terminal (mis. dites lewat pipe): readline.question berurutan
// tidak andal, jadi baca semua baris di depan lalu sajikan satu per satu.
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

  console.log("=== Buat Akun Solemate ===\n");
  const nama = await tanya("Nama pengguna: ");
  if (!nama.trim()) {
    console.error("Nama tidak boleh kosong.");
    process.exit(1);
  }

  const peranInput = await tanya("Peran (owner/kasir): ");
  const peran = peranInput.trim().toLowerCase();
  if (peran !== "owner" && peran !== "kasir") {
    console.error("Peran harus 'owner' atau 'kasir'.");
    process.exit(1);
  }

  const pin = await tanyaRahasia("PIN (6 digit, tidak terlihat saat diketik): ");
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
    const r = await pool.query(
      `INSERT INTO users (nama, peran, pin_hash, aktif) VALUES ($1, $2, $3, true) RETURNING id`,
      [nama.trim(), peran, hash]
    );
    console.log(`\nAkun berhasil dibuat (ID ${r.rows[0].id}).`);
  } catch (e) {
    console.error("Gagal membuat akun:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
