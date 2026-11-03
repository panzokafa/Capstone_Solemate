// Layout untuk halaman yang butuh login: sidebar per peran.
import { requireAuth } from "@/lib/auth";
import { MENU_OWNER, MENU_KASIR } from "@/config/menu";
import { Sidebar } from "./sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Redirect ke /login kalau belum login.
  const sesi = await requireAuth();
  const menu = sesi.peran === "owner" ? MENU_OWNER : MENU_KASIR;

  return (
    <div className="min-h-screen bg-surface-app flex flex-col font-jakarta">
      <Sidebar menu={menu} nama={sesi.nama} peran={sesi.peran} />
      <div className="lg:pl-64 flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
