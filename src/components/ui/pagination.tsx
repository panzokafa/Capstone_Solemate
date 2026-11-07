// Komponen Pagination Solemate Design System.
// Mendukung tautan query string (<Link>) maupun callback tombol dengan target tap >= 44px.
import * as React from "react";
import Link from "next/link";
import { Ikon } from "@/components/ikon";

export interface PaginationProps {
  halaman: number;
  totalHalaman: number;
  totalData: number;
  ukuran: number;
  buatHref?: (halamanTarget: number) => string;
  onPilihHalaman?: (halamanTarget: number) => void;
  sedangMemuat?: boolean;
  labelSatuan?: string;
  className?: string;
}

function susunNomorHalaman(halaman: number, totalHalaman: number): (number | "elipsis")[] {
  if (totalHalaman <= 7) {
    return Array.from({ length: totalHalaman }, (_, i) => i + 1);
  }
  const hasil: (number | "elipsis")[] = [1];
  const kiri = Math.max(2, halaman - 1);
  const kanan = Math.min(totalHalaman - 1, halaman + 1);

  if (kiri > 2) hasil.push("elipsis");
  for (let p = kiri; p <= kanan; p++) {
    hasil.push(p);
  }
  if (kanan < totalHalaman - 1) hasil.push("elipsis");
  hasil.push(totalHalaman);
  return hasil;
}

export function Pagination({
  halaman,
  totalHalaman,
  totalData,
  ukuran,
  buatHref,
  onPilihHalaman,
  sedangMemuat = false,
  labelSatuan = "tiket",
  className = "",
}: PaginationProps) {
  if (totalData <= 0) return null;

  const indeksAwal = Math.min(totalData, (halaman - 1) * ukuran + 1);
  const indeksAkhir = Math.min(totalData, halaman * ukuran);
  const daftarNomor = susunNomorHalaman(halaman, totalHalaman);

  const kelasDasar =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-2xl px-3.5 py-2 font-outfit text-sm font-semibold transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none";
  const kelasBiasa =
    "bg-surface-card text-text-body border border-border-card hover:bg-surface-hover";
  const kelasAktif = "bg-primary text-white shadow-xs";
  const kelasNonaktif =
    "bg-surface-subtle text-text-muted/60 border border-border-warm pointer-events-none opacity-60";

  function renderItemNavigasi(
    target: number,
    isi: React.ReactNode,
    aktif: boolean,
    nonaktif: boolean,
    ariaLabel: string
  ) {
    if (nonaktif || sedangMemuat) {
      return (
        <span
          aria-disabled="true"
          aria-label={ariaLabel}
          className={`${kelasDasar} ${aktif ? kelasAktif : kelasNonaktif}`}
        >
          {isi}
        </span>
      );
    }

    if (onPilihHalaman) {
      return (
        <button
          type="button"
          aria-current={aktif ? "page" : undefined}
          aria-label={ariaLabel}
          onClick={() => onPilihHalaman(target)}
          className={`${kelasDasar} ${aktif ? kelasAktif : kelasBiasa} cursor-pointer`}
        >
          {isi}
        </button>
      );
    }

    if (buatHref) {
      return (
        <Link
          href={buatHref(target)}
          aria-current={aktif ? "page" : undefined}
          aria-label={ariaLabel}
          className={`${kelasDasar} ${aktif ? kelasAktif : kelasBiasa}`}
        >
          {isi}
        </Link>
      );
    }

    return (
      <span
        aria-current={aktif ? "page" : undefined}
        className={`${kelasDasar} ${aktif ? kelasAktif : kelasBiasa}`}
      >
        {isi}
      </span>
    );
  }

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-3xl border border-border-card bg-surface-card px-5 py-3.5 ${className}`}
    >
      <p className="font-jakarta text-xs sm:text-sm text-text-muted">
        Menampilkan <span className="font-semibold text-text-main">{indeksAwal}</span>–
        <span className="font-semibold text-text-main">{indeksAkhir}</span> dari{" "}
        <span className="font-semibold text-text-main">{totalData}</span> {labelSatuan}
      </p>

      {totalHalaman > 1 && (
        <nav aria-label="Navigasi halaman" className="flex flex-wrap items-center gap-2">
          {renderItemNavigasi(
            halaman - 1,
            <>
              <Ikon name="chevron_left" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Sebelumnya</span>
            </>,
            false,
            halaman <= 1,
            "Halaman sebelumnya"
          )}

          {daftarNomor.map((item, idx) =>
            item === "elipsis" ? (
              <span
                key={`elipsis-${idx}`}
                aria-hidden="true"
                className="px-2 font-outfit text-sm text-text-muted select-none"
              >
                …
              </span>
            ) : (
              <React.Fragment key={item}>
                {renderItemNavigasi(
                  item,
                  item,
                  item === halaman,
                  false,
                  `Halaman ${item}`
                )}
              </React.Fragment>
            )
          )}

          {renderItemNavigasi(
            halaman + 1,
            <>
              <span>Berikutnya</span>
              <Ikon name="chevron_right" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
            </>,
            false,
            halaman >= totalHalaman,
            "Halaman berikutnya"
          )}
        </nav>
      )}
    </div>
  );
}
