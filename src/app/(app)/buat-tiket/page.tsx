// Buat Tiket Baru — KASIR SAJA (PRD 7.4, FR-10, FR-11, FR-25, FR-61, FR-81).
import { requireKasir, AksesDitolakError } from "@/lib/auth";
import { daftarLayananAktif } from "@/lib/katalog";
import { formatDatetimeLocalWib } from "@/lib/format";
import { AksesDitolak } from "../akses-ditolak";
import { BuatTiketClient } from "./buat-tiket-client";

export default async function BuatTiketPage() {
  try {
    await requireKasir();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const layananAktif = await daftarLayananAktif();
  const waktuSekarangWib = formatDatetimeLocalWib(new Date());

  return (
    <BuatTiketClient
      layananAwal={layananAktif}
      waktuMasukAwalWib={waktuSekarangWib}
    />
  );
}
