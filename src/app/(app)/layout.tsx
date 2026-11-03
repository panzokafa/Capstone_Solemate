// Layout untuk halaman yang butuh login: sidebar per peran.
import { requireAuth } from "@/lib/auth";
import { MENU_OWNER, MENU_KASIR } from "@/config/menu";
import { Sidebar } from "./sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Redirect ke /login kalau belum login.
  const sesi = await requireAuth();
  const menu = sesi.peran === "owner" ? MENU_OWNER : MENU_KASIR;

  return (
    <div className="min-h-screen bg-[#e5ded4]">
      <Sidebar menu={menu} nama={sesi.nama} peran={sesi.peran} />
      <div className="pl-64">
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
