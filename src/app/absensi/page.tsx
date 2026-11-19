// Absensi — bisa diakses TANPA login saat KARYAWAN_ABSENSI_AKTIF=true.
// Saat KARYAWAN_ABSENSI_AKTIF=false, membalas 404 untuk semua pengunjung termasuk anonim.
import Link from "next/link";
import { notFound } from "next/navigation";
import { KARYAWAN_ABSENSI_AKTIF } from "@/config/fitur";
import { Card, CardContent } from "@/components/ui/card";
import { LogoSolemate } from "@/components/logo-solemate";

export const dynamic = "force-dynamic";

export default function AbsensiPage() {
  if (!KARYAWAN_ABSENSI_AKTIF) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col font-jakarta">
      <header className="w-full py-5 px-6">
        <LogoSolemate ukuran="halaman" />
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
