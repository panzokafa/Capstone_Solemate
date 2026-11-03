// Rekap Bulanan — OWNER SAJA.
import { requireOwner, AksesDitolakError } from "@/lib/auth";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export default async function RekapBulananPage() {
  try {
    await requireOwner();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  return <Placeholder judul="Rekap Bulanan" />;
}
