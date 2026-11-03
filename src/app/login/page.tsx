// Halaman Login. Server component: baca daftar pengguna aktif, render form.
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSesi } from "@/lib/auth";
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
    <div className="min-h-screen bg-[#fff9ef] flex flex-col">
      <header className="w-full py-6 px-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-[#133B63] text-white flex items-center justify-center font-bold">
            S
          </div>
          <span className="font-[Outfit] font-bold text-[#002546]">Solemate Shoes Clean</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md bg-[#f9f3ea] rounded-3xl p-6 sm:p-10 shadow-xl">
          <div className="text-center mb-6">
            <h1 className="font-[Outfit] text-2xl font-bold text-[#002546]">Masuk ke Sistem</h1>
            <p className="text-sm text-[#635E54] mt-1">
              Masuk untuk mengelola pesanan &amp; operasional laundry sepatu.
            </p>
          </div>

          {pengguna.length === 0 ? (
            <p className="text-center text-sm text-[#635E54]">
              Belum ada akun. Hubungi Owner untuk membuat akun.
            </p>
          ) : (
            <LoginForm pengguna={pengguna} />
          )}
        </div>
      </main>
    </div>
  );
}
