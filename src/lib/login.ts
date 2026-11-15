// Logika login: verifikasi PIN, pembatasan percobaan (atomik, dari database), audit.
import argon2 from "argon2";
import { getPool } from "./db.ts";
import {
  LOGIN_MAX_PER_AKUN,
  LOGIN_WINDOW_PER_AKUN,
  LOGIN_MAX_PER_IP,
  LOGIN_WINDOW_PER_IP,
  AUDIT_GAGAL_PER_JENDELA,
  AUDIT_GAGAL_JENDELA,
} from "../config/auth.ts";
import { MAKS_PANJANG_USERNAME } from "../config/keamanan.ts";

export type HasilLogin =
  | { ok: true; userId: number; peran: "owner" | "kasir" }
  | { ok: false; alasan: "kunci_ip" | "gagal" };

// Pesan seragam untuk seluruh kegagalan berbasis kredensial/akun (tidak membedakan
// akun tak dikenal, akun nonaktif, PIN salah, maupun akun terkunci sementara).
export const PESAN_GAGAL =
  "Nama pengguna atau PIN tidak sesuai, atau akun sedang dikunci sementara setelah beberapa percobaan gagal. Silakan coba lagi.";

// Parameter Argon2id yang SAMA PERSIS dengan scripts/create-user.mjs dan scripts/reset-pin.mjs.
export const OPSI_ARGON2_PIN = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

let janjiHashDummy: Promise<string> | null = null;
let jumlahHitungHashDummy = 0;

/**
 * Menghasilkan hash dummy satu kali per proses dengan parameter Argon2id yang sama persis
 * dengan hash PIN asli untuk menyamakan waktu komputasi verifikasi ketika akun tidak ditemukan.
 */
export function ambilHashDummy(): Promise<string> {
  if (!janjiHashDummy) {
    jumlahHitungHashDummy += 1;
    janjiHashDummy = argon2.hash(
      "dummy-hash-bukan-pin-solemate-tidak-cocok",
      OPSI_ARGON2_PIN
    );
  }
  return janjiHashDummy;
}

export function ambilJumlahHitungHashDummy(): number {
  return jumlahHitungHashDummy;
}

// Pra-hitung hash dummy sekali saat startup runtime (lewati saat next build) agar
// percobaan pertama pada akun tak dikenal tetap membutuhkan waktu verifikasi setara.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  void ambilHashDummy();
}

// Naikkan counter secara atomik SEBELUM verifikasi PIN (satu perintah SQL, tanpa race),
// dibatasi maksimal `maks + 1` agar permintaan saat terkunci tertahan tanpa memperpanjang jendela.
// Jendela lewat → reset ke 1.
async function naikkanGagal(
  tipe: "akun" | "ip",
  kunci: string,
  windowSec: number,
  maks: number
): Promise<number> {
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO login_rate_limit (tipe, kunci, gagal, window_mulai)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (tipe, kunci) DO UPDATE SET
       gagal = CASE
         WHEN login_rate_limit.window_mulai > now() - make_interval(secs => $3)
         THEN LEAST(login_rate_limit.gagal + 1, $4::integer + 1)
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
  const gagal = r.rows[0].gagal as number;

  // Pembersihan berkala baris rate-limit IP kedaluwarsa saat jendela IP baru dimulai.
  if (tipe === "ip" && gagal === 1) {
    await pool
      .query(
        `DELETE FROM login_rate_limit
          WHERE tipe = 'ip'
            AND window_mulai <= now() - make_interval(secs => $1)`,
        [windowSec]
      )
      .catch(() => {});
  }

  return gagal;
}

// Kembalikan tepat satu hitungan pra-inkremen IP secara atomik saat login berhasil,
// agar login sah tidak menghabiskan kuota IP toko tanpa pernah mereset kegagalan IP lain.
async function kembalikanSatuGagalIp(ip: string): Promise<void> {
  await getPool().query(
    `UPDATE login_rate_limit
     SET gagal = GREATEST(gagal - 1, 0)
     WHERE tipe = 'ip' AND kunci = $1`,
    [ip]
  );
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
  const namaBersih = username.trim();
  if (namaBersih.length === 0 || namaBersih.length > MAKS_PANJANG_USERNAME) {
    return { ok: false, alasan: "gagal" };
  }

  const pool = getPool();

  // 1) Cari user lebih dulu. Akun tak dikenal tidak membuat baris di `login_rate_limit`
  //    maupun `audit_logs` sehingga tabel tidak tumbuh tanpa batas oleh nama acak.
  const r = await pool.query(
    `SELECT id, nama, peran, pin_hash, aktif FROM users WHERE nama = $1`,
    [namaBersih]
  );
  const user = r.rows[0] as
    | { id: number; nama: string; peran: "owner" | "kasir"; pin_hash: string; aktif: boolean }
    | undefined;

  // 2) Pra-inkremen batas per IP secara atomik SEBELUM verifikasi PIN & pengecekan akun.
  if (!ip) {
    console.warn("cobaLogin: IP tidak diketahui, batas per-IP dilewati (hanya batas per-akun).");
  }
  const gagalIp = ip
    ? await naikkanGagal("ip", ip, LOGIN_WINDOW_PER_IP, LOGIN_MAX_PER_IP)
    : 0;
  if (ip !== null && gagalIp > LOGIN_MAX_PER_IP) {
    if (user) {
      await catatAuditGagal({
        userId: user.id,
        akun: user.nama,
        ip,
        alasan: "dikunci",
      });
    }
    return { ok: false, alasan: "kunci_ip" };
  }

  // 3) Pra-inkremen batas per akun secara atomik SEBELUM verifikasi PIN (khusus akun terdaftar).
  const gagalAkun = user
    ? await naikkanGagal("akun", user.nama, LOGIN_WINDOW_PER_AKUN, LOGIN_MAX_PER_AKUN)
    : 0;
  const akunTerkunci = Boolean(user && gagalAkun > LOGIN_MAX_PER_AKUN);

  // 4) Verifikasi Argon2id selalu dijalankan baik akun ditemukan, tak dikenal, nonaktif,
  //    maupun sedang terkunci agar waktu respons identik dan hash asli tidak diuji saat terkunci.
  const pakaiHashAsli = Boolean(user && user.aktif && !akunTerkunci);
  const hashTarget = pakaiHashAsli ? user!.pin_hash : await ambilHashDummy();
  const cocok = await argon2.verify(hashTarget, pin).catch(() => false);

  if (!user) {
    return { ok: false, alasan: "gagal" };
  }

  if (akunTerkunci) {
    await catatAuditGagal({
      userId: user.id,
      akun: user.nama,
      ip,
      alasan: "dikunci",
    });
    return { ok: false, alasan: "gagal" };
  }

  if (!user.aktif || !cocok) {
    await catatAuditGagal({
      userId: user.id,
      akun: user.nama,
      ip,
      alasan: !user.aktif ? "nonaktif" : "pin_salah",
    });
    return { ok: false, alasan: "gagal" };
  }

  // 5) Berhasil: reset penghitung akun dan kembalikan tepat satu hitungan IP secara atomik
  //    (agar login sah tidak menghabiskan kuota IP toko, namun tidak mereset kegagalan lain).
  await pool.query(
    `DELETE FROM login_rate_limit WHERE tipe = 'akun' AND kunci = $1`,
    [user.nama]
  );
  if (ip) {
    await kembalikanSatuGagalIp(ip);
  }
  await catatAuditLogin(user.id, user.nama, ip);
  return { ok: true, userId: user.id, peran: user.peran };
}
