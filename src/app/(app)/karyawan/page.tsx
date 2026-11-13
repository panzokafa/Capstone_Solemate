// Karyawan — OWNER SAJA (dinonaktifkan 404 ketika KARYAWAN_ABSENSI_AKTIF=false).
import { pastikanHalamanKaryawanAbsensi } from "@/lib/guard-karyawan-absensi";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export const dynamic = "force-dynamic";

export default async function KaryawanPage() {
  const status = await pastikanHalamanKaryawanAbsensi();
  if (status === "ditolak") return <AksesDitolak />;
  return <Placeholder judul="Karyawan" />;
}
