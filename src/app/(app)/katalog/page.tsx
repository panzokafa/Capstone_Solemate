// Katalog Layanan dan Harga — OWNER SAJA (FR-60, FR-61).
import { requireOwner, AksesDitolakError } from "@/lib/auth";
import { daftarSemuaLayanan } from "@/lib/katalog";
import { AksesDitolak } from "../akses-ditolak";
import { KatalogClient } from "./katalog-client";

export default async function KatalogPage() {
  try {
    await requireOwner();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  const layanan = await daftarSemuaLayanan();
  return <KatalogClient awal={layanan} />;
}
