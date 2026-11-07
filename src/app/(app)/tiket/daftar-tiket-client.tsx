"use client";

// Tampilan Daftar Tiket Pesanan (Phase 5A).
// Filter dan paginasi bekerja lewat query string URL yang divalidasi di server.
// Badge status bersifat hanya-baca (ubah status ada di Phase 5B).
// Tautan WhatsApp (wa.me) hanya ditampilkan untuk Kasir (PRD bagian 3 & 7.3).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HasilDaftarTiket, RingkasanTiket } from "@/lib/tiket";
import {
  MAKS_PANJANG_CARI,
  UKURAN_HALAMAN_DEFAULT,
  type PeriodeFilterTiket,
} from "@/config/tiket";
import { buatPesanWaTiket, buatUrlWaMe } from "@/lib/nomor-wa";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { Ikon } from "@/components/ikon";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  type DataTableColumn,
  EmptyState,
  FilterBar,
  FilterChip,
  Input,
  PageHeader,
  Pagination,
} from "@/components/ui";

export interface FilterAktifUi {
  periode: PeriodeFilterTiket;
  dari: string;
  sampai: string;
  belumBayarDiAtas: boolean;
  cari: string;
  ukuran: number;
}

export interface DaftarTiketClientProps {
  peran: "owner" | "kasir";
  hariIniWib: string;
  galatAwal: string | null;
  filterAktif: FilterAktifUi;
  hasil: HasilDaftarTiket;
}

const OPSI_PERIODE: { kode: PeriodeFilterTiket; label: string }[] = [
  { kode: "semua", label: "Semua" },
  { kode: "hari_ini", label: "Hari ini" },
  { kode: "kemarin", label: "Kemarin" },
  { kode: "7_hari", label: "7 hari terakhir" },
  { kode: "rentang", label: "Rentang tanggal" },
];

function susunHrefDaftar(param: {
  periode: PeriodeFilterTiket;
  dari: string;
  sampai: string;
  belumBayarDiAtas: boolean;
  cari: string;
  halaman: number;
  ukuran: number;
}): string {
  const qs = new URLSearchParams();
  if (param.periode !== "semua") {
    qs.set("periode", param.periode);
  }
  if (param.periode === "rentang") {
    if (param.dari) qs.set("dari", param.dari);
    if (param.sampai) qs.set("sampai", param.sampai);
  }
  if (param.belumBayarDiAtas) {
    qs.set("belum_bayar", "1");
  }
  const cariBersih = param.cari.trim();
  if (cariBersih.length > 0) {
    qs.set("cari", cariBersih);
  }
  if (param.halaman > 1) {
    qs.set("halaman", String(param.halaman));
  }
  if (param.ukuran !== UKURAN_HALAMAN_DEFAULT) {
    qs.set("ukuran", String(param.ukuran));
  }
  const str = qs.toString();
  return str.length > 0 ? `/tiket?${str}` : "/tiket";
}

export function DaftarTiketClient({
  peran,
  hariIniWib,
  galatAwal,
  filterAktif,
  hasil,
}: DaftarTiketClientProps) {
  const router = useRouter();
  const [sedangNavigasi, mulaiTransisi] = React.useTransition();

  const [inputCari, setInputCari] = React.useState(filterAktif.cari);
  const [tampilPanelRentang, setTampilPanelRentang] = React.useState(
    filterAktif.periode === "rentang"
  );
  const [inputDari, setInputDari] = React.useState(filterAktif.dari || hariIniWib);
  const [inputSampai, setInputSampai] = React.useState(filterAktif.sampai || hariIniWib);
  const [galatRentangLokal, setGalatRentangLokal] = React.useState<string | null>(null);

  const bolehKontakWa = peran === "kasir";
  const bolehBuatTiket = peran === "kasir";

  function navigasiKe(href: string) {
    mulaiTransisi(() => {
      router.push(href);
    });
  }

  function pilihPeriode(kode: PeriodeFilterTiket) {
    setGalatRentangLokal(null);
    if (kode === "rentang") {
      setTampilPanelRentang(true);
      return;
    }
    setTampilPanelRentang(false);
    navigasiKe(
      susunHrefDaftar({
        periode: kode,
        dari: "",
        sampai: "",
        belumBayarDiAtas: filterAktif.belumBayarDiAtas,
        cari: inputCari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  function terapkanRentang(e: React.FormEvent) {
    e.preventDefault();
    if (!inputDari || !inputSampai) {
      setGalatRentangLokal("Pilih tanggal awal dan tanggal akhir terlebih dahulu.");
      return;
    }
    if (inputDari > inputSampai) {
      setGalatRentangLokal("Tanggal awal tidak boleh melebihi tanggal akhir.");
      return;
    }
    setGalatRentangLokal(null);
    navigasiKe(
      susunHrefDaftar({
        periode: "rentang",
        dari: inputDari,
        sampai: inputSampai,
        belumBayarDiAtas: filterAktif.belumBayarDiAtas,
        cari: inputCari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  function toggleBelumBayar() {
    navigasiKe(
      susunHrefDaftar({
        periode: filterAktif.periode,
        dari: filterAktif.dari,
        sampai: filterAktif.sampai,
        belumBayarDiAtas: !filterAktif.belumBayarDiAtas,
        cari: filterAktif.cari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  function kirimCari(e: React.FormEvent) {
    e.preventDefault();
    navigasiKe(
      susunHrefDaftar({
        periode: filterAktif.periode,
        dari: filterAktif.dari,
        sampai: filterAktif.sampai,
        belumBayarDiAtas: filterAktif.belumBayarDiAtas,
        cari: inputCari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  const adaFilterAktif =
    filterAktif.periode !== "semua" ||
    filterAktif.belumBayarDiAtas ||
    filterAktif.cari.length > 0 ||
    Boolean(galatAwal);

  function renderAksiBaris(t: RingkasanTiket) {
    const pesanWa = buatPesanWaTiket({
      kodeTiket: t.kode_tiket,
      namaPelanggan: t.pelanggan.nama,
      statusPesanan: t.status_pesanan,
      statusBayar: t.status_bayar,
      totalRupiah: formatRupiah(t.total),
    });

    let urlWa: string | null = null;
    if (bolehKontakWa) {
      try {
        urlWa = buatUrlWaMe(t.pelanggan.nomor_wa, pesanWa);
      } catch {
        urlWa = null;
      }
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        {bolehKontakWa && urlWa && (
          <a
            href={urlWa}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Hubungi ${t.pelanggan.nama} lewat WhatsApp untuk tiket ${t.kode_tiket}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border-card bg-surface-subtle px-3.5 py-2 font-outfit text-xs font-semibold text-primary hover:bg-surface-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Ikon name="message_circle" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>WhatsApp</span>
          </a>
        )}
        <Link
          href={`/tiket/${t.id}`}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border-card bg-surface-card px-3.5 py-2 font-outfit text-xs font-semibold text-text-main hover:bg-surface-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <span>Detail</span>
        </Link>
      </div>
    );
  }

  const kolomTabel: DataTableColumn<RingkasanTiket>[] = [
    {
      key: "kode",
      header: "Kode Tiket",
      render: (t) => (
        <div className="flex flex-col gap-1">
          <Link
            href={`/tiket/${t.id}`}
            className="font-outfit font-bold text-primary hover:underline"
          >
            {t.kode_tiket}
          </Link>
          <span className="font-jakarta text-xs text-text-muted">
            {t.sumber === "wa" ? "WhatsApp" : "Toko"}
          </span>
        </div>
      ),
    },
    {
      key: "pelanggan",
      header: "Pelanggan",
      render: (t) => (
        <div className="flex flex-col gap-0.5 max-w-xs">
          <span className="font-semibold text-text-main break-words">
            {t.pelanggan.nama}
          </span>
          <span className="text-xs text-text-muted">{t.pelanggan.nomor_wa}</span>
        </div>
      ),
    },
    {
      key: "barang",
      header: "Barang",
      render: (t) => (
        <div className="flex flex-col gap-0.5 max-w-xs">
          <span className="font-medium text-text-body">{t.jumlah_pasang} pasang</span>
          <span className="text-xs text-text-muted truncate" title={t.ringkasan_layanan}>
            {t.ringkasan_layanan || `${t.jumlah_item} baris`}
          </span>
        </div>
      ),
    },
    {
      key: "jadwal",
      header: "Jadwal (WIB)",
      render: (t) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="text-text-body">
            Masuk: {formatTanggal(t.tanggal_masuk, { ringkas: true, denganWaktu: true })}
          </span>
          <span className="text-text-muted">
            Estimasi: {t.estimasi_selesai ? formatTanggal(t.estimasi_selesai, { ringkas: true }) : "-"}
          </span>
        </div>
      ),
    },
    {
      key: "status_pesanan",
      header: "Status Pesanan",
      render: (t) => <Badge variant="pesanan" statusPesanan={t.status_pesanan} />,
    },
    {
      key: "status_bayar",
      header: "Pembayaran",
      render: (t) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="bayar" statusBayar={t.status_bayar} />
          {t.metode_bayar && (
            <span className="text-xs text-text-muted">{t.metode_bayar}</span>
          )}
        </div>
      ),
    },
    {
      key: "total",
      header: "Total",
      render: (t) => (
        <span className="font-outfit font-bold text-text-main whitespace-nowrap">
          {formatRupiah(t.total)}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "Aksi",
      render: (t) => renderAksiBaris(t),
    },
  ];

  const buatHrefHalaman = (halamanTarget: number) =>
    susunHrefDaftar({
      periode: filterAktif.periode,
      dari: filterAktif.dari,
      sampai: filterAktif.sampai,
      belumBayarDiAtas: filterAktif.belumBayarDiAtas,
      cari: filterAktif.cari,
      halaman: halamanTarget,
      ukuran: filterAktif.ukuran,
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Daftar Tiket Pesanan"
        description="Lihat seluruh tiket cucian sepatu masuk dari semua status pengerjaan dan pembayaran."
        badge={
          peran === "owner" ? (
            <Badge variant="default">Hanya lihat</Badge>
          ) : undefined
        }
        actions={
          bolehBuatTiket ? (
            <Link
              href="/buat-tiket"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 font-outfit text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Ikon name="add_circle" size={18} className="h-4 w-4" aria-hidden="true" />
              Buat Tiket Baru
            </Link>
          ) : undefined
        }
      />

      <FilterBar>
        {/* Baris segmen periode + tombol prioritas Belum bayar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div
            role="group"
            aria-label="Filter periode tanggal masuk"
            className="flex flex-wrap items-center gap-2"
          >
            {OPSI_PERIODE.map((opsi) => {
              const sedangAktif =
                opsi.kode === "rentang"
                  ? tampilPanelRentang || filterAktif.periode === "rentang"
                  : !tampilPanelRentang && filterAktif.periode === opsi.kode;
              return (
                <FilterChip
                  key={opsi.kode}
                  active={sedangAktif}
                  disabled={sedangNavigasi}
                  onClick={() => pilihPeriode(opsi.kode)}
                >
                  {opsi.label}
                </FilterChip>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={filterAktif.belumBayarDiAtas}
              disabled={sedangNavigasi}
              onClick={toggleBelumBayar}
            >
              <span>Belum bayar di atas</span>
            </FilterChip>
          </div>
        </div>

        {/* Panel input rentang tanggal bebas (muncul bila Rentang tanggal dipilih) */}
        {tampilPanelRentang && (
          <form
            onSubmit={terapkanRentang}
            className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-2xl border border-border-warm bg-surface-canvas p-4"
            noValidate
          >
            <div className="flex-1">
              <Input
                label="Dari Tanggal (WIB)"
                type="date"
                required
                value={inputDari}
                onChange={(e) => setInputDari(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Input
                label="Sampai Tanggal (WIB)"
                type="date"
                required
                value={inputSampai}
                onChange={(e) => setInputSampai(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" loading={sedangNavigasi}>
              Terapkan Rentang
            </Button>
            {galatRentangLokal && (
              <p role="alert" className="w-full font-jakarta text-xs font-medium text-danger">
                {galatRentangLokal}
              </p>
            )}
          </form>
        )}

        {/* Baris pencarian kode tiket / nama / nomor WhatsApp */}
        <form onSubmit={kirimCari} className="flex flex-col sm:flex-row gap-3" noValidate>
          <div className="flex-1">
            <Input
              aria-label="Cari kode tiket, nama pelanggan, atau nomor WhatsApp"
              placeholder="Cari kode tiket, nama pelanggan, atau nomor WhatsApp..."
              maxLength={MAKS_PANJANG_CARI}
              value={inputCari}
              onChange={(e) => setInputCari(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary" loading={sedangNavigasi}>
              <Ikon name="search" size={16} className="h-4 w-4" aria-hidden="true" />
              Cari
            </Button>
            {adaFilterAktif && (
              <Button
                variant="ghost"
                disabled={sedangNavigasi}
                onClick={() => {
                  setInputCari("");
                  setTampilPanelRentang(false);
                  navigasiKe("/tiket");
                }}
              >
                Reset Filter
              </Button>
            )}
          </div>
        </form>

        {filterAktif.belumBayarDiAtas && (
          <p className="font-jakarta text-xs text-text-muted">
            Urutan aktif: tiket berstatus <strong>Belum bayar</strong> ditempatkan paling atas lintas halaman.
          </p>
        )}
      </FilterBar>

      {galatAwal ? (
        <div
          role="alert"
          className="rounded-3xl border border-danger bg-danger-light p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div className="flex items-start gap-3 text-danger">
            <Ikon
              name="alert_triangle"
              size={22}
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-outfit text-base font-bold">
                Filter Tidak Dapat Diproses
              </h2>
              <p className="font-jakarta text-sm mt-0.5">{galatAwal}</p>
            </div>
          </div>
          <Link
            href="/tiket"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-2xl bg-surface-card px-4 py-2 font-outfit text-sm font-semibold text-primary border border-border-card hover:bg-surface-hover transition-all"
          >
            Reset ke Semua Tiket
          </Link>
        </div>
      ) : (
        <>
          <DataTable
            caption="Daftar tiket pesanan cucian sepatu"
            columns={kolomTabel}
            data={hasil.data}
            rowKey={(t) => t.id}
            loading={sedangNavigasi}
            emptyState={
              <EmptyState
                icon="inbox"
                title={
                  adaFilterAktif
                    ? "Tidak Ada Tiket yang Sesuai Filter"
                    : "Belum Ada Tiket Pesanan"
                }
                description={
                  adaFilterAktif
                    ? "Coba ubah periode tanggal, kata pencarian, atau reset filter untuk melihat seluruh tiket."
                    : "Tiket pesanan toko maupun WhatsApp yang tercatat akan muncul di halaman ini."
                }
                action={
                  adaFilterAktif ? (
                    <Button variant="secondary" onClick={() => navigasiKe("/tiket")}>
                      Reset Filter
                    </Button>
                  ) : bolehBuatTiket ? (
                    <Link
                      href="/buat-tiket"
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 font-outfit text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
                    >
                      Buat Tiket Baru
                    </Link>
                  ) : undefined
                }
              />
            }
            renderMobileCard={(t) => (
              <Card>
                <CardContent className="p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/tiket/${t.id}`}
                        className="font-outfit text-base font-bold text-primary hover:underline"
                      >
                        {t.kode_tiket}
                      </Link>
                      <p className="font-jakarta text-xs text-text-muted">
                        Sumber: {t.sumber === "wa" ? "WhatsApp" : "Toko"}
                      </p>
                    </div>
                    <span className="font-outfit text-base font-extrabold text-text-main">
                      {formatRupiah(t.total)}
                    </span>
                  </div>

                  <div className="font-jakarta text-sm">
                    <p className="font-semibold text-text-main break-words">
                      {t.pelanggan.nama}
                    </p>
                    <p className="text-xs text-text-muted">{t.pelanggan.nomor_wa}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="pesanan" statusPesanan={t.status_pesanan} />
                    <Badge variant="bayar" statusBayar={t.status_bayar} />
                  </div>

                  <div className="rounded-2xl bg-surface-subtle p-3 font-jakarta text-xs text-text-body flex flex-col gap-1">
                    <span>
                      <strong>{t.jumlah_pasang} pasang</strong> · {t.ringkasan_layanan}
                    </span>
                    <span className="text-text-muted">
                      Masuk: {formatTanggal(t.tanggal_masuk, { ringkas: true, denganWaktu: true })}
                    </span>
                  </div>

                  {renderAksiBaris(t)}
                </CardContent>
              </Card>
            )}
          />

          <Pagination
            halaman={hasil.paginasi.halaman}
            totalHalaman={hasil.paginasi.total_halaman}
            totalData={hasil.paginasi.total_data}
            ukuran={hasil.paginasi.ukuran}
            buatHref={buatHrefHalaman}
            sedangMemuat={sedangNavigasi}
            labelSatuan="tiket"
          />
        </>
      )}
    </div>
  );
}
