// Penyimpanan sesi di server. Cookie hanya membawa ID sesi.
// Data sesi (peran, kedaluwarsa) disimpan di tabel `sessions` dan dibaca
// ulang di setiap request agar peran/status aktif selalu terkini.
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getPool } from "./db";

export const SESSION_COOKIE_NAME = "solemate_session";

export type SesiAktif = {
  id: string;
  userId: number;
  nama: string;
  peran: "owner" | "kasir";
  aktif: boolean;
};

function ttlDetik(): number {
  const n = Number(process.env.SESSION_TTL_SECONDS ?? 28800);
  return Number.isFinite(n) && n > 0 ? n : 28800;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Ambil peran terbaru dari tabel users berdasarkan ID cookie sesi + status aktif.
export async function bacaSesiDariId(id: string | undefined): Promise<SesiAktif | null> {
  if (!id) return null;

  const pool = getPool();
  const r = await pool.query(
    `SELECT s.id, u.id AS user_id, u.nama, u.peran, u.aktif
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.kedaluwarsa_pada > now()`,
    [id]
  );
  if (r.rowCount === 0) return null;

  const row = r.rows[0];
  // Akun nonaktif: sesi tidak berlaku lagi.
  if (!row.aktif) return null;

  return {
    id: row.id,
    userId: row.user_id,
    nama: row.nama,
    peran: row.peran,
    aktif: row.aktif,
  };
}

// Ambil peran terbaru dari tabel users (bukan salinan di sesi) + status aktif.
export async function bacaSesi(): Promise<SesiAktif | null> {
  const store = await cookies();
  return bacaSesiDariId(store.get(SESSION_COOKIE_NAME)?.value);
}

// Buat sesi baru (ID baru tiap login). Mengembalikan ID untuk cookie.
export async function buatSesi(
  userId: number,
  peran: string,
  ip: string | null
): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO sessions (id, user_id, peran, ip, kedaluwarsa_pada)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [id, userId, peran, ip, ttlDetik()]
  );
  return id;
}

export async function setSesiCookie(id: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: ttlDetik(),
  });
}

export async function hapusSesiCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
