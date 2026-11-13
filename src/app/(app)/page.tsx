// Dashboard Operasional — Owner dan Kasir (Phase 7A, FR-30, FR-31, FR-32).
// Menampilkan metrik pesanan masuk hari ini, tiket belum bayar aktif, tren 7 hari (owner), dan 5 tiket terbaru.

import Link from "next/link";
import { requireAuth } from "@/lib/auth.ts";
import { ambilDataDashboard } from "@/lib/laporan.ts";
import { hitungGeometriGrafikTren, type GeometriGrafikTren } from "@/lib/grafik-tren.ts";
import { formatRupiah, formatTanggal } from "@/lib/format.ts";
import { PageHeader } from "@/components/ui/page-header.tsx";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Ikon } from "@/components/ikon.tsx";
import type { StatusPesanan, StatusBayar } from "@/config/status.ts";

export const dynamic = "force-dynamic";

function SvgGrafikTren({ geo }: { geo: GeometriGrafikTren }) {
  const adalahPonsel = geo.mode === "ponsel";
  return (
    <svg
      viewBox={geo.viewBox}
      className={adalahPonsel ? "w-full h-52 select-none" : "w-full h-56 select-none"}
      role="img"
      aria-label="Grafik tren pesanan 7 hari terakhir"
    >
      {/* Garis Grid Horisontal */}
      {geo.gridLinesY.map((gy) => (
        <line
          key={gy}
          x1={adalahPonsel ? 8 : 20}
          y1={gy}
          x2={geo.viewBoxWidth - (adalahPonsel ? 8 : 20)}
          y2={gy}
          className="stroke-border-warm"
          strokeDasharray="3 3"
        />
      ))}

      {/* Batang & Label Nilai 7 Hari */}
      {geo.bars.map((b) => (
        <g key={b.tanggal}>
          <text
            x={b.labelNilai.x}
            y={b.labelNilai.y}
            textAnchor="middle"
            className={`font-outfit ${adalahPonsel ? "text-[10px]" : "text-xs"} font-bold ${
              b.adalahHariIni ? "fill-primary" : "fill-text-body"
            }`}
          >
            {b.labelNilai.text}
          </text>

          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            rx={adalahPonsel ? 4 : 6}
            className={b.adalahHariIni ? "fill-primary" : "fill-primary-light"}
          />

          <text
            x={b.labelTanggal.x}
            y={b.labelTanggal.y}
            textAnchor="middle"
            className={`font-jakarta ${adalahPonsel ? "text-[10px]" : "text-[11px]"} font-semibold ${
              b.adalahHariIni ? "fill-primary" : "fill-text-muted"
            }`}
          >
            {b.labelTanggal.text}
          </text>
          {b.adalahHariIni && (
            <text
              x={b.labelTanggal.x}
              y={geo.yLabelHariIni}
              textAnchor="middle"
              className={`font-outfit ${adalahPonsel ? "text-[9px]" : "text-[10px]"} font-bold fill-primary`}
            >
              (Hari Ini)
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default async function DashboardPage() {
  const sesi = await requireAuth();
  const data = await ambilDataDashboard(sesi.peran);

  const rh = data.ringkasan_hari_ini;
  const tren = data.tren_7_hari;

  return (
    <div className="flex flex-col gap-6 font-jakarta pb-12">
      <PageHeader
        title={`Halo, ${sesi.nama}`}
        description="Outlet Bojongsoang · Buka 09.00 – 21.00 WIB"
        badge={
          <Badge variant="primary">
            {sesi.peran === "owner" ? "Owner View" : "Kasir View"}
          </Badge>
        }
        actions={
          sesi.peran === "kasir" ? (
            <Link href="/buat-tiket">
              <Button variant="primary">
                <Ikon name="add_circle" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
                Buat Tiket
              </Button>
            </Link>
          ) : (
            <Link href="/laporan-harian">
              <Button variant="secondary">
                <Ikon name="event_note" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
                Buka Laporan Harian
              </Button>
            </Link>
          )
        }
      />

      {/* Ringkasan Operasional Hari Ini (FR-32) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {/* Card 1: Total Masuk Hari Ini */}
        <Card className="flex flex-col justify-between border-t-4 border-t-primary bg-surface-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Ringkasan Hari Ini
              </span>
              <div className="w-8 h-8 rounded-lg bg-primary-light text-primary flex items-center justify-center">
                <Ikon name="confirmation_number" size={16} aria-hidden="true" />
              </div>
            </div>
            <CardTitle className="text-base font-bold text-text-main mt-1">
              Pesanan Masuk Hari Ini
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-2 mt-2">
              <span className="font-outfit font-extrabold text-3xl text-primary leading-none">
                {rh.pesanan_masuk.total_pasang}
              </span>
              <span className="text-sm font-medium text-text-muted">Pasang Sepatu</span>
            </div>
            <div className="pt-3 mt-4 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>{rh.pesanan_masuk.total_tiket} Tiket Pesanan Masuk</span>
              <span className="font-medium text-text-main">
                {formatTanggal(data.hari_ini)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Belum Bayar (semua tiket aktif) */}
        <Card className="flex flex-col justify-between border-t-4 border-t-danger bg-surface-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-danger">
                Perlu Follow-Up
              </span>
              <div className="w-8 h-8 rounded-lg bg-danger-light text-danger flex items-center justify-center">
                <Ikon name="alert_triangle" size={16} aria-hidden="true" />
              </div>
            </div>
            <CardTitle className="text-base font-bold text-text-main mt-1">
              {rh.belum_bayar_aktif.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <div className="flex items-baseline gap-2">
                <span className="font-outfit font-extrabold text-3xl text-danger leading-none">
                  {rh.belum_bayar_aktif.total_tiket}
                </span>
                <span className="text-sm font-medium text-text-muted">Tiket Tertunda</span>
              </div>
              {/* Nominal hanya untuk owner; kasir tidak melihat nominal */}
              {sesi.peran === "owner" && rh.belum_bayar_aktif.total_nominal !== null && (
                <span className="font-outfit font-bold text-lg text-danger">
                  {formatRupiah(rh.belum_bayar_aktif.total_nominal)}
                </span>
              )}
            </div>
            <div className="pt-3 mt-4 border-t border-border-warm flex items-center justify-between text-xs text-text-muted">
              <span>{rh.belum_bayar_aktif.total_pasang} Pasang Belum Bayar</span>
              <span className="text-danger font-medium">Tiket Aktif Belum Lunas</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Tren 7 Hari Terakhir (FR-31) — KHUSUS OWNER */}
      {sesi.peran === "owner" && tren && (
        <Card className="flex flex-col gap-4">
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border-warm">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-text-main">
                  Tren Pesanan 7 Hari Terakhir
                </CardTitle>
                <Badge variant="primary">tren, bukan laporan harian</Badge>
              </div>
              <span className="text-xs text-text-muted font-medium">
                Volume: Pasang Sepatu per Hari
              </span>
            </div>
            <CardDescription className="text-xs text-text-muted mt-1">
              Menampilkan akumulasi jumlah pasang sepatu masuk per hari kalender (WIB) selama 7 hari berakhir hari ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Diagram Batang SVG Responsif: mode desktop & mode ponsel sempit ("6 Nov") */}
            <div className="w-full py-1">
              <div className="hidden sm:block">
                <SvgGrafikTren geo={hitungGeometriGrafikTren(tren, { mode: "desktop" })} />
              </div>
              <div className="block sm:hidden">
                <SvgGrafikTren geo={hitungGeometriGrafikTren(tren, { mode: "ponsel" })} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5 Tiket Terbaru Masuk (FR-30) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Ikon name="confirmation_number" size={18} className="text-primary" aria-hidden="true" />
                <CardTitle className="text-base font-bold text-text-main">
                  5 Tiket Terbaru Masuk
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-text-muted mt-0.5">
                Pesanan terkini yang masuk dari WhatsApp maupun pendaftaran di toko.
              </CardDescription>
            </div>
            <Link
              href="/tiket"
              className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
            >
              Lihat semua tiket &rarr;
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {data.tiket_terbaru.length === 0 ? (
            <div className="py-8 text-center text-xs text-text-muted">
              Belum ada tiket pesanan yang tercatat di sistem.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left text-xs font-jakarta">
                <thead>
                  <tr className="border-b border-border-warm text-text-muted font-bold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-3">Kode Tiket</th>
                    <th className="py-3 px-3">Pelanggan</th>
                    <th className="py-3 px-3">Sumber</th>
                    <th className="py-3 px-3 text-center">Jumlah</th>
                    <th className="py-3 px-3">Status Pesanan</th>
                    <th className="py-3 px-3">Pembayaran</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3 text-right">Waktu Masuk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-warm">
                  {data.tiket_terbaru.map((t) => (
                    <tr key={t.id} className="hover:bg-surface-canvas transition-colors">
                      <td className="py-3 px-3">
                        <Link
                          href={`/tiket/${t.id}`}
                          className="font-mono font-bold text-primary hover:underline"
                        >
                          {t.kode_tiket}
                        </Link>
                      </td>
                      <td className="py-3 px-3 font-medium text-text-main">
                        {/* Nama pelanggan saja — tanpa nomor WA demi privasi */}
                        {t.nama_pelanggan}
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant={t.sumber === "wa" ? "primary" : "default"}>
                          {t.sumber === "wa" ? "WhatsApp" : "Toko"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-text-main">
                        {t.jumlah_pasang} psg
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant="pesanan"
                          statusPesanan={t.status_pesanan as StatusPesanan}
                        />
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant="bayar"
                          statusBayar={t.status_bayar as StatusBayar}
                        />
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-text-main">
                        {formatRupiah(t.total)}
                      </td>
                      <td className="py-3 px-3 text-right text-text-muted whitespace-nowrap">
                        {formatTanggal(t.tanggal_masuk, { denganWaktu: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
