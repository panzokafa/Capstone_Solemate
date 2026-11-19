// Halaman Rekap Bulanan — OWNER SAJA (Phase 7B, FR-50, FR-51, FR-52, FR-03, NFR-07).
// Menolak kasir (AksesDitolak) dan mengarahkan pengguna tanpa sesi ke /login.
// Hanya-baca dan seluruh angka dihitung SQL dari database (orders & order_items).

import { requireOwner, AksesDitolakError } from "@/lib/auth.ts";
import { AksesDitolak } from "../akses-ditolak.tsx";
import {
  validasiQueryRekapBulanan,
  ambilRekapBulanan,
  type FilterRekapBulanan,
} from "@/lib/laporan.ts";
import { RekapBulananClient, type DataRekapBulananUi } from "./rekap-bulanan-client.tsx";

export const dynamic = "force-dynamic";

type HalamanProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RekapBulananPage({ searchParams }: HalamanProps) {
  try {
    await requireOwner();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") {
      usp.set(k, v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        usp.append(k, item);
      }
    }
  }

  const validasi = validasiQueryRekapBulanan(usp);
  let galatQuery: string | null = null;
  let filter: FilterRekapBulanan = { periode: "bulan_ini", dari: "", sampai: "" };

  if (!validasi.ok) {
    galatQuery = validasi.galat;
  } else {
    filter = validasi.data;
  }

  const data = await ambilRekapBulanan(filter);
  const {
    disclaimer: _disclaimerDihilangkan,
    laba_rugi: _labaRugiDihilangkan,
    layanan_terlaris: {
      catatan_pembulatan: _catatanPembulatanDihilangkan,
      ...layananTerlarisUi
    },
    ...sisaData
  } = data;
  void _disclaimerDihilangkan;
  void _labaRugiDihilangkan;
  void _catatanPembulatanDihilangkan;

  const dataUi: DataRekapBulananUi = {
    ...sisaData,
    layanan_terlaris: layananTerlarisUi,
  };

  return (
    <RekapBulananClient
      key={`${dataUi.periode}:${dataUi.rentang.dari}:${dataUi.rentang.sampai}:${galatQuery ?? ""}`}
      data={dataUi}
      galatQuery={galatQuery}
    />
  );
}
