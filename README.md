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

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
