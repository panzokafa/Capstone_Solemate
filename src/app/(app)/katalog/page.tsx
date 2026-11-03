// Katalog Layanan dan Harga — OWNER SAJA.
import { requireOwner, AksesDitolakError } from "@/lib/auth";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export default async function KatalogPage() {
  try {
    await requireOwner();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  return <Placeholder judul="Katalog Layanan & Harga" />;
}
