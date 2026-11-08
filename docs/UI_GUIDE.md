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

### Dialog
```tsx
import { Dialog } from "@/components/ui/dialog";

<Dialog
  open={terbuka}
  onClose={() => setTerbuka(false)}
  title="Konfirmasi Aksi"
  description="Penjelasan singkat sebelum melanjutkan."
>
  {/* Isi dialog */}
</Dialog>
```

### DataTable, EmptyState & Skeleton
Gunakan `DataTable` untuk menampilkan tabel semantik di tablet/desktop sekaligus kartu responsif di ponsel (`renderMobileCard`), lengkap dengan keadaan memuat (`loading` berbasis `Skeleton`) dan kosong (`EmptyState`):
```tsx
import { DataTable, EmptyState, Skeleton } from "@/components/ui";

<DataTable
  columns={[
    { key: "kode", header: "Kode Tiket", render: (row) => row.kode_tiket },
    { key: "total", header: "Total", render: (row) => formatRupiah(row.total) },
  ]}
  data={daftar}
  rowKey={(row) => row.id}
  loading={sedangMemuat}
  emptyState={
    <EmptyState
      icon="inbox"
      title="Belum Ada Data"
      description="Data yang tercatat akan tampil di halaman ini."
    />
  }
/>
```

### FilterBar, FilterChip & Pagination
Gunakan `FilterBar` bersama `FilterChip` (semua tombol memiliki target sentuh `min-h-[44px]`) serta `Pagination` berbasis query string yang divalidasi di server:
```tsx
import { FilterBar, FilterChip, Pagination } from "@/components/ui";

<FilterBar>
  <div className="flex flex-wrap gap-2">
    <FilterChip active={periode === "hari_ini"} onClick={() => pilih("hari_ini")}>
      Hari ini
    </FilterChip>
    <FilterChip active={periode === "7_hari"} onClick={() => pilih("7_hari")}>
      7 hari terakhir
    </FilterChip>
  </div>
</FilterBar>

<Pagination
  halaman={paginasi.halaman}
  totalHalaman={paginasi.total_halaman}
  totalData={paginasi.total_data}
  ukuran={paginasi.ukuran}
  buatHref={(target) => `/tiket?halaman=${target}`}
/>
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

---

## 5. Catatan Asumsi & Aturan Modul Tiket (Phase 5A & 5B)
- **Asumsi segmen filter `"7 hari terakhir"` (`periode=7_hari`):** PRD bagian 7.3 dan FR-13 menyebut filter *"beberapa hari lalu"* tanpa angka pasti. Untuk sementara antarmuka dan server menggunakan **7 hari terakhir** dalam zona waktu `Asia/Jakarta` (dikonfigurasi terpusat di `src/config/tiket.ts` agar mudah disesuaikan setelah konfirmasi pemilik toko).
- **Asumsi batas rentang tanggal tiket:** `tanggal_masuk` maksimal 30 hari ke belakang (`MAKS_HARI_MASUK_LAMPAU = 30`) dan toleransi maksimal 5 menit di masa depan (`TOLERANSI_TANGGAL_MASUK_MENIT = 5`); `estimasi_selesai` maksimal 365 hari setelah `tanggal_masuk` (`MAKS_HARI_ESTIMASI_SELESAI = 365`). Konfigurasi ini terpusat di `src/config/tiket.ts` dan perlu dikonfirmasi kepada pemilik toko.
- **Tanggal pada `kode_tiket` (`SM-YYYYMMDD-NNN`):** menggunakan **tanggal terbit tiket** di server pada zona waktu `Asia/Jakarta`, bukan `tanggal_masuk` yang diisi kasir, supaya penomoran resi harian selalu maju berurutan dan bebas bentrok.
- **Asumsi aturan transisi status pesanan (perlu konfirmasi pemilik toko):** terpusat di `src/config/order-status.ts`:
  - Maju satu langkah: `Belum dicuci -> Diproses -> Siap diambil -> Sudah diambil` (`UBAH_STATUS`).
  - Koreksi mundur maksimal satu langkah: `Diproses -> Belum dicuci`, `Siap diambil -> Diproses`, `Sudah diambil -> Siap diambil` (`KOREKSI`).
  - `Dibatalkan` bersifat final; `Sudah diambil` tidak dapat dibatalkan; lompat langkah ditolak `409`.
- **Asumsi pengambilan saat belum lunas (perlu konfirmasi pemilik toko):** mengubah status ke `Sudah diambil` ketika `status_bayar = 'Belum bayar'` tidak diblokir, namun wajib konfirmasi eksplisit dari kasir di antarmuka dan dicatat `belum_bayar_saat_diambil: true` di `audit_logs`.
- **Asumsi ambang penanda tiket lama belum diambil (FR-17, perlu konfirmasi pemilik toko):** tiket berstatus `Siap diambil` dengan selisih hari kalender WIB `>= MIN_HARI_BELUM_DIAMBIL` (`2` hari, terpusat di `src/config/tiket.ts`) sejak `siap_diambil_pada` diberi lencana `"N hari belum diambil"` dan dapat difilter (`belum_diambil=1`). Waktu `siap_diambil_pada` hanya diisi saat pertama kali masuk `Siap diambil` (ketika masih `NULL`) dan tidak pernah di-reset.
- **Keamanan tautan & teks:** seluruh teks pengguna dirender sebagai teks biasa (tanpa `dangerouslySetInnerHTML`), dan seluruh tautan `wa.me` wajib meng-encode pesan dengan `encodeURIComponent` serta memakai `rel="noopener noreferrer"`.

---

## 6. Keterbatasan Sistem & Rekomendasi Mitigasi (Phase 5A)
- **Pencarian Nomor WhatsApp pada URL Daftar Tiket (`/tiket?cari=08...`):**
  Pencarian tiket lewat filter query string `cari` dapat mengandung nomor WhatsApp pelanggan. Karena dikirim melalui parameter URL (GET), nilai ini berpotensi tercatat di log akses HTTP server atau reverse proxy (Nginx, Caddy, Vercel). Rekomendasi mitigasi: di masa depan, gunakan mekanisme hash parsial, header tersendiri, atau filter masking log server yang menyamarkan query parameter `cari` yang menyerupai nomor telepon.
- **Pengecekan Pelanggan (`POST /api/pelanggan/cek`):**
  Saat ini pengecekan nomor WhatsApp pelanggan belum memiliki rate limiting per user/IP (berbeda dengan endpoint `/api/login` yang dilindungi tabel `login_rate_limit`). Rekomendasi mitigasi: tambahkan pembatas frekuensi (misalnya maksimal 30 pengecekan per menit per pengguna) untuk mencegah upaya enumerasi data pelanggan oleh akun kasir yang disusupi.


