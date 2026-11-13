// API Rekap Absensi — OWNER SAJA (membalas 404 untuk owner/kasir saat KARYAWAN_ABSENSI_AKTIF=false; anonim -> /login).
import { tanganiApiKaryawanAbsensi } from "@/lib/guard-karyawan-absensi";

export const dynamic = "force-dynamic";

export async function GET() {
  return tanganiApiKaryawanAbsensi("rekap-absensi");
}
