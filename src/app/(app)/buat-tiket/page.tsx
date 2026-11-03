// Buat Tiket Baru — KASIR SAJA.
import { requireKasir, AksesDitolakError } from "@/lib/auth";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export default async function BuatTiketPage() {
  try {
    await requireKasir();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  return <Placeholder judul="Buat Tiket Baru" />;
}
