// Halaman pratinjau komponen Solemate Design System.
// Hanya tersedia di lingkungan non-produksi dan hanya untuk peran Owner.
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import {
  Button,
  Input,
  Select,
  Textarea,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  PageHeader,
  Badge,
} from "@/components/ui";
import { formatRupiah, formatTanggal, formatWaktu } from "@/lib/format";
import { STATUS_PESANAN, STATUS_BAYAR } from "@/config/status";

export default async function DevKomponenPage() {
  // Wajib 404 di production
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  // Wajib peran Owner
  await requireOwner();

  const contohTglUTC = "2026-05-10T20:00:00.000Z";

  return (
    <div className="flex flex-col gap-8 pb-16">
      <PageHeader
        title="Katalog Desain Komponen (Dev)"
        description="Pratinjau visual seluruh token dan komponen Solemate Design System. Hanya tersedia di development untuk Owner."
        badge={<Badge variant="warning">Lingkungan Dev</Badge>}
        actions={
          <Button variant="secondary" size="sm">
            Kembali ke Dashboard
          </Button>
        }
      />

      {/* 1. BUTTONS */}
      <Card>
        <CardHeader>
          <CardTitle>1. Tombol (Button)</CardTitle>
          <CardDescription>
            Target tap minimal 44px untuk tablet kasir. Mendukung berbagai varian, ukuran, dan status loading.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Varian Utama (Normal, Loading, Nonaktif)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primer Navy</Button>
              <Button variant="primary" loading>
                Memproses...
              </Button>
              <Button variant="primary" disabled>
                Primer Nonaktif
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Varian Sekunder, Bahaya &amp; Ghost
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary">Sekunder</Button>
              <Button variant="secondary" loading>
                Memuat...
              </Button>
              <Button variant="danger">Hapus / Batal</Button>
              <Button variant="danger" disabled>
                Bahaya Nonaktif
              </Button>
              <Button variant="ghost">Teks Ghost</Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Ukuran (Small, Medium, Large)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small (44px min)</Button>
              <Button size="md">Medium (44px min)</Button>
              <Button size="lg">Large (48px pill)</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. FORM CONTROLS */}
      <Card>
        <CardHeader>
          <CardTitle>2. Input, Select &amp; Textarea</CardTitle>
          <CardDescription>
            Elemen formulir terstruktur dengan label, pesan galat ramah aksesibilitas, dan focus ring yang kontras.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="Nama Pelanggan"
            placeholder="Contoh: Budi Santoso"
            helperText="Masukkan nama lengkap pelanggan."
            required
          />

          <Input
            label="Nomor WhatsApp"
            placeholder="08123456789"
            error="Nomor WhatsApp wajib diawali 62 dan minimal 10 digit."
            defaultValue="0812"
          />

          <Select
            label="Layanan Laundry"
            options={[
              { label: "Pilih layanan...", value: "" },
              { label: "Deep Clean (Rp 35.000)", value: "dc" },
              { label: "Fast Clean Express (Rp 25.000)", value: "fc" },
              { label: "Unyellowing Treatment (Rp 50.000)", value: "un" },
            ]}
            helperText="Pilih jenis layanan yang dipesan."
          />

          <Select
            label="Metode Pembayaran"
            options={[
              { label: "Cash (Tunai)", value: "Cash" },
              { label: "Non-cash (Transfer)", value: "Non-cash" },
            ]}
          />

          <div className="md:col-span-2">
            <Textarea
              label="Catatan Khusus Sepatu"
              placeholder="Contoh: Noda lumpur di midsole kiri, hati-hati bahan suede."
              helperText="Catatan teknis untuk tim cuci."
            />
          </div>
        </CardContent>
      </Card>

      {/* 3. STATUS BADGES */}
      <Card>
        <CardHeader>
          <CardTitle>3. Badge Status Pesanan &amp; Status Bayar</CardTitle>
          <CardDescription>
            Satu pemetaan terpusat sesuai PRD Solemate. Warna terbukti berbeda jelas dan selalu menampilkan teks label.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Status Pesanan (5 Status PRD)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {STATUS_PESANAN.map((s) => (
                <Badge key={s} variant="pesanan" statusPesanan={s} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Status Pembayaran (2 Status PRD)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {STATUS_BAYAR.map((b) => (
                <Badge key={b} variant="bayar" statusBayar={b} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted font-outfit uppercase tracking-wider">
              Badge Semantik Umum
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="default">Netral Default</Badge>
              <Badge variant="primary">Primer Navy</Badge>
              <Badge variant="success">Sukses</Badge>
              <Badge variant="warning">Peringatan</Badge>
              <Badge variant="danger">Bahaya</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. HELPER FORMAT */}
      <Card>
        <CardHeader>
          <CardTitle>4. Helper Format (Rupiah &amp; Tanggal Indonesia)</CardTitle>
          <CardDescription>
            Dihitung dari modul tunggal src/lib/format.ts dengan zona waktu Asia/Jakarta (WIB).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              Rupiah: 0
            </p>
            <p className="text-lg font-bold font-outfit text-text-main mt-1">
              {formatRupiah(0)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              Rupiah: 25.000
            </p>
            <p className="text-lg font-bold font-outfit text-text-main mt-1">
              {formatRupiah(25000)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              Rupiah: 1.500.000
            </p>
            <p className="text-lg font-bold font-outfit text-text-main mt-1">
              {formatRupiah(1500000)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              UTC Pergantian Hari (20.00 UTC = 03.00 WIB)
            </p>
            <p className="text-base font-bold font-outfit text-text-main mt-1">
              {formatTanggal(contohTglUTC)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              Tanggal + Waktu WIB
            </p>
            <p className="text-base font-bold font-outfit text-text-main mt-1">
              {formatTanggal(contohTglUTC, { denganWaktu: true })}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-subtle border border-border-card">
            <p className="text-xs text-text-muted font-outfit uppercase font-semibold">
              Hanya Waktu WIB
            </p>
            <p className="text-base font-bold font-outfit text-text-main mt-1">
              {formatWaktu(contohTglUTC)}
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs text-text-muted">
            Semua komponen mematuhi aturan rasio kontras WCAG AA $\ge 4.5:1$.
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}

