// Komponen sidebar + tombol keluar + drawer responsif (tablet & ponsel).
// Dipakai layout grup (app). Menu disaring di server berdasarkan sesi.
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ItemMenu } from "@/config/menu";
import { Ikon } from "@/components/ikon";

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
  const [bukaDrawer, setBukaDrawer] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Tutup drawer jika rute berubah saat render
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setBukaDrawer(false);
  }

  // Tutup drawer saat tombol Escape ditekan
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setBukaDrawer(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function keluar() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Konten navigasi (dipakai bersama oleh sidebar desktop & drawer mobile)
  const navContent = (onKlikItem?: () => void) => (
    <nav className="flex flex-col gap-1.5" aria-label="Menu navigasi">
      {menu.map((m) => {
        const aktif = pathname === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            onClick={onKlikItem}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-outfit min-h-[44px] transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              aktif
                ? "bg-primary text-white font-bold shadow-xs"
                : "text-text-muted hover:bg-surface-hover hover:text-primary"
            }`}
          >
            <Ikon name={m.ikon} size={20} className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  // Footer profil & tombol keluar
  const userFooter = (
    <div className="border-t border-border-warm pt-4">
      <div className="px-3 mb-3">
        <p className="text-sm font-semibold text-primary truncate font-jakarta">{nama}</p>
        <p className="text-xs text-text-muted capitalize font-jakarta">{peran}</p>
      </div>
      <button
        type="button"
        onClick={() => void keluar()}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-danger hover:bg-danger-light/60 transition-all cursor-pointer min-h-[44px] focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
      >
        <Ikon name="logout" size={20} className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="font-outfit">Keluar</span>
      </button>
    </div>
  );

  return (
    <>
      {/* Top bar untuk Tablet & Ponsel (< lg) */}
      <header className="lg:hidden sticky top-0 z-30 bg-surface-card/95 backdrop-blur-md border-b border-border-warm px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm shadow-xs font-outfit">
            S
          </div>
          <div className="flex flex-col">
            <span className="font-outfit font-extrabold text-base text-primary-dark leading-none">
              Solemate
            </span>
            <span className="text-[9px] font-bold tracking-[0.18em] text-text-muted uppercase mt-0.5 font-outfit">
              Shoes Clean
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-subtle text-primary capitalize font-outfit">
            {peran}
          </span>
          <button
            type="button"
            onClick={() => setBukaDrawer((b) => !b)}
            className="p-2.5 rounded-xl text-primary hover:bg-surface-hover transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            aria-label={bukaDrawer ? "Tutup navigasi" : "Buka navigasi"}
            aria-expanded={bukaDrawer}
          >
            <Ikon name={bukaDrawer ? "close" : "menu"} size={22} className="w-5.5 h-5.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Backdrop overlay drawer (< lg) */}
      {bukaDrawer && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-xs transition-opacity"
          onClick={() => setBukaDrawer(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer sidebar untuk Tablet & Ponsel (< lg) */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-surface-card z-50 shadow-2xl flex flex-col justify-between p-5 border-r border-border-warm transform transition-transform duration-200 ease-in-out ${
          bukaDrawer ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar navigasi drawer"
      >
        <div className="overflow-y-auto">
          <div className="flex items-center justify-between mb-6 pb-2 border-b border-border-warm/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold font-outfit">
                S
              </div>
              <div className="flex flex-col">
                <span className="font-outfit font-extrabold text-lg text-primary-dark leading-none">
                  Solemate
                </span>
                <span className="text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase mt-0.5 font-outfit">
                  Shoes Clean
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBukaDrawer(false)}
              className="p-2.5 rounded-xl text-text-muted hover:bg-surface-hover hover:text-primary cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              aria-label="Tutup menu"
            >
              <Ikon name="close" size={20} className="w-5 h-5 shrink-0" aria-hidden="true" />
            </button>
          </div>

          {navContent(() => setBukaDrawer(false))}
        </div>

        {userFooter}
      </aside>

      {/* Sidebar tetap untuk Desktop (>= lg) */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-surface-card border-r border-border-warm flex-col justify-between p-5 z-20">
        <div>
          <div className="flex items-center gap-3 mb-7 px-1">
            <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold shadow-xs font-outfit">
              S
            </div>
            <div className="flex flex-col">
              <span className="font-outfit font-extrabold text-lg text-primary-dark leading-none">
                Solemate
              </span>
              <span className="text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase mt-0.5 font-outfit">
                Shoes Clean
              </span>
            </div>
          </div>

          {navContent()}
        </div>

        {userFooter}
      </aside>
    </>
  );
}
