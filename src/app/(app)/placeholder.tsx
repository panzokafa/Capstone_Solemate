// Placeholder halaman sampai fiturnya dibangun di fase berikutnya.
export function Placeholder({ judul, catatan }: { judul: string; catatan?: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="font-[Outfit] text-3xl font-extrabold text-[#002546]">{judul}</h1>
      <p className="text-[#635E54] mt-2">
        {catatan ??
          "Halaman sementara. Fitur ini dibangun pada fase berikutnya."}
      </p>
      <div className="mt-6 bg-white rounded-3xl border border-[#ede5d8] p-6 text-sm text-[#635E54]">
        Halaman ini sudah terlindungi pemeriksaan peran di server.
      </div>
    </div>
  );
}
