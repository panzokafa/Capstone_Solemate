// Pengalihan rute lama /detail-tiket ke /tiket/[id] atau /tiket.
import { redirect } from "next/navigation";
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { AksesDitolak } from "../akses-ditolak";

type SearchParamsProp = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function DetailTiketRedirectPage({
  searchParams,
}: {
  searchParams: SearchParamsProp;
}) {
  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const sp = await searchParams;
  const idRaw = typeof sp.id === "string" ? sp.id : undefined;
  if (idRaw) {
    const idValid = validasiIdTiket(idRaw);
    if (idValid !== null) {
      redirect(`/tiket/${idValid}`);
    }
  }

  redirect("/tiket");
}
