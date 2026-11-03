// Dashboard — owner dan kasir (FR-30).
import { requireAuth } from "@/lib/auth";
import { Placeholder } from "./placeholder";

export default async function DashboardPage() {
  const sesi = await requireAuth();

  return (
    <div>
      <div className="bg-white rounded-3xl border border-[#ede5d8] p-6 flex items-center justify-between">
        <div>
          <h1 className="font-[Outfit] text-2xl font-bold text-[#002546]">
            Halo, {sesi.nama} ({sesi.peran === "owner" ? "Owner" : "Kasir"})
          </h1>
          <p className="text-sm text-[#635E54] mt-1">
            Outlet Bojongsoang · Buka 09.00 – 21.00 WIB
          </p>
        </div>
        <span className="px-3 py-1 rounded-full bg-[#002546] text-[#d3e4ff] text-xs font-bold uppercase tracking-wider">
          {sesi.peran} view
        </span>
      </div>
      <div className="mt-6">
        <Placeholder judul="Dashboard" catatan="Kartu ringkasan, tren 7 hari, dan 5 tiket terbaru akan dibangun di fase dashboard." />
      </div>
    </div>
  );
}
