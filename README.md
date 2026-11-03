# Capstone_Solemate

Sistem web **Solemate Shoes Clean** (laundry sepatu, Bojongsoang). Untuk konteks produk, peran, dan aturan kerja, baca `CLAUDE.md` dan folder `docs/`.

> Status: Phase 3 — database, migrasi, login, peran (owner/kasir), dan otorisasi di server. Belum ada fitur tiket, laporan, atau katalog.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- PostgreSQL 16 (Docker Compose)
- Node.js 22 LTS, package manager **npm**

## Prasyarat di Mac

1. **Node.js 22** lewat [nvm](https://github.com/nvm-sh/nvm). Proyek ini punya `.nvmrc` berisi `22`.
2. **Docker Desktop** (atau Docker + Docker Compose).

## Langkah menjalankan

```bash
# 1. Masuk ke folder proyek
cd Capstone_Solemate

# 2. Pakai Node 22 (sekali per terminal)
nvm install   # kalau Node 22 belum ada
nvm use       # membaca .nvmrc → Node 22

# 3. Install dependensi
npm install

# 4. Siapkan variabel lingkungan
cp .env.example .env
# lalu buka .env dan ganti POSTGRES_PASSWORD (dan password di DATABASE_URL agar sama)

# 5. Nyalakan database PostgreSQL
docker compose up -d

# 6. Jalankan aplikasi
npm run dev
```

Buka http://localhost:3000 — halaman default Next.js akan tampil.

### Cek database hidup

```bash
docker compose ps                         # status container (harus "healthy")
docker compose exec db pg_isready -U solemate   # harus "accepting connections"
```

### Mematikan

```bash
docker compose down        # matikan database (data tetap tersimpan di volume)
npm run dev                # hentikan dengan Ctrl+C
```

Data PostgreSQL disimpan di volume Docker `solemate_pgdata`, jadi tidak hilang saat `docker compose down`.

## Konfigurasi

| File | Isi |
|---|---|
| `.env` | Rahasia lokal (password DB). **Tidak di-commit.** Dibuat dari `.env.example` |
| `docker-compose.yml` | Service PostgreSQL 16, port hanya `127.0.0.1` |
| `src/config/order-status.ts` | Daftar status pesanan, status bayar, metode bayar |
| `src/config/auth.ts` | Batas login per akun/IP dan batas pencatatan audit |
| `migrations/` | Migrasi SQL (node-pg-migrate), punya bagian Up dan Down |
| `scripts/create-user.mjs` | Skrip buat akun owner/kasir (PIN lewat prompt) |
| `scripts/reset-pin.mjs` | Skrip ganti PIN akun + buka kunci (PIN lewat prompt) |
| `scripts/seed.js` | Data contoh palsu (tanpa users/PIN), hanya jalan saat `NODE_ENV=development` |
| `tests/db-constraints.test.mjs` | Tes aturan database (transaksi di-ROLLBACK, tidak meninggalkan data) |
| `tests/auth.test.mjs`, `tests/auth-extra.test.mjs` | Tes login, peran, sesi, otorisasi |

### Variabel `.env` (Phase 3)

Salin `.env.example` → `.env`, lalu isi nilainya. Yang baru dibanding Phase 1:

| Variabel | Fungsi |
|---|---|
| `APP_DB_PASSWORD` | Password user DB `solemate_app` (hak terbatas) |
| `DATABASE_URL_APP` | Koneksi aplikasi memakai user `solemate_app` |
| `SESSION_SECRET` | Rahasia sesi. **Ganti** dengan string acak panjang di produksi |
| `SESSION_TTL_SECONDS` | Masa hidup sesi (default 28800 = 8 jam) |
| `TRUST_PROXY` | `true` kalau di belakang proxy tepercaya (X-Forwarded-For dipakai untuk IP); default `false` |

Jangan tulis rahasia (password, token, PIN) ke repo. `.env` diabaikan git; hanya `.env.example` yang boleh di-commit.

## Database dan migrasi

```bash
npm run migrate:up      # jalankan migrasi yang belum jalan
npm run migrate:down    # batalkan migrasi terakhir
npm run migrate:status  # lihat migrasi mana yang sudah jalan
npm run seed            # data contoh (dilewati kecuali NODE_ENV=development)
npm run test:db         # tes aturan database (butuh DB hidup)
```

Aturan yang ditegakkan di level database (bukan hanya kode):

1. `orders` tidak bisa dihapus — trigger blokir DELETE dan TRUNCATE; pembatalan lewat status `Dibatalkan` + `alasan_batal` wajib.
2. `audit_logs` append-only — trigger blokir UPDATE, DELETE, dan TRUNCATE.
3. `status_pesanan` dan `status_bayar` dua kolom terpisah, nilai dibatasi CHECK sesuai `src/config/order-status.ts`.
4. `harga_saat_transaksi` wajib per baris `order_items` (harga disalin saat tiket dibuat).
5. PIN hanya boleh disimpan sebagai hash (CHECK format bcrypt/argon2).
6. `customers.nomor_wa` unik dan berformat baku: hanya angka, diawali `62`.

## Login dan otorisasi

### Membuat akun

```bash
npm run create-user
```

Skrip meminta nama, peran (owner/kasir), dan PIN:
- **Semua peran**: PIN tepat **6 digit angka**. Contoh `000000`, `123456`, `472913` semuanya diterima.
- Input yang bukan tepat 6 digit angka (5 digit, 7 digit, atau berisi huruf) ditolak.

PIN diminta lewat prompt interaktif (tidak terlihat saat diketik).

PIN disimpan sebagai hash argon2id di database. Kode tidak pernah mencatat PIN di log atau file.

### Mengganti PIN akun yang sudah ada

```bash
npm run reset-pin
```

Skrip meminta nama akun dan PIN baru (6 digit, prompt tersembunyi). Skrip juga **membuka kunci** percobaan login akun tersebut, jadi akun yang terlanjur terkunci bisa dipakai lagi langsung. Berguna untuk memindahkan akun lama ke PIN 6 digit.

### Halaman login

Buka http://localhost:3000/login — masukkan nama pengguna dan PIN.

Aturan login:
- Per akun: maks 5 percobaan salah per 15 menit → akun terkunci.
- Per IP: maks 5 percobaan salah per 15 menit (jika IP diketahui).
- **Selama akun terkunci, PIN yang benar pun ditolak.** Tunggu 15 menit atau hubungi owner.
- Sesi berlaku 8 jam (bisa diatur `SESSION_TTL_SECONDS`), cookie HttpOnly + SameSite.
- Peran dan status aktif dibaca ulang dari database tiap request — perubahan langsung terlihat.

### Peran dan halaman

| Halaman | Owner | Kasir | Publik |
|---------|-------|-------|--------|
| /login | ✓ | ✓ | ✓ |
| /absensi | ✓ | ✓ | ✓ |
| /tiket (daftar) | ✓ | ✓ | – |
| /detail-tiket | ✓ | ✓ | – |
| /buat-tiket | – | ✓ | – |
| /katalog | ✓ | – | – |
| /karyawan | ✓ | – | – |
| /laporan-harian | ✓ | – | – |
| /rekap-absensi | ✓ | – | – |
| /rekap-bulanan | ✓ | – | – |

Halaman terlindungi mengarahkan ke login jika belum login. Kasir yang coba akses halaman owner melihat "Akses ditolak".

### Login audit

Setiap percobaan login (berhasil atau gagal) dicatat ke `audit_logs` tanpa PIN, beserta IP (jika diketahui). Jika percobaan gagal melebihi batas per akun/IP, baris ringkasan satu kali direkam daripada dilewatkan.

Catatan audit `login` dan `login_gagal`:
- `login`: login berhasil.
- `login_gagal`: login gagal (sebab: `pin_salah`, `tidak_ditemukan`, atau `nonaktif`).
- `login_gagal_ringkasan`: batas percobaan tercapai (detail diedit agar tak terlalu banyak baris).

## Testing

### Jalankan semua tes

```bash
npm run test
```

Menjalankan tes database (`test:db`) terlebih dahulu, lalu tes autentikasi (`test:auth`).

### Tes database (18 butir)

```bash
npm run test:db
```

- Aturan DELETE/TRUNCATE/UPDATE di orders dan audit_logs.
- Aturan format PIN (hash).
- CHECK constraints status pesanan, status bayar, alamat pelanggan.
- Unique constraints pada kode tiket dan nomor WA.
- Pembatalan wajib alasan.

### Tes autentikasi dan otorisasi (29 butir)

```bash
npm run test:auth
```

Tes login, pembatasan percobaan, peran, sesi:
- Login berhasil, gagal, pembatasan per akun & per IP.
- Kunci akun dan timeout kunci.
- 10 percobaan serentak ≤ batas 5 (race condition).
- Owner bisa akses rute owner, kasir ditolak.
- Logout hapus sesi.
- Sesi akun nonaktif tidak berlaku.
- Sesi kedaluwarsa ditolak.
- Halaman dan API terlindungi mengarahkan ke login tanpa sesi.
- PIN tidak bocor ke log aplikasi atau audit_logs.
- Batas audit per (akun, IP), bukan global.
- Aturan PIN: tepat 6 digit angka — 000000 diterima, 5/7 digit dan huruf ditolak (server, skrip create-user, dan form).
- Form login tidak mengirim sebelum 6 digit terisi.
- X-Forwarded-For dipakai saat TRUST_PROXY=true, diabaikan saat false.
- User database `solemate_app` ditolak DELETE/TRUNCATE orders dan UPDATE/DELETE audit_logs.

**Tes menggunakan database sekali pakai `solemate_test`** (dibuat ulang tiap run) — tidak mengotori database utama.

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
