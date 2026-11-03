# UI_GUIDE.md — Panduan Sistem Desain Solemate

Dokumen acuan antarmuka tunggal untuk seluruh aplikasi Solemate Shoes Clean.
Semua halaman baru **wajib** mengikuti aturan ini.

---

## 1. Aturan Utama: Dilarang Menggunakan Nilai Hardcode
- **Jangan menulis kode warna hex hardcode** (seperti `#002546`, `#133B63`, `#fff9ef`) di dalam file halaman (`src/app/`) maupun komponen.
- **Gunakan token semantik** yang sudah terdaftar di Tailwind dan `src/config/tokens.ts`.
- **Target tap interaktif**: Semua tombol dan elemen klik wajib memiliki ukuran minimal 44px (`min-h-[44px]` / `h-11`) untuk kenyamanan tablet kasir.
- **Gunakan komponen bersama** dari `@/components/ui`, jangan membuat tag button/input mentah dengan gaya sendiri.

---

## 2. Token Desain (Tailwind Utilities)

| Kategori | Token / Class Utility | Penggunaan |
|---|---|---|
| **Primer Navy** | `bg-primary`, `text-primary`, `hover:bg-primary-hover` | Aksi utama, tombol primer, header brand |
| **Navy Gelap** | `text-primary-dark`, `text-text-main` | Judul halaman, heading besar, kontras tinggi |
| **Navy Muda** | `bg-primary-light`, `text-primary-light` | Latar badge info, sorotan terpilih |
| **Latar Kanvas** | `bg-surface-canvas` | Latar halaman login dan luar |
| **Latar App** | `bg-surface-app` | Latar kanvas dalam aplikasi |
| **Latar Kartu** | `bg-surface-card` | Kartu modul, sidebar navigasi |
| **Latar Input** | `bg-surface-subtle`, `hover:bg-surface-hover` | Latar form input, hover baris/menu |
| **Teks Isi** | `text-text-body` | Teks paragraf, tabel, dan label formulir |
| **Teks Redup** | `text-text-muted` | Keterangan pembantu, caption, subtitle |
| **Garis Batas** | `border-border-warm`, `border-border-card` | Garis kartu, pemisah header, border input |
| **Aksi Bahaya** | `bg-danger`, `text-danger`, `bg-danger-light` | Tombol hapus/batal, teks galat validasi |
| **Tipografi** | `font-outfit`, `font-jakarta` | `font-outfit` untuk judul/badge; `font-jakarta` untuk teks/form |

---

## 3. Komponen Bersama (`@/components/ui`)

### Button
```tsx
import { Button } from "@/components/ui/button";

<Button variant="primary">Simpan</Button>
<Button variant="secondary">Batal</Button>
<Button variant="danger">Hapus Pesanan</Button>
<Button variant="primary" loading={isLoading}>Menyimpan...</Button>
```

### Input, Select & Textarea
```tsx
import { Input, Select, Textarea } from "@/components/ui";

<Input
  label="Nama Pelanggan"
  required
  error={errors.nama}
  helperText="Sesuai kartu identitas atau nama panggilan"
/>

<Select
  label="Layanan"
  options={[
    { label: "Deep Clean", value: "dc" },
    { label: "Fast Clean", value: "fc" },
  ]}
/>

<Textarea label="Catatan Sepatu" rows={3} />
```

### Card
```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Detail Pesanan</CardTitle>
    <CardDescription>Nomor tiket: SOLE-2026-001</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Isi kartu */}
  </CardContent>
</Card>
```

### PageHeader
Semua halaman wajib diawali `PageHeader` di paling atas:
```tsx
import { PageHeader } from "@/components/ui/page-header";

<PageHeader
  title="Daftar Tiket Pesanan"
  description="Kelola seluruh tiket cucian sepatu masuk dan status pengerjaan."
  actions={<Button variant="primary">+ Buat Tiket</Button>}
/>
```

### Badge Status (PRD)
```tsx
import { Badge } from "@/components/ui/badge";

// Status Pesanan (Belum dicuci, Diproses, Siap diambil, Sudah diambil, Dibatalkan)
<Badge variant="pesanan" statusPesanan="Diproses" />

// Status Bayar (Belum bayar, Lunas)
<Badge variant="bayar" statusBayar="Belum bayar" />
```

---

## 4. Helper Format Terpusat (`@/lib/format`)
```tsx
import { formatRupiah, formatTanggal, formatWaktu } from "@/lib/format";

formatRupiah(25000); // "Rp 25.000"
formatRupiah(1500000); // "Rp 1.500.000"
formatTanggal("2026-05-10T20:00:00.000Z"); // "11 Mei 2026" (konversi ke WIB otomatis)
formatTanggal("2026-05-10T20:00:00.000Z", { denganWaktu: true }); // "11 Mei 2026, 03.00 WIB"
formatWaktu("2026-05-10T20:00:00.000Z"); // "03.00 WIB"
```

