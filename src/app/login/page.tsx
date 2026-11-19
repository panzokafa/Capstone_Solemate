// Halaman Login. Server component: periksa sesi aktif, render form masuk tanpa mengekspose daftar akun.
import { redirect } from "next/navigation";
import { getSesi } from "@/lib/auth";
import { KARYAWAN_ABSENSI_AKTIF } from "@/config/fitur";
import { Card } from "@/components/ui/card";
import { LogoSolemate } from "@/components/logo-solemate";
import { LoginForm } from "./login-form";

// Halaman ini membaca cookie sesi per request, jangan di-prerender statis.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Sudah login? langsung ke dashboard.
  const sesi = await getSesi();
  if (sesi) redirect("/");

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col">
      <header className="w-full py-5 px-6">
        <LogoSolemate ukuran="halaman" />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-12">
        <Card className="w-full max-w-md p-6 sm:p-10 shadow-md">
          <div className="text-center mb-6">
            <h1 className="font-outfit text-2xl font-bold text-text-main">
              Masuk ke Sistem
            </h1>
            <p className="font-jakarta text-sm text-text-muted mt-1">
              Masuk untuk mengelola pesanan &amp; operasional laundry sepatu.
            </p>
          </div>

          <LoginForm />
          {KARYAWAN_ABSENSI_AKTIF && (
            <div className="mt-5 text-center">
              <a
                href="/absensi"
                className="text-xs text-text-muted hover:text-primary hover:underline font-jakarta"
              >
                Absen Karyawan (Clock-in / Clock-out)
              </a>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
