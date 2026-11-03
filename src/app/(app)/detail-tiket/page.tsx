// Detail Tiket — owner (lihat saja) dan kasir.
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { Placeholder } from "../placeholder";
import { AksesDitolak } from "../akses-ditolak";

export default async function DetailTiketPage() {
  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }
  return <Placeholder judul="Detail Tiket" />;
}
