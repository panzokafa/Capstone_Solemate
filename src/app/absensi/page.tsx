// Absensi — bisa diakses TANPA login (dari link di halaman Login).
// Fitur clock-in/clock-out dibangun di fase absensi; di sini hanya kerangka publik.
export default function AbsensiPage() {
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
        <div className="w-full max-w-md bg-[#f9f3ea] rounded-3xl p-8 shadow-xl text-center">
          <h1 className="font-[Outfit] text-2xl font-bold text-[#002546]">Absensi</h1>
          <p className="text-sm text-[#635E54] mt-2">
            Halaman absensi (clock-in / clock-out dengan PIN pribadi) dibangun di fase absensi.
          </p>
          <a
            href="/login"
            className="inline-block mt-6 px-6 py-2.5 rounded-full bg-[#133B63] text-white text-sm font-bold hover:bg-[#0c3b64]"
          >
            Kembali ke Login
          </a>
        </div>
      </main>
    </div>
  );
}
