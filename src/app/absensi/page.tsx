// Absensi — bisa diakses TANPA login (dari link di halaman Login).
// Fitur clock-in/clock-out dibangun di fase absensi; di sini hanya kerangka publik.
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function AbsensiPage() {
  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col font-jakarta">
      <header className="w-full py-6 px-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold font-outfit shadow-xs">
            S
          </div>
          <div className="flex flex-col">
            <span className="font-outfit font-extrabold text-lg text-primary-dark leading-none">
              Solemate
            </span>
            <span className="font-outfit text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase mt-0.5">
              Shoes Clean
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-12">
        <Card className="w-full max-w-md p-8 shadow-md text-center">
          <CardContent className="p-0 flex flex-col items-center">
            <h1 className="font-outfit text-2xl font-bold text-text-main">
              Absensi Karyawan
            </h1>
            <p className="font-jakarta text-sm text-text-muted mt-2">
              Halaman absensi (clock-in / clock-out dengan PIN pribadi) dibangun di fase absensi sesuai PRD.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-full bg-primary text-white text-sm font-outfit font-bold hover:bg-primary-hover active:bg-primary-dark transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Kembali ke Login
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
