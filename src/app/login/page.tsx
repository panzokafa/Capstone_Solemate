// Halaman Login. Server component: baca daftar pengguna aktif, render form.
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSesi } from "@/lib/auth";
import { KARYAWAN_ABSENSI_AKTIF } from "@/config/fitur";
import { Card } from "@/components/ui/card";
import { LoginForm } from "./login-form";

// Halaman ini membaca cookie & database per request, jangan di-prerender statis.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Sudah login? langsung ke dashboard.
  const sesi = await getSesi();
  if (sesi) redirect("/");

  const r = await getPool().query(
    `SELECT id, nama, peran FROM users WHERE aktif = true ORDER BY peran, nama`
  );
  const pengguna = r.rows.map((u: { id: number; nama: string; peran: "owner" | "kasir" }) => ({
    id: u.id,
    nama: u.nama,
    peran: u.peran,
  }));

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col">
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
        <Card className="w-full max-w-md p-6 sm:p-10 shadow-md">
          <div className="text-center mb-6">
            <h1 className="font-outfit text-2xl font-bold text-text-main">
              Masuk ke Sistem
            </h1>
            <p className="font-jakarta text-sm text-text-muted mt-1">
              Masuk untuk mengelola pesanan &amp; operasional laundry sepatu.
            </p>
          </div>

          {pengguna.length === 0 ? (
            <p className="text-center text-sm text-text-muted">
              Belum ada akun. Hubungi Owner untuk membuat akun.
            </p>
          ) : (
            <>
              <LoginForm pengguna={pengguna} />
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
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
