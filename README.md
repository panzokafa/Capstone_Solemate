# Capstone_Solemate

Sistem web **Solemate Shoes Clean** (laundry sepatu, Bojongsoang). Untuk konteks produk, peran, dan aturan kerja, baca `CLAUDE.md` dan folder `docs/`.

> Status: Phase 1 — infrastruktur saja (kerangka proyek, Docker PostgreSQL, konfigurasi). Belum ada tabel database, login, atau fitur.

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
| `migrations/` | Migrasi SQL (node-pg-migrate), punya bagian Up dan Down |
| `scripts/seed.js` | Data contoh palsu (tanpa users/PIN), hanya jalan saat `NODE_ENV=development` |
| `tests/db-constraints.test.mjs` | Tes aturan database (transaksi di-ROLLBACK, tidak meninggalkan data) |

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

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
