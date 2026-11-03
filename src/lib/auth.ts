// Helper otorisasi: dipanggil eksplisit di setiap halaman/route handler.
// Tidak ada middleware top-level: tiap endpoint memanggil fungsi ini.
import { redirect } from "next/navigation";
import { bacaSesi, type SesiAktif } from "./session";

// Dilempar kalau peran tidak cocok. Halaman menangkap ini lalu menampilkan
// "Akses ditolak"; route handler mengubahnya jadi 403.
export class AksesDitolakError extends Error {
  constructor(pesan = "Akses ditolak") {
    super(pesan);
    this.name = "AksesDitolakError";
  }
}

// Baca sesi. Tidak memaksa redirect — pemanggilnya yang memutuskan.
export async function getSesi(): Promise<SesiAktif | null> {
  return bacaSesi();
}

// Wajib login, kalau belum maka redirect ke /login.
export async function requireAuth(): Promise<SesiAktif> {
  const sesi = await getSesi();
  if (!sesi) redirect("/login");
  return sesi;
}

// Wajib owner. Kasir akan mendapat AksesDitolakError.
export async function requireOwner(): Promise<SesiAktif> {
  const sesi = await requireAuth();
  if (sesi.peran !== "owner") throw new AksesDitolakError();
  return sesi;
}

// Wajib kasir. Owner akan mendapat AksesDitolakError.
export async function requireKasir(): Promise<SesiAktif> {
  const sesi = await requireAuth();
  if (sesi.peran !== "kasir") throw new AksesDitolakError();
  return sesi;
}
