// Halaman Laporan Harian Operasional — OWNER SAJA (Phase 7A, FR-40 - FR-44).
// Menolak kasir (AksesDitolak) dan mengarahkan pengguna tanpa sesi ke /login.
// Tidak dapat diedit dan dihitung dari data pesanan terkini di database.

import { requireOwner, AksesDitolakError } from "@/lib/auth.ts";
import { AksesDitolak } from "../akses-ditolak.tsx";
import {
  validasiQueryLaporanHarian,
  ambilLaporanHarian,
  type FilterLaporanHarian,
} from "@/lib/laporan.ts";
import { LaporanHarianClient } from "./laporan-harian-client.tsx";

export const dynamic = "force-dynamic";

type HalamanProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LaporanHarianPage({ searchParams }: HalamanProps) {
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

  const validasi = validasiQueryLaporanHarian(usp);
  let galatQuery: string | null = null;
  let filter: FilterLaporanHarian = { periode: "hari_ini", dari: "", sampai: "" };

  if (!validasi.ok) {
    galatQuery = validasi.galat;
  } else {
    filter = validasi.data;
  }

  const data = await ambilLaporanHarian(filter);

  return <LaporanHarianClient data={data} galatQuery={galatQuery} />;
}
