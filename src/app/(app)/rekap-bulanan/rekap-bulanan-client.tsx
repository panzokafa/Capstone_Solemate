"use client";

// Komponen interaktif Rekap Bulanan (Phase 7B, FR-50, FR-51, FR-52, NFR-07).
// Susunan mengikuti referensi stitch_export dengan gaya @/components/ui & token semantik.
// Responsif penuh untuk ponsel (tabel layanan menjadi kartu di layar kecil).
// Tanpa tombol ekspor/cetak, tanpa nama pelanggan/nomor WA, tanpa daftar per tiket.

import * as React from "react";
import { useRouter } from "next/navigation";
import type { BarisLayananTerlaris, DataRekapBulanan } from "@/lib/laporan.ts";
import { formatRupiah, formatTanggal } from "@/lib/format.ts";
import { Ikon } from "@/components/ikon.tsx";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  FilterBar,
  FilterChip,
  Input,
  PageHeader,
} from "@/components/ui/index.ts";

export interface RekapBulananClientProps {
  data: DataRekapBulanan;
  galatQuery?: string | null;
}

function formatPersen(nilai: number): string {
  const aman = Number.isFinite(nilai) && nilai >= 0 ? nilai : 0;
  return `${aman.toFixed(1).replace(".", ",")}%`;
}

export function RekapBulananClient({ data, galatQuery }: RekapBulananClientProps) {
  const router = useRouter();

  const [periode, setPeriode] = React.useState<"bulan_ini" | "bulan_lalu" | "rentang">(
    data.periode
  );
  const [dari, setDari] = React.useState(data.rentang.dari);
  const [sampai, setSampai] = React.useState(data.rentang.sampai);
  const [galatForm, setGalatForm] = React.useState<string | null>(galatQuery ?? null);

  const navigasikan = React.useCallback(
    (targetPeriode: "bulan_ini" | "bulan_lalu" | "rentang", d?: string, s?: string) => {
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
        router.push(`/rekap-bulanan?periode=rentang&dari=${valDari}&sampai=${valSampai}`);
      } else {
        router.push(`/rekap-bulanan?periode=${targetPeriode}`);
      }
    },
    [dari, sampai, router]
  );

  function handlePilihPeriode(p: "bulan_ini" | "bulan_lalu" | "rentang") {
    setPeriode(p);
    if (p !== "rentang") {
      navigasikan(p);
    }
  }

  function handleTerapkanRentang(e: React.FormEvent) {
    e.preventDefault();
    navigasikan("rentang", dari, sampai);
  }

  const labelRentangAktif = React.useMemo(() => {
    const tglDari = formatTanggal(data.rentang.dari);
    const tglSampai = formatTanggal(data.rentang.sampai);
    const sama = data.rentang.dari === data.rentang.sampai;
    const teksTgl = sama ? tglDari : `${tglDari} – ${tglSampai}`;
    if (data.periode === "bulan_ini") return `Bulan ini (${teksTgl})`;
    if (data.periode === "bulan_lalu") return `Bulan lalu (${teksTgl})`;
    return teksTgl;
  }, [data.periode, data.rentang.dari, data.rentang.sampai]);

  const pm = data.pesanan_masuk;
  const pb = data.pembayaran_diterima;
  const lt = data.layanan_terlaris;

  const persenCash =
    pb.total_nominal > 0 ? Math.round((pb.cash.total_nominal * 1000) / pb.total_nominal) / 10 : 0;
  const persenNonCash = pb.total_nominal > 0 ? Math.max(0, Math.round((100 - persenCash) * 10) / 10) : 0;

  return (
    <div className="flex flex-col gap-6 font-jakarta pb-12">
      <PageHeader
        title="Rekap Bulanan"
        description="Ringkasan operasional, layanan terlaris, dan penerimaan pembayaran per rentang tanggal."
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary">Dihitung otomatis dari data tiket</Badge>
            <Badge variant="default">Hanya-baca</Badge>
          </div>
        }
      />

      {/* Info Rentang Aktif & Disclaimer */}
      <div className="rounded-2xl border border-border-card bg-surface-canvas p-4 flex items-start gap-3 text-xs text-text-muted">
        <Ikon name="calendar_month" size={18} className="h-4.5 w-4.5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold text-text-main">
            Rentang Periode (WIB): {labelRentangAktif}
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

      {/* Bar Pemilih Periode & Pintasan */}
      <FilterBar>
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={periode === "bulan_ini"}
              onClick={() => handlePilihPeriode("bulan_ini")}
            >
              Bulan ini
            </FilterChip>
            <FilterChip
              active={periode === "bulan_lalu"}
              onClick={() => handlePilihPeriode("bulan_lalu")}
            >
              Bulan lalu
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
                className="min-h-[44px] text-xs"
                aria-label="Tanggal awal"
              />
              <span className="text-text-muted">s/d</span>
              <Input
                type="date"
                label=""
                value={sampai}
                min={dari || undefined}
                onChange={(e) => setSampai(e.target.value)}
                className="min-h-[44px] text-xs"
                aria-label="Tanggal akhir"
              />
              <Button type="submit" variant="primary">
                Terapkan
              </Button>
            </form>
          )}
        </div>
      </FilterBar>

      {/* 4 Kartu Ringkasan Utama */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

        <Card className="flex flex-col justify-between border-t-4 border-t-status-lunas-text">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Pesanan Masuk Lunas
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

        <Card className="flex flex-col justify-between border-t-4 border-t-danger">
          <CardHeader className="pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-danger">
              Tertunda &amp; Piutang
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
              <span>Akumulasi Lunas &amp; Belum</span>
              <span className="font-bold text-primary">
                {pm.total_pasang > 0
                  ? `${formatRupiah(Math.round(pm.total_nominal / pm.total_pasang))} / psg`
                  : "-"}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Grid Utama: Layanan Terlaris (Kiri) + Pembayaran & Laba Rugi (Kanan) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Kiri: Layanan Terlaris (FR-51) */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary-light text-primary flex items-center justify-center shrink-0">
                  <Ikon name="style" size={18} aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-text-main">
                    Layanan Terlaris
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Diurutkan menurut jumlah pasang terbanyak dari pesanan masuk (non-batal).
                  </CardDescription>
                </div>
              </div>
              <Badge variant="default">
                {lt.total_pasang} Pasang ({lt.jumlah_layanan_unik} Layanan)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 flex flex-col gap-3">
            <DataTable<BarisLayananTerlaris>
              data={lt.daftar}
              rowKey={(row) => (row.adalah_lainnya ? "lainnya" : `svc-${row.service_id}`)}
              caption="Daftar peringkat layanan terlaris"
              emptyState={
                <EmptyState
                  icon="inbox"
                  title="Belum Ada Transaksi"
                  description="Tidak ada pesanan masuk (non-batal) pada rentang tanggal ini."
                />
              }
              columns={[
                {
                  key: "peringkat",
                  header: "No",
                  headerClassName: "w-12 text-center",
                  className: "text-center font-outfit font-bold text-text-muted",
                  render: (row) => (row.adalah_lainnya ? "—" : row.peringkat),
                },
                {
                  key: "layanan",
                  header: "Nama Layanan",
                  render: (row) => (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold text-text-main">
                        <span>{row.nama_layanan}</span>
                        {!row.adalah_lainnya && !row.aktif && (
                          <Badge variant="default">(nonaktif)</Badge>
                        )}
                      </div>
                      <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(100, row.persentase_pasang)}%` }}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  key: "pasang",
                  header: "Pasang",
                  headerClassName: "text-right",
                  className: "text-right font-bold text-text-main whitespace-nowrap",
                  render: (row) => `${row.jumlah_pasang} psg`,
                },
                {
                  key: "persen",
                  header: "Porsi",
                  headerClassName: "text-right",
                  className: "text-right font-semibold text-primary whitespace-nowrap",
                  render: (row) => formatPersen(row.persentase_pasang),
                },
                {
                  key: "nominal",
                  header: "Nominal",
                  headerClassName: "text-right",
                  className: "text-right font-bold text-text-main whitespace-nowrap",
                  render: (row) => formatRupiah(row.total_nominal),
                },
              ]}
              renderMobileCard={(row) => (
                <div className="rounded-2xl border border-border-card bg-surface-card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold text-sm text-text-main">
                      <span className="font-outfit font-bold text-primary">
                        {row.adalah_lainnya ? "Lainnya" : `#${row.peringkat}`}
                      </span>
                      {!row.adalah_lainnya && <span>{row.nama_layanan}</span>}
                      {!row.adalah_lainnya && !row.aktif && (
                        <Badge variant="default">(nonaktif)</Badge>
                      )}
                    </div>
                    <Badge variant="primary">{formatPersen(row.persentase_pasang)}</Badge>
                  </div>
                  <div className="w-full h-2 bg-surface-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, row.persentase_pasang)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-muted pt-1">
                    <span className="font-semibold text-text-main">{row.jumlah_pasang} Pasang</span>
                    <span className="font-bold text-primary">{formatRupiah(row.total_nominal)}</span>
                  </div>
                </div>
              )}
            />

            <p className="text-[11px] text-text-muted leading-relaxed">
              {lt.catatan_pembulatan} Nominal memakai harga saat transaksi masing-masing tiket.
            </p>
          </CardContent>
        </Card>

        {/* Kanan: Pembayaran Diterima & Laba Rugi */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Pembayaran Diterima menurut tanggal bayar (FR-51) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Ikon name="fact_check" size={18} className="text-primary shrink-0" aria-hidden="true" />
                  <CardTitle className="text-base font-bold text-text-main">
                    Pembayaran Diterima
                  </CardTitle>
                </div>
                <Badge variant="default">{pb.total_tiket} Tiket Lunas</Badge>
              </div>
              <CardDescription className="text-xs">
                Total pelunasan yang diterima pada rentang ini menurut tanggal bayar (WIB).
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 flex flex-col gap-4">
              <div className="rounded-2xl bg-surface-canvas border border-border-warm p-3.5 flex items-baseline justify-between">
                <span className="text-xs font-medium text-text-muted">Total Diterima</span>
                <span className="font-outfit font-extrabold text-xl text-primary">
                  {formatRupiah(pb.total_nominal)}
                </span>
              </div>

              {/* Batang Proporsi Cash vs Non-cash */}
              <div className="space-y-1.5">
                <div className="h-2.5 w-full bg-surface-subtle rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-text-muted"
                    style={{ width: `${persenCash}%` }}
                    title={`Cash ${formatPersen(persenCash)}`}
                  />
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${persenNonCash}%` }}
                    title={`Non-cash ${formatPersen(persenNonCash)}`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>Cash: {formatPersen(persenCash)}</span>
                  <span>Non-cash: {formatPersen(persenNonCash)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border-warm bg-surface-canvas p-3.5 flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-text-main">Tunai / Cash</span>
                  </div>
                  <span className="text-[11px] font-medium text-primary">{pb.cash.label}</span>
                  <span className="font-outfit font-extrabold text-lg text-text-main mt-1">
                    {formatRupiah(pb.cash.total_nominal)}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {pb.cash.total_tiket} Tiket Cash
                  </span>
                </div>

                <div className="rounded-2xl border border-primary/20 bg-primary-light/30 p-3.5 flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-text-main">Non-Cash</span>
                  </div>
                  <span className="text-[11px] font-medium text-text-muted">Transfer / QRIS</span>
                  <span className="font-outfit font-extrabold text-lg text-primary mt-1">
                    {formatRupiah(pb.non_cash.total_nominal)}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {pb.non_cash.total_tiket} Tiket Non-Cash
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Kartu Laba Rugi (FR-52) */}
          <Card className="border-dashed border-border-card bg-surface-canvas">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Ikon name="event_note" size={18} className="text-text-muted shrink-0" aria-hidden="true" />
                  <CardTitle className="text-base font-bold text-text-main">
                    Laba Rugi
                  </CardTitle>
                </div>
                <Badge variant="default">FR-52</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm font-medium text-text-muted">
                {data.laba_rugi.pesan}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Catatan Definisi Angka */}
      <div className="rounded-2xl border border-border-warm bg-surface-canvas p-4 text-xs text-text-muted space-y-1">
        <p className="font-semibold text-text-main">Definisi Angka (Hanya-Baca)</p>
        <p>
          • Pesanan Masuk &amp; Layanan Terlaris dihitung dari tiket non-batal menurut tanggal masuk (WIB).
          Pembayaran Diterima dihitung menurut tanggal bayar (WIB) dan tidak menyertakan tiket berstatus Dibatalkan.
        </p>
        <p>• {data.disclaimer}</p>
      </div>
    </div>
  );
}
