// Logika login: verifikasi PIN, pembatasan percobaan (atomik, dari database), audit.
import argon2 from "argon2";
import { getPool } from "./db";
import {
  LOGIN_MAX_PER_AKUN,
  LOGIN_WINDOW_PER_AKUN,
  LOGIN_MAX_PER_IP,
  LOGIN_WINDOW_PER_IP,
  AUDIT_GAGAL_PER_JENDELA,
  AUDIT_GAGAL_JENDELA,
} from "@/config/auth";

export type HasilLogin =
  | { ok: true; userId: number; peran: "owner" | "kasir" }
  | { ok: false; alasan: "kunci_akun" | "kunci_ip" | "gagal" };

// Pesan seragam untuk semua kegagalan (tidak membedakan akun nonaktif/PIN salah).
export const PESAN_GAGAL = "PIN tidak sesuai, coba lagi.";

// Naikkan counter gagal secara atomik (satu perintah SQL, tanpa race),
// dibatasi agar tidak melewati `maks`. Jendela lewat → reset ke 1.
async function naikkanGagal(
  tipe: "akun" | "ip",
  kunci: string,
  windowSec: number,
  maks: number
): Promise<number> {
  const r = await getPool().query(
    `INSERT INTO login_rate_limit (tipe, kunci, gagal, window_mulai)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (tipe, kunci) DO UPDATE SET
       gagal = CASE
         WHEN login_rate_limit.window_mulai > now() - make_interval(secs => $3)
         THEN LEAST(login_rate_limit.gagal + 1, $4::integer)
         ELSE 1
       END,
       window_mulai = CASE
         WHEN login_rate_limit.window_mulai > now() - make_interval(secs => $3)
         THEN login_rate_limit.window_mulai
         ELSE now()
       END
     RETURNING gagal`,
    [tipe, kunci, windowSec, maks]
  );
  return r.rows[0].gagal as number;
}

// Baca counter gagal saat ini (tanpa menaikkan) — untuk cek batas sebelum verifikasi PIN.
async function bacaGagal(tipe: "akun" | "ip", kunci: string, windowSec: number): Promise<number> {
  const r = await getPool().query(
    `SELECT gagal FROM login_rate_limit
      WHERE tipe = $1 AND kunci = $2
        AND window_mulai > now() - make_interval(secs => $3)`,
    [tipe, kunci, windowSec]
  );
  return r.rows[0]?.gagal ?? 0;
}

// Catat login GAGAL ke audit_logs — TANPA PIN. Batas pencatatan per (akun, IP),
// bukan global. Di atas batas, satu baris ringkasan per jendela (tidak dilewatkan
// begitu saja, supaya jejak percobaan tetap ada).
async function catatAuditGagal({
  userId,
  akun,
  ip,
  alasan,
}: {
  userId: number | null;
  akun: string;
  ip: string | null;
  alasan: string;
}) {
  const pool = getPool();
  const ipKey = ip ?? "";
  const n = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE aksi = 'login_gagal'
        AND nilai_baru->>'akun' = $1
        AND coalesce(nilai_baru->>'ip', '') = $2
        AND waktu > now() - make_interval(secs => $3)`,
    [akun, ipKey, AUDIT_GAGAL_JENDELA]
  );
  if ((n.rows[0].n as number) >= AUDIT_GAGAL_PER_JENDELA) {
    const adaRingkasan = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE aksi = 'login_gagal_ringkasan'
          AND nilai_baru->>'akun' = $1
          AND coalesce(nilai_baru->>'ip', '') = $2
          AND waktu > now() - make_interval(secs => $3)
        LIMIT 1`,
      [akun, ipKey, AUDIT_GAGAL_JENDELA]
    );
    if (adaRingkasan.rowCount === 0) {
      await pool.query(
        `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_baru, user_id)
         VALUES ('login', $1, 'login_gagal_ringkasan', $2, $3)`,
        [
          userId ?? 0,
          JSON.stringify({ akun, ip, alasan, pesan: "batas audit tercapai" }),
          userId,
        ]
      );
    }
    return;
  }
  await pool.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_baru, user_id)
     VALUES ('login', $1, 'login_gagal', $2, $3)`,
    [userId ?? 0, JSON.stringify({ akun, ip, alasan }), userId]
  );
}

async function catatAuditLogin(userId: number, akun: string, ip: string | null) {
  await getPool().query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_baru, user_id)
     VALUES ('login', $1, 'login', $2, $3)`,
    [userId, JSON.stringify({ akun, ip }), userId]
  );
}

// Coba login. Mengembalikan hasil, tidak menyentuh cookie (itu urusan pemanggil).
export async function cobaLogin(
  username: string,
  pin: string,
  ip: string | null
): Promise<HasilLogin> {
  const pool = getPool();

  // 1) Cari user lebih dulu (agar audit saat terkunci bisa menyertakan user_id).
  const r = await pool.query(
    `SELECT id, peran, pin_hash, aktif FROM users WHERE nama = $1`,
    [username]
  );
  const user = r.rows[0];

  // 2) Cek batas per akun dan per IP sebelum verifikasi PIN.
  const gagalAkun = await bacaGagal("akun", username, LOGIN_WINDOW_PER_AKUN);
  const akunTerkunci = gagalAkun >= LOGIN_MAX_PER_AKUN;
  const gagalIp = ip ? await bacaGagal("ip", ip, LOGIN_WINDOW_PER_IP) : 0;
  const ipTerkunci = ip !== null && gagalIp >= LOGIN_MAX_PER_IP;

  if (akunTerkunci || ipTerkunci) {
    // Tetap dicatat: percobaan saat terkunci tidak boleh hilang dari jejak.
    await catatAuditGagal({
      userId: user ? user.id : null,
      akun: username,
      ip,
      alasan: "dikunci",
    });
    return { ok: false, alasan: akunTerkunci ? "kunci_akun" : "kunci_ip" };
  }
  if (!ip) {
    console.warn("cobaLogin: IP tidak diketahui, batas per-IP dilewati (hanya batas per-akun).");
  }

  // 3) Verifikasi PIN.
  let cocok = false;
  if (user) {
    cocok = await argon2.verify(user.pin_hash, pin).catch(() => false);
  }

  if (!user || !cocok || !user.aktif) {
    // Semua kasus gagal diperlakukan sama (tidak bocor info akun ada/nonaktif).
    const gagalSekarang = await naikkanGagal(
      "akun",
      username,
      LOGIN_WINDOW_PER_AKUN,
      LOGIN_MAX_PER_AKUN
    );
    if (ip) {
      await naikkanGagal("ip", ip, LOGIN_WINDOW_PER_IP, LOGIN_MAX_PER_IP);
    }
    await catatAuditGagal({
      userId: user ? user.id : null,
      akun: username,
      ip,
      alasan: !user ? "tidak_ditemukan" : !cocok ? "pin_salah" : "nonaktif",
    });
    return { ok: false, alasan: gagalSekarang >= LOGIN_MAX_PER_AKUN ? "kunci_akun" : "gagal" };
  }

  // 4) Berhasil: reset counter gagal akun & IP, catat audit.
  await pool.query(`DELETE FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`, [username]);
  if (ip) {
    await pool.query(`DELETE FROM login_rate_limit WHERE tipe = 'ip' AND kunci = $1`, [ip]);
  }
  await catatAuditLogin(user.id, username, ip);
  return { ok: true, userId: user.id, peran: user.peran };
}