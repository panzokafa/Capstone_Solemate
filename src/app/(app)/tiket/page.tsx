// Daftar Tiket Pesanan — Kasir dan Owner (owner hanya lihat; PRD 7.3, FR-12 s.d. FR-14, FR-23).
// Seluruh parameter query divalidasi di server sebelum memanggil database.
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { UKURAN_HALAMAN_DEFAULT } from "@/config/tiket";
import { tanggalHariIniWib, validasiQueryDaftarTiket } from "@/lib/tiket-validasi";
import { daftarTiket } from "@/lib/tiket";
import { AksesDitolak } from "../akses-ditolak";
import { DaftarTiketClient } from "./daftar-tiket-client";

type SearchParamsProp = Promise<{ [key: string]: string | string[] | undefined }>;

function bangunUrlSearchParams(
  mentah: Record<string, string | string[] | undefined>
): URLSearchParams {
  const usp = new URLSearchParams();
  for (const [kunci, nilai] of Object.entries(mentah)) {
    if (Array.isArray(nilai)) {
      for (const item of nilai) {
        usp.append(kunci, item);
      }
    } else if (typeof nilai === "string") {
      usp.append(kunci, nilai);
    }
  }
  return usp;
}

export default async function TiketPage({
  searchParams,
}: {
  searchParams: SearchParamsProp;
}) {
  let sesi;
  try {
    sesi = await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const spObj = await searchParams;
  const usp = bangunUrlSearchParams(spObj);
  const sekarang = new Date();
  const hariIni = tanggalHariIniWib(sekarang);

  const kunciFilter = usp.toString();

  const v = validasiQueryDaftarTiket(usp, sekarang);
  if (!v.ok) {
    return (
      <DaftarTiketClient
        key={`galat:${kunciFilter}`}
        peran={sesi.peran}
        hariIniWib={hariIni}
        galatAwal={v.galat}
        filterAktif={{
          periode: "semua",
          dari: "",
          sampai: "",
          belumBayarDiAtas: false,
          cari: "",
          ukuran: UKURAN_HALAMAN_DEFAULT,
        }}
        hasil={{
          data: [],
          paginasi: {
            halaman: 1,
            ukuran: UKURAN_HALAMAN_DEFAULT,
            total_data: 0,
            total_halaman: 0,
          },
        }}
      />
    );
  }

  const hasil = await daftarTiket(v.data);

  return (
    <DaftarTiketClient
      key={kunciFilter}
      peran={sesi.peran}
      hariIniWib={hariIni}
      galatAwal={null}
      filterAktif={{
        periode: v.data.periode,
        dari: v.data.dari ?? "",
        sampai: v.data.sampai ?? "",
        belumBayarDiAtas: v.data.belum_bayar_di_atas,
        cari: v.data.cari,
        ukuran: v.data.ukuran,
      }}
      hasil={hasil}
    />
  );
}
