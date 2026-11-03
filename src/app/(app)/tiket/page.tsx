// Daftar Tiket Pesanan — owner (lihat saja) dan kasir (kelola).
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export default async function TiketPage() {
  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  return <Placeholder judul="Daftar Tiket Pesanan" />;
}
