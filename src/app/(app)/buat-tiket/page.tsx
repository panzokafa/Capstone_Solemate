// Buat Tiket Baru — KASIR SAJA (PRD 7.4, FR-10, FR-11, FR-25, FR-61, FR-81).
import { requireKasir, AksesDitolakError } from "@/lib/auth";
import { daftarLayananAktif } from "@/lib/katalog";
import { AksesDitolak } from "../akses-ditolak";
import { BuatTiketClient } from "./buat-tiket-client";

function formatDatetimeInputWib(tgl: Date): string {
  const bagian = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(tgl);

  const ambil = (tipe: string) => bagian.find((b) => b.type === tipe)?.value ?? "00";
  const jam = ambil("hour") === "24" ? "00" : ambil("hour");
  return `${ambil("year")}-${ambil("month")}-${ambil("day")}T${jam}:${ambil("minute")}`;
}

export default async function BuatTiketPage() {
  try {
    await requireKasir();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const layananAktif = await daftarLayananAktif();
  const waktuSekarangWib = formatDatetimeInputWib(new Date());

  return (
    <BuatTiketClient
      layananAwal={layananAktif}
      waktuMasukAwalWib={waktuSekarangWib}
    />
  );
}
