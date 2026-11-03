// Komponen penolakan akses (dipakai halaman yang gagal cek peran).
import Link from "next/link";

export function AksesDitolak() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-full bg-[#ffdad6] text-[#ba1a1a] flex items-center justify-center mb-4">
        <span className="material-symbols-outlined text-[32px]">block</span>
      </div>
      <h1 className="font-[Outfit] text-2xl font-bold text-[#002546]">Akses ditolak</h1>
      <p className="text-[#635E54] mt-2 max-w-md">
        Halaman ini hanya untuk peran lain. Kembali ke Dashboard atau hubungi Owner.
      </p>
      <Link
        href="/"
        className="mt-6 px-6 py-2.5 rounded-full bg-[#133B63] text-white text-sm font-bold hover:bg-[#0c3b64]"
      >
        Ke Dashboard
      </Link>
    </div>
  );
}
