// Detail Tiket Pesanan — Kasir dan Owner (PRD 7.5, FR-15, FR-16, FR-23, NFR-01, NFR-02).
// - Kasir mendapat kontrol mutasi status pesanan, pembayaran, dan pembatalan tiket.
// - Owner hanya melihat badge baca-saja dan riwayat perubahan.
// - Riwayat perubahan diambil dari audit_logs dan selalu bersifat hanya-baca.
// - ID yang bukan bilangan bulat positif atau tidak ada menghasilkan 404 yang rapi.

import { notFound } from "next/navigation";
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket } from "@/lib/tiket";
import { AksesDitolak } from "../../akses-ditolak";
import { DetailTiketClient } from "./detail-tiket-client";

type ParamsProp = Promise<{ id: string }>;

export default async function DetailTiketByIdPage({
  params,
}: {
  params: ParamsProp;
}) {
  let sesi;
  try {
    sesi = await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const { id: idRaw } = await params;
  const idValid = validasiIdTiket(idRaw);
  if (idValid === null) {
    notFound();
  }

  const tiket = await ambilDetailTiket(idValid);
  if (!tiket) {
    notFound();
  }

  return <DetailTiketClient tiketAwal={tiket} peran={sesi.peran} />;
}
