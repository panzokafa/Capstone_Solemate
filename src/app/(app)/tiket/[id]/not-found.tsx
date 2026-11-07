// Halaman 404 khusus rute Detail Tiket (/tiket/[id]).
import Link from "next/link";
import { Ikon } from "@/components/ikon";
import { Card, CardContent } from "@/components/ui";

export default function TiketTidakDitemukan() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12 text-center">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-primary mb-1">
            <Ikon
              name="confirmation_number"
              size={30}
              className="h-8 w-8 shrink-0"
              aria-hidden="true"
            />
          </div>
          <h1 className="font-outfit text-2xl font-bold text-text-main">
            Tiket Tidak Ditemukan
          </h1>
          <p className="font-jakarta text-sm text-text-muted leading-relaxed">
            Tiket pesanan yang Anda cari tidak tersedia atau nomor identifikasi tiket tidak valid.
          </p>
          <Link
            href="/tiket"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 font-outfit text-sm font-bold text-white hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Ikon name="arrow_left" size={16} className="h-4 w-4" aria-hidden="true" />
            Kembali ke Daftar Tiket
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
