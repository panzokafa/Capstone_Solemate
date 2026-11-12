"use client";

// Komponen interaktif Laporan Harian Operasional (Phase 7A, FR-40 - FR-44).
// Menampilkan kartu ringkasan, rincian pembayaran, dan riwayat pembatalan/pembalikan.
// Tanpa tombol cetak/ekspor, tanpa nama pelanggan atau daftar per tiket.

import * as React from "react";
import { useRouter } from "next/navigation";
import type { DataLaporanHarian } from "@/lib/laporan.ts";
import { formatRupiah, formatTanggal } from "@/lib/format.ts";
import { Ikon } from "@/components/ikon.tsx";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  FilterBar,
  FilterChip,
  Input,
  PageHeader,
} from "@/components/ui/index.ts";

export interface LaporanHarianClientProps {
  data: DataLaporanHarian;
  galatQuery?: string | null;
}

export function LaporanHarianClient({ data, galatQuery }: LaporanHarianClientProps) {
  const router = useRouter();

  const [periode, setPeriode] = React.useState<"hari_ini" | "kemarin" | "rentang">(
    data.periode
  );
  const [dari, setDari] = React.useState(data.rentang.dari);
  const [sampai, setSampai] = React.useState(data.rentang.sampai);
  const [galatForm, setGalatForm] = React.useState<string | null>(galatQuery ?? null);

  const navigasikan = React.useCallback(
    (targetPeriode: "hari_ini" | "kemarin" | "rentang", d?: string, s?: string) => {
      setGalatForm(null);
      if (targetPeriode === "rentang") {
        const valDari = d ?? dari;
        const valSampai = s ?? sampai;
        if (!valDari || !valSampai) {
          setGalatForm("Tanggal awal dan akhir wajib diisi.");
          return;
        }
        if (valDari > valSampai) {
          setGalatForm("Tanggal awal tidak boleh melebihi tanggal akhir.");
          return;
        }
        router.push(`/laporan-harian?periode=rentang&dari=${valDari}&sampai=${valSampai}`);
      } else {
        router.push(`/laporan-harian?periode=${targetPeriode}`);
      }
    },
    [dari, sampai, router]
  );

  function handlePilihPeriode(p: "hari_ini" | "kemarin" | "rentang") {
    setPeriode(p);
    if (p !== "rentang") {
      navigasikan(p);
    }
  }

  function handleTerapkanRentang(e: React.FormEvent) {
    e.preventDefault();
    navigasikan("rentang", dari, sampai);
  }

  const rentangTeks = React.useMemo(() => {
    if (data.periode === "hari_ini") {
      return `Hari ini (${formatTanggal(data.rentang.dari)})`;
    }
    if (data.periode === "kemarin") {
      return `Kemarin (${formatTanggal(data.rentang.dari)})`;
    }
    if (data.rentang.dari === data.rentang.sampai) {
      return formatTanggal(data.rentang.dari);
    }
    return `${formatTanggal(data.rentang.dari)} – ${formatTanggal(data.rentang.sampai)}`;
  }, [data.periode, data.rentang]);

  const pm = data.pesanan_masuk;
  const pb = data.pembayaran_diterima;
  const au = data.audit_aktivitas;

  return (
    <div className="flex flex-col gap-6 font-jakarta pb-12">
      <PageHeader
        title="Laporan Harian Operasional"
        description="Ringkasan penerimaan kasir, volume fisik sepatu masuk, dan pembayaran."
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary">Dihitung otomatis dari data tiket</Badge>
            <Badge variant="default">Hanya-baca</Badge>
          </div>
        }
      />

      {/* Disclaimer Keterbatasan Perhitungan Sekarang */}
      <div className="rounded-2xl border border-border-card bg-surface-canvas p-4 flex items-start gap-3 text-xs text-text-muted">
        <Ikon name="event_note" size={18} className="h-4.5 w-4.5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold text-text-main">
            Periode Laporan: {rentangTeks}
          </p>
          <p className="mt-0.5">{data.disclaimer}</p>
        </div>
      </div>

      {galatForm && (
        <div
          role="alert"
          className="rounded-2xl border border-danger bg-danger-light p-4 text-xs font-medium text-danger flex items-center gap-2"
        >
          <Ikon name="alert_triangle" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{galatForm}</span>
        </div>
      )}

      {/* Bar Pemilih Periode */}
      <FilterBar>
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={periode === "hari_ini"}
              onClick={() => handlePilihPeriode("hari_ini")}
            >
              Hari ini
            </FilterChip>
            <FilterChip
              active={periode === "kemarin"}
              onClick={() => handlePilihPeriode("kemarin")}
            >
              Kemarin
            </FilterChip>
            <FilterChip
              active={periode === "rentang"}
              onClick={() => handlePilihPeriode("rentang")}
            >
              Rentang tanggal
            </FilterChip>
          </div>

          {periode === "rentang" && (
            <form
              onSubmit={handleTerapkanRentang}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <Input
                type="date"
                label=""
                value={dari}
                max={sampai || undefined}
                onChange={(e) => setDari(e.target.value)}
                className="h-9 min-h-[36px] text-xs py-1"
                aria-label="Tanggal awal"
              />
              <span className="text-text-muted">s/d</span>
              <Input
                type="date"
                label=""
                value={sampai}
                min={dari || undefined}
                onChange={(e) => setSampai(e.target.value)}
                className="h-9 min-h-[36px] text-xs py-1"
                aria-label="Tanggal akhir"
              />
              <Button type="submit" size="sm" variant="primary">
                Terapkan
              </Button>
            </form>
          )}
        </div>
      </FilterBar>

      {/* 4 Kartu Metrik Utama (FR-42) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metrik 1: Volume Fisik Sepatu Masuk */}
        <Card className="flex flex-col justify-between border-t-4 border-t-primary">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Volume Fisik Sepatu
            </span>
            <CardTitle className="text-sm font-semibold text-text-main mt-0.5">
              Sepatu Masuk
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-outfit font-extrabold text-3xl text-primary leading-none">
                {pm.total_pasang}
              </span>
              <span className="text-sm font-medium text-text-muted">Pasang</span>
            </div>
            <div className="pt-3 mt-3 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>{pm.total_tiket} Tiket Masuk</span>
              <span className="font-semibold text-text-main">
                {formatRupiah(pm.total_nominal)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Metrik 2: Sudah Bayar (Lunas) */}
        <Card className="flex flex-col justify-between border-t-4 border-t-status-lunas-text">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Penerimaan Masuk
            </span>
            <CardTitle className="text-sm font-semibold text-text-main mt-0.5">
              Sudah Lunas
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-outfit font-extrabold text-2xl text-status-lunas-text leading-none">
                {formatRupiah(pm.lunas.total_nominal)}
              </span>
            </div>
            <div className="pt-3 mt-3 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>{pm.lunas.total_tiket} Tiket Lunas</span>
              <span className="font-medium text-text-main">
                {pm.lunas.total_pasang} Pasang
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Metrik 3: Belum Bayar (Utang / Piutang) */}
        <Card className="flex flex-col justify-between border-t-4 border-t-danger">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-danger">
              Tertunda & Piutang
            </span>
            <CardTitle className="text-sm font-semibold text-text-main mt-0.5">
              Belum Bayar
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-outfit font-extrabold text-2xl text-danger leading-none">
                {formatRupiah(pm.belum_bayar.total_nominal)}
              </span>
            </div>
            <div className="pt-3 mt-3 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>{pm.belum_bayar.total_tiket} Tiket Tertunda</span>
              <span className="font-medium text-text-main">
                {pm.belum_bayar.total_pasang} Pasang
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Metrik 4: Total Omset Agregat Masuk */}
        <Card className="flex flex-col justify-between border-t-4 border-t-primary-dark bg-surface-canvas">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Nilai Pesanan Masuk
            </span>
            <CardTitle className="text-sm font-semibold text-text-main mt-0.5">
              Total Nominal Masuk
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-outfit font-extrabold text-2xl text-primary-dark leading-none">
                {formatRupiah(pm.total_nominal)}
              </span>
            </div>
            <div className="pt-3 mt-3 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>Akumulasi Lunas & Belum</span>
              <span className="font-bold text-primary">
                {pm.total_pasang > 0
                  ? `${formatRupiah(Math.round(pm.total_nominal / pm.total_pasang))} / psg`
                  : "-"}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Rincian Pembayaran Diterima Menurut Tanggal Bayar (FR-43) */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Kolom 1: Uang Tunai / Cash di Toko */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ikon name="fact_check" size={20} className="text-primary shrink-0" aria-hidden="true" />
                <CardTitle className="text-base font-bold text-text-main">
                  Uang Tunai / Cash di Toko
                </CardTitle>
              </div>
              <Badge variant="primary">{pb.cash.label}</Badge>
            </div>
            <CardDescription>
              Penerimaan pembayaran cash yang masuk pada periode ini (menurut tanggal bayar).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline justify-between py-3 border-b border-border-warm">
              <span className="text-xs text-text-muted">Total Cash Diterima</span>
              <span className="font-outfit font-extrabold text-2xl text-primary">
                {formatRupiah(pb.cash.total_nominal)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 text-xs text-text-muted">
              <span>Jumlah Tiket Cash</span>
              <span className="font-bold text-text-main">{pb.cash.total_tiket} Tiket</span>
            </div>
          </CardContent>
        </Card>

        {/* Kolom 2: Non-Cash / Digital Payment */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ikon name="confirmation_number" size={20} className="text-primary shrink-0" aria-hidden="true" />
                <CardTitle className="text-base font-bold text-text-main">
                  Non-Cash / Transfer & QRIS
                </CardTitle>
              </div>
              <Badge variant="default">Digital</Badge>
            </div>
            <CardDescription>
              Penerimaan pembayaran non-tunai yang masuk pada periode ini (menurut tanggal bayar).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline justify-between py-3 border-b border-border-warm">
              <span className="text-xs text-text-muted">Total Non-Cash Diterima</span>
              <span className="font-outfit font-extrabold text-2xl text-primary">
                {formatRupiah(pb.non_cash.total_nominal)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 text-xs text-text-muted">
              <span>Jumlah Tiket Non-Cash</span>
              <span className="font-bold text-text-main">{pb.non_cash.total_tiket} Tiket</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Ringkasan Aktivitas Pembatalan & Pembalikan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Ikon name="history" size={20} className="text-text-muted shrink-0" aria-hidden="true" />
            <CardTitle className="text-base font-bold text-text-main">
              Aktivitas Pembatalan & Pembalikan Status
            </CardTitle>
          </div>
          <CardDescription>
            {au.catatan_asumsi}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border-warm bg-surface-canvas p-3.5 flex flex-col justify-between">
              <span className="text-xs font-semibold text-text-muted">Tiket Dibatalkan</span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-outfit font-bold text-xl text-text-main">
                  {au.tiket_dibatalkan}
                </span>
                <span className="text-xs text-text-muted">Tiket</span>
              </div>
              <span className="text-[11px] text-text-muted mt-1">
                Dibatalkan oleh kasir pada periode ini
              </span>
            </div>

            <div className="rounded-xl border border-border-warm bg-surface-canvas p-3.5 flex flex-col justify-between">
              <span className="text-xs font-semibold text-text-muted">Batal Sempat Lunas</span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-outfit font-bold text-xl text-danger">
                  {au.tiket_batal_setelah_lunas}
                </span>
                <span className="text-xs text-text-muted">Tiket</span>
              </div>
              <span className="text-[11px] text-text-muted mt-1">
                Tiket yang sudah dibayar lalu dibatalkan
              </span>
            </div>

            <div className="rounded-xl border border-border-warm bg-surface-canvas p-3.5 flex flex-col justify-between">
              <span className="text-xs font-semibold text-text-muted">Pembalikan Pembayaran</span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-outfit font-bold text-xl text-text-main">
                  {au.pembalikan_pembayaran}
                </span>
                <span className="text-xs text-text-muted">Kali</span>
              </div>
              <span className="text-[11px] text-text-muted mt-1">
                Koreksi status Lunas → Belum bayar
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
