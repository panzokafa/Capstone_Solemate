// Komponen sidebar + tombol keluar. Dipakai layout grup (app).
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ItemMenu } from "@/config/menu";

export function Sidebar({
  menu,
  nama,
  peran,
}: {
  menu: ItemMenu[];
  nama: string;
  peran: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function keluar() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[#FAF4EB] border-r border-[#ece4d6] flex flex-col justify-between p-5 z-40">
      <div>
        <div className="flex items-center gap-3 mb-7">
          <div className="w-10 h-10 rounded-full bg-[#133B63] text-white flex items-center justify-center font-bold">
            S
          </div>
          <div className="flex flex-col">
            <span className="font-[Outfit] font-extrabold text-lg text-[#133B63] leading-none">
              Solemate
            </span>
            <span className="text-[10px] font-bold tracking-[0.2em] text-[#635E54] uppercase mt-0.5">
              Shoes Clean
            </span>
          </div>
        </div>

        <nav className="flex flex-col gap-1.5">
          {menu.map((m) => {
            const aktif = pathname === m.href;
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-[Outfit] transition-all ${
                  aktif
                    ? "bg-[#133B63] text-white font-bold shadow-sm"
                    : "text-[#635E54] hover:bg-[#ede5d8] hover:text-[#133B63]"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{m.ikon}</span>
                <span>{m.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-[#ece4d6] pt-4">
        <div className="px-3 mb-3">
          <p className="text-sm font-semibold text-[#133B63] truncate">{nama}</p>
          <p className="text-xs text-[#635E54] capitalize">{peran}</p>
        </div>
        <button
          type="button"
          onClick={() => void keluar()}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-[#ba1a1a] hover:bg-[#ffdad6]/60 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span>Keluar</span>
        </button>
      </div>
    </aside>
  );
}
