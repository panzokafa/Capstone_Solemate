// Helper penjaga rute Karyawan & Rekap Absensi berdasarkan KARYAWAN_ABSENSI_AKTIF.
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { KARYAWAN_ABSENSI_AKTIF } from "@/config/fitur";
import { requireAuth, requireOwner, AksesDitolakError } from "./auth";

/**
 * Penjaga halaman owner untuk fitur Karyawan & Rekap Absensi:
 * - Anonim tetap diarahkan ke /login lewat requireAuth().
 * - Saat KARYAWAN_ABSENSI_AKTIF=false, memanggil notFound() sebelum cek peran agar owner dan kasir mendapat 404 tanpa membocorkan fitur.
 */
export async function pastikanHalamanKaryawanAbsensi(): Promise<"ok" | "ditolak"> {
  await requireAuth();
  if (!KARYAWAN_ABSENSI_AKTIF) {
    notFound();
  }
  try {
    await requireOwner();
    return "ok";
  } catch (e) {
    if (e instanceof AksesDitolakError) return "ditolak";
    throw e;
  }
}

/**
 * Penjaga endpoint API stub untuk fitur Karyawan & Rekap Absensi:
 * - Anonim tetap diarahkan ke /login lewat requireAuth().
 * - Saat KARYAWAN_ABSENSI_AKTIF=false, membalas 404 identik untuk owner dan kasir sebelum cek peran.
 */
export async function tanganiApiKaryawanAbsensi(namaData: string): Promise<NextResponse> {
  try {
    await requireAuth();
    if (!KARYAWAN_ABSENSI_AKTIF) {
      return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    }
    const sesi = await requireOwner();
    return NextResponse.json({ ok: true, peran: sesi.peran, data: namaData });
  } catch (e) {
    if (e instanceof AksesDitolakError) {
      return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
    }
    throw e;
  }
}
