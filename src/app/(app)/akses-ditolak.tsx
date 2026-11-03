// Komponen penolakan akses (dipakai halaman yang gagal cek peran).
import Link from "next/link";
import { Ikon } from "@/components/ikon";
import { Card, CardContent } from "@/components/ui/card";

export function AksesDitolak() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 py-12">
      <Card className="max-w-md w-full p-8 flex flex-col items-center shadow-md">
        <CardContent className="flex flex-col items-center p-0">
          <div className="w-16 h-16 rounded-full bg-danger-light text-danger flex items-center justify-center mb-5 shadow-xs">
            <Ikon name="block" size={32} className="w-8 h-8 shrink-0" aria-hidden="true" />
          </div>
          <h1 className="font-outfit text-2xl font-bold text-text-main">
            Akses Ditolak
          </h1>
          <p className="font-jakarta text-sm text-text-muted mt-2 max-w-sm">
            Halaman ini hanya untuk peran yang berwenang. Silakan kembali ke Dashboard atau hubungi Owner.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-full bg-primary text-white text-sm font-outfit font-bold hover:bg-primary-hover active:bg-primary-dark transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Ke Dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
