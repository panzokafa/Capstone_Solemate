"use client";

// Tampilan Daftar Tiket Pesanan (Phase 5A & Phase 5B).
// - Filter periode, pencarian, urutan Belum bayar di atas, dan filter tiket lama belum diambil (FR-17).
// - Kasir dapat mengubah status pesanan & pembayaran langsung di baris serta membatalkan tiket dengan alasan.
// - Owner hanya melihat badge baca-saja tanpa kontrol mutasi & tanpa tautan wa.me.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DetailTiket, HasilDaftarTiket, RingkasanTiket } from "@/lib/tiket";
import {
  bolehBatalkanTiket,
  daftarTargetStatusPesananValid,
  type StatusPesanan,
} from "@/config/order-status";
import {
  MAKS_PANJANG_CARI,
  MIN_HARI_BELUM_DIAMBIL,
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
  Select,
} from "@/components/ui";
import {
  DialogMutasiTiket,
  detailKeRingkasan,
  kirimPatchTiket,
  type HasilPatchKlien,
  type ModeDialogMutasi,
  type TargetTiketRingkas,
} from "./dialog-mutasi-tiket";

export interface FilterAktifUi {
  periode: PeriodeFilterTiket;
  dari: string;
  sampai: string;
  belumBayarDiAtas: boolean;
  belumDiambilLama: boolean;
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
  belumDiambilLama: boolean;
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
  if (param.belumDiambilLama) {
    qs.set("belum_diambil", "1");
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

function keTargetDialog(t: RingkasanTiket): TargetTiketRingkas {
  return {
    id: t.id,
    kode_tiket: t.kode_tiket,
    nama_pelanggan: t.pelanggan.nama,
    total: t.total,
    status_pesanan: t.status_pesanan,
    status_bayar: t.status_bayar,
    metode_bayar: t.metode_bayar,
  };
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

  const [petaPembaruanBaris, setPetaPembaruanBaris] = React.useState<
    Record<number, RingkasanTiket>
  >({});
  const daftarBaris = React.useMemo(
    () => hasil.data.map((b) => petaPembaruanBaris[b.id] ?? b),
    [hasil.data, petaPembaruanBaris]
  );

  const [inputCari, setInputCari] = React.useState(filterAktif.cari);
  const [tampilPanelRentang, setTampilPanelRentang] = React.useState(
    filterAktif.periode === "rentang"
  );
  const [inputDari, setInputDari] = React.useState(filterAktif.dari || hariIniWib);
  const [inputSampai, setInputSampai] = React.useState(filterAktif.sampai || hariIniWib);
  const [galatRentangLokal, setGalatRentangLokal] = React.useState<string | null>(null);

  const [idSedangProses, setIdSedangProses] = React.useState<number | null>(null);
  const [dialogAktif, setDialogAktif] = React.useState<ModeDialogMutasi | null>(null);
  const [infoMutasi, setInfoMutasi] = React.useState<{
    tipe: "sukses" | "galat";
    pesan: string;
    sesiBerakhir?: boolean;
  } | null>(null);

  const bolehUbahTiket = peran === "kasir";
  const bolehKontakWa = peran === "kasir";
  const bolehBuatTiket = peran === "kasir";

  function navigasiKe(href: string) {
    mulaiTransisi(() => {
      router.push(href);
    });
  }

  function perbaruiSatuBarisDariServer(detail: DetailTiket) {
    const ringkasBaru = detailKeRingkasan(detail);
    setPetaPembaruanBaris((lama) => ({
      ...lama,
      [ringkasBaru.id]: ringkasBaru,
    }));
  }

  function tanganiSuksesMutasi(detail: DetailTiket, pesanSukses: string) {
    perbaruiSatuBarisDariServer(detail);
    setInfoMutasi({ tipe: "sukses", pesan: pesanSukses });
  }

  function tanganiGalatMutasi(hasilGagal: Extract<HasilPatchKlien, { ok: false }>) {
    if (hasilGagal.dataTerbaru) {
      perbaruiSatuBarisDariServer(hasilGagal.dataTerbaru);
    }
    setInfoMutasi({
      tipe: "galat",
      pesan: hasilGagal.pesan,
      sesiBerakhir: hasilGagal.sesiBerakhir,
    });
  }

  async function ubahStatusPesananLangsung(t: RingkasanTiket, targetBaru: StatusPesanan) {
    if (!bolehUbahTiket) return;
    if (targetBaru === t.status_pesanan || targetBaru === "Dibatalkan") return;

    if (targetBaru === "Sudah diambil" && t.status_bayar === "Belum bayar") {
      setDialogAktif({
        jenis: "konfirmasi_ambil_belum_bayar",
        tiket: keTargetDialog(t),
      });
      return;
    }

    setInfoMutasi(null);
    setIdSedangProses(t.id);
    try {
      const res = await kirimPatchTiket(t.id, {
        jenis: "status_pesanan",
        status_pesanan: targetBaru,
        status_sebelumnya: t.status_pesanan,
      });
      if (res.ok) {
        tanganiSuksesMutasi(
          res.data,
          `Status tiket ${t.kode_tiket} diperbarui menjadi "${res.data.status_pesanan}".`
        );
      } else {
        tanganiGalatMutasi(res);
      }
    } finally {
      setIdSedangProses(null);
    }
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
        belumDiambilLama: filterAktif.belumDiambilLama,
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
        belumDiambilLama: filterAktif.belumDiambilLama,
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
        belumDiambilLama: filterAktif.belumDiambilLama,
        cari: filterAktif.cari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  function toggleBelumDiambilLama() {
    navigasiKe(
      susunHrefDaftar({
        periode: filterAktif.periode,
        dari: filterAktif.dari,
        sampai: filterAktif.sampai,
        belumBayarDiAtas: filterAktif.belumBayarDiAtas,
        belumDiambilLama: !filterAktif.belumDiambilLama,
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
        belumDiambilLama: filterAktif.belumDiambilLama,
        cari: inputCari,
        halaman: 1,
        ukuran: filterAktif.ukuran,
      })
    );
  }

  const adaFilterAktif =
    filterAktif.periode !== "semua" ||
    filterAktif.belumBayarDiAtas ||
    filterAktif.belumDiambilLama ||
    filterAktif.cari.length > 0 ||
    Boolean(galatAwal);

  function renderLencanaBelumDiambil(t: RingkasanTiket) {
    if (!t.terlambat_ambil || t.hari_belum_diambil === null) return null;
    return (
      <Badge variant="warning">
        <Ikon name="schedule" size={12} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{`${t.hari_belum_diambil} hari belum diambil`}</span>
      </Badge>
    );
  }

  function renderKolomStatusPesanan(t: RingkasanTiket) {
    const sedangProsesBaris = idSedangProses === t.id;
    if (!bolehUbahTiket || t.status_pesanan === "Dibatalkan") {
      return (
        <div className="flex flex-col items-start gap-1.5">
          <Badge variant="pesanan" statusPesanan={t.status_pesanan} />
          {renderLencanaBelumDiambil(t)}
          {t.notifikasi_gagal && (
            <span className="inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold text-danger border border-danger/20">
              <Ikon name="alert_triangle" size={11} className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Notifikasi gagal</span>
            </span>
          )}
        </div>
      );
    }

    const opsiValid = daftarTargetStatusPesananValid(t.status_pesanan);
    return (
      <div className="flex flex-col items-start gap-1.5 min-w-[175px]">
        <Badge variant="pesanan" statusPesanan={t.status_pesanan} />
        {renderLencanaBelumDiambil(t)}
        {t.notifikasi_gagal && (
          <span className="inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold text-danger border border-danger/20">
            <Ikon name="alert_triangle" size={11} className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>Notifikasi gagal</span>
          </span>
        )}
        <Select
          aria-label={`Ubah status pesanan ${t.kode_tiket}`}
          disabled={sedangProsesBaris}
          value={t.status_pesanan}
          onChange={(e) =>
            ubahStatusPesananLangsung(t, e.target.value as StatusPesanan)
          }
          options={opsiValid.map((op) => ({
            label: op.labelPilihan,
            value: op.status,
          }))}
        />
      </div>
    );
  }

  function renderKolomPembayaran(t: RingkasanTiket) {
    const sedangProsesBaris = idSedangProses === t.id;
    return (
      <div className="flex flex-col items-start gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="bayar" statusBayar={t.status_bayar} />
          {t.metode_bayar && (
            <span className="text-xs text-text-muted">({t.metode_bayar})</span>
          )}
        </div>
        {bolehUbahTiket && t.status_pesanan !== "Dibatalkan" && (
          t.status_bayar === "Belum bayar" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={sedangProsesBaris}
              onClick={() =>
                setDialogAktif({
                  jenis: "tandai_lunas",
                  tiket: keTargetDialog(t),
                })
              }
            >
              Tandai Lunas
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={sedangProsesBaris}
              onClick={() =>
                setDialogAktif({
                  jenis: "balik_belum_bayar",
                  tiket: keTargetDialog(t),
                })
              }
            >
              Ubah ke Belum Bayar
            </Button>
          )
        )}
      </div>
    );
  }

  function renderAksiBaris(t: RingkasanTiket) {
    const sedangProsesBaris = idSedangProses === t.id;
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

    const bisaBatal = bolehUbahTiket && bolehBatalkanTiket(t.status_pesanan).boleh;

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
        {bisaBatal && (
          <Button
            size="sm"
            variant="danger"
            disabled={sedangProsesBaris}
            onClick={() =>
              setDialogAktif({
                jenis: "batalkan",
                tiket: keTargetDialog(t),
              })
            }
          >
            Batalkan
          </Button>
        )}
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-text-muted">{t.pelanggan.nomor_wa}</span>
            {t.nomor_terverifikasi === false && (
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 border border-amber-500/20">
                Nomor belum diverifikasi
              </span>
            )}
          </div>
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
      render: (t) => renderKolomStatusPesanan(t),
    },
    {
      key: "status_bayar",
      header: "Pembayaran",
      render: (t) => renderKolomPembayaran(t),
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
      belumDiambilLama: filterAktif.belumDiambilLama,
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

      {infoMutasi && (
        <div
          role={infoMutasi.tipe === "galat" ? "alert" : "status"}
          className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 font-jakarta text-sm ${
            infoMutasi.tipe === "galat"
              ? "border-danger bg-danger-light text-danger"
              : "border-status-lunas-border bg-status-lunas-bg text-status-lunas-text"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Ikon
              name={infoMutasi.tipe === "galat" ? "alert_triangle" : "check_circle"}
              size={18}
              className="h-4 w-4 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>{infoMutasi.pesan}</span>
          </div>
          <div className="flex items-center gap-2">
            {infoMutasi.sesiBerakhir && (
              <Link
                href="/login"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 py-2 font-outfit text-xs font-semibold text-white hover:bg-primary-hover transition-all"
              >
                Masuk Kembali
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setInfoMutasi(null)}
            >
              Tutup
            </Button>
          </div>
        </div>
      )}

      <FilterBar>
        {/* Baris segmen periode + tombol prioritas Belum bayar & filter tiket lama */}
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
              active={filterAktif.belumDiambilLama}
              disabled={sedangNavigasi}
              onClick={toggleBelumDiambilLama}
            >
              <span>Belum diambil ({`>= ${MIN_HARI_BELUM_DIAMBIL}`} hari)</span>
            </FilterChip>
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

        {(filterAktif.belumBayarDiAtas || filterAktif.belumDiambilLama) && (
          <div className="flex flex-col gap-1 font-jakarta text-xs text-text-muted">
            {filterAktif.belumDiambilLama && (
              <p>
                Filter aktif: hanya menampilkan tiket berstatus <strong>Siap diambil</strong> yang sudah{" "}
                <strong>{MIN_HARI_BELUM_DIAMBIL} hari kalender atau lebih</strong> belum diambil (zona Asia/Jakarta).
              </p>
            )}
            {filterAktif.belumBayarDiAtas && (
              <p>
                Urutan aktif: tiket berstatus <strong>Belum bayar</strong> ditempatkan paling atas lintas halaman.
              </p>
            )}
          </div>
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
            data={daftarBaris}
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

                  <div className="flex flex-col gap-3">
                    {renderKolomStatusPesanan(t)}
                    {renderKolomPembayaran(t)}
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

      <DialogMutasiTiket
        dialog={dialogAktif}
        sedangMemproses={idSedangProses !== null}
        onTutup={() => setDialogAktif(null)}
        onBerhasil={tanganiSuksesMutasi}
        onKonflikAtauGalat={tanganiGalatMutasi}
        onMulaiProses={(id) => {
          setInfoMutasi(null);
          setIdSedangProses(id);
        }}
        onSelesaiProses={() => setIdSedangProses(null)}
      />
    </div>
  );
}
