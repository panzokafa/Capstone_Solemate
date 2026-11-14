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
| /absensi *(ditunda / nonaktif)* | – *(404)* | – *(404)* | – *(404)* |
| /tiket (daftar) | ✓ | ✓ | – |
| /detail-tiket | ✓ | ✓ | – |
| /buat-tiket | – | ✓ | – |
| /katalog | ✓ | – | – |
| /karyawan *(ditunda / nonaktif)* | – *(404)* | – *(404)* | – |
| /laporan-harian | ✓ | – | – |
| /rekap-absensi *(ditunda / nonaktif)* | – *(404)* | – *(404)* | – |
| /rekap-bulanan | ✓ | – | – |

Halaman terlindungi mengarahkan ke login jika belum login. Kasir yang coba akses halaman owner aktif (seperti `/katalog`, `/laporan-harian`, `/rekap-bulanan`) melihat "Akses ditolak". Saat `KARYAWAN_ABSENSI_AKTIF = false`, rute `/karyawan`, `/rekap-absensi`, `/api/karyawan`, dan `/api/rekap-absensi` membalas `404` yang identik untuk owner maupun kasir (pengunjung anonim tetap diarahkan `307` ke `/login`), sedangkan `/absensi` membalas `404` untuk semua pengunjung termasuk anonim.

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

## Bot WhatsApp (Phase 6A)

Sistem bot WhatsApp Solemate Shoes Clean berjalan mandiri tanpa n8n. Container WhatsApp HTTP API (WAHA) meneruskan webhook pesan masuk langsung ke backend Next.js pada endpoint `POST /api/wa/webhook`, dengan proteksi tanda tangan HMAC-SHA512, verifikasi usia payload, rate limiting atomik berlabel, serta penanganan privasi identitas `@lid`.

### 1. Menghasilkan Kunci Rahasia HMAC & Mengisi `.env`

Jalankan perintah berikut di terminal untuk menghasilkan string acak 32-byte (64 karakter heksadesimal) yang aman:

```bash
openssl rand -hex 32
```

Salin hasil keluaran tersebut dan tempelkan ke variabel `WAHA_WEBHOOK_HMAC_KEY` di file `.env`. Pastikan variabel terkait WhatsApp di `.env` telah terisi:

```env
WAHA_BASE_URL="http://127.0.0.1:3001"
WAHA_SESSION="default"
WAHA_API_KEY=""
WAHA_WEBHOOK_HMAC_KEY="<hasil_keluaran_openssl_rand_hex_32>"
WA_GATEWAY_MODE="waha"

# Kredensial Dasbor & Swagger WAHA
WAHA_DASHBOARD_ENABLED="true"
WAHA_DASHBOARD_USERNAME="admin"
WAHA_DASHBOARD_PASSWORD="<password_admin_waha_anda>"
```

> **Catatan Keamanan:** Sistem menerapkan prinsip *fail-closed*. Jika `WAHA_WEBHOOK_HMAC_KEY` kosong, kurang dari 32 karakter, atau masih memakai teks placeholder contoh, endpoint webhook akan otomatis menolak semua permintaan dengan status `503 Service Unavailable`.

### 2. Menjalankan Container WAHA

Setelah konfigurasi `docker-compose.yml` disetujui dan diterapkan, jalankan service WAHA di latar belakang:

```bash
docker compose up -d waha
```

Periksa status container:

```bash
docker compose ps waha
```

### 3. Memverifikasi Autentikasi API Key WAHA (Uji 401 & 200)

Sebelum menghubungkan sesi WhatsApp, verifikasi bahwa proteksi API Key pada endpoint WAHA ditegakkan dengan benar:

1. **Uji Tanpa API Key (Harus Ditolak 401 Unauthorized):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/sessions
   ```
   *Ekspektasi keluaran:* `401`

2. **Uji Dengan API Key Valid (Harus Diterima 200 OK):**
   ```bash
   # Ganti <API_KEY> dengan nilai WAHA_API_KEY yang Anda pasang di .env
   curl -s -o /dev/null -w "%{http_code}\n" -H "X-Api-Key: <API_KEY>" http://127.0.0.1:3001/api/sessions
   ```
   *Ekspektasi keluaran:* `200`

3. **Apa yang Harus Dilakukan Jika Hasil Uji Tidak Sesuai:**
   - **Jika tanpa header tetap menghasilkan `200` (API Key tidak ditegakkan):**
     1. Periksa file `.env`, pastikan variabel `WAHA_API_KEY` telah diisi dan tidak kosong.
     2. Pastikan file `docker-compose.yml` memetakan `- WAHA_API_KEY=${WAHA_API_KEY}` pada blok `environment` service `waha`.
     3. Terapkan ulang konfigurasi environment ke container dengan perintah:
        ```bash
        docker compose up -d --force-recreate waha
        ```
     4. Periksa log container untuk memastikan WAHA membaca konfigurasi keamanan:
        ```bash
        docker compose logs waha | grep -i "api key"
        ```
   - **Jika dengan header `X-Api-Key` tetap menghasilkan `401`:**
     1. Pastikan nama header adalah `X-Api-Key` persis (huruf besar-kecil) dan bukan `Authorization: Bearer`.
     2. Pastikan nilai kunci yang dikirim tidak memuat karakter spasi atau tanda kutip tambahan yang tidak sengaja terbawa dari `.env`.
     3. Restart container dengan `docker compose restart waha` lalu coba kembali.

### 4. Memindai QR Code dengan Nomor Cadangan

1. Buka browser dan kunjungi dasbor WAHA di **http://127.0.0.1:3001/dashboard**.
2. Masuk menggunakan username (`admin`) dan password yang telah Anda tentukan di `.env` (`WAHA_DASHBOARD_PASSWORD`).
3. Pilih session `default`.
4. Buka aplikasi WhatsApp di **ponsel dengan nomor cadangan** (jangan gunakan nomor utama sebelum siap rilis).
5. Masuk ke **Menu > Perangkat Tertaut > Tautkan Perangkat**, lalu pindai kode QR yang muncul di layar dasbor.
6. Tunggu hingga status session berubah menjadi **WORKING** / **CONNECTED**.

### 5. Menguji Pesan Masuk secara Interaktif

Kirimkan pesan dari nomor WhatsApp lain (misal ponsel pribadi Anda) ke nomor cadangan yang tertaut pada bot:

1. **Uji Menu Utama:**
   - Kirim pesan: `MENU` atau `Halo`
   - Bot akan membalas dengan menu pilihan 1 (Layanan & Harga), 2 (Format Pemesanan), dan 3 (Cek Status Pesanan).

2. **Uji Katalog Layanan:**
   - Kirim pesan: `1`
   - Bot akan menampilkan daftar layanan aktif beserta harga Rupiah dan estimasi hari pengerjaan.

3. **Uji Format Pemesanan:**
   - Kirim pesan: `2`
   - Bot akan mengirimkan template format pemesanan cuci sepatu.
   - *Catatan Nomor Urut Layanan:* Angka layanan pada baris barang (misalnya `1 | 1 | Sneakers Putih`) merujuk pada **nomor urut (1..N)** di daftar layanan aktif yang ditampilkan bot (perintah `1`), bukan ID internal database. Pelanggan juga dapat menuliskan nama layanan secara langsung (misalnya `Deep Clean`). Angka yang melebihi jumlah layanan aktif dalam katalog akan ditolak dengan petunjuk perbaikan spesifik.

4. **Uji Pembuatan Tiket via Pesan:**
   - Kirimkan format pemesanan contoh:
     ```text
     Nama: Budi Santoso
     Barang: 1 | 1 | Sneakers Putih Nike Air Force
     Antar/Jemput: Antar sendiri
     ```
   - Bot akan memvalidasi pesanan, membuat tiket di database dengan status `Belum dicuci` & `Belum bayar`, dan membalas konfirmasi lengkap dengan kode tiket `SM-YYYYMMDD-XXX`.

5. **Uji Pengecekan Status Pesanan:**
   - Kirim pesan: `3` atau `cek` (bot menampilkan daftar cucian aktif).
   - Kirim pesan: `cek <KODE_TIKET>` (contoh: `cek SM-20261108-001`) untuk melihat detail perkembangan cucian.

### 6. Menjalankan Pengujian Otomatis

Rangkaian pengujian otomatis bot WhatsApp (menggunakan mock gateway tanpa panggilan ke nomor WhatsApp sungguhan) dapat dijalankan kapan saja di database uji `solemate_test`:

```bash
npm run test:wa-6a
```

### 7. Catatan Privasi Akun @lid & Migrasi 0011

- **Tiket sebelum migrasi 0011:** Tiket sumber WhatsApp yang dibuat sebelum migrasi 0011 tidak memiliki atribut `chat_hash` dan tidak dapat dicek statusnya melalui bot WhatsApp. Data tiket tersebut tidak boleh diisi ulang secara spekulatif dengan menebak-nebak identitas pengirim.
- **Pengecekan Status Bersatu:** Pengecekan status ("3" atau "cek") hanya mencari pesanan dengan satu kriteria ketat: nomor telepon terverifikasi milik pengirim ATAU `chat_hash` HMAC yang cocok dengan ID chat pengirim. Nomor yang diketik manual di badan pesan tidak pernah digunakan untuk membuka tiket.

### 8. Notifikasi Otomatis WhatsApp "Siap Diambil" (Phase 6B, FR-24)

Sistem mengirimkan notifikasi WhatsApp otomatis saat cucian sepatu selesai dan status tiket diubah menjadi `Siap diambil` oleh kasir.

#### 1. Konfigurasi Lingkungan (`.env`)

Untuk mengaktifkan pengiriman notifikasi otomatis di produksi:
```env
# Saklar utama notifikasi WhatsApp keluar ('true' untuk aktif, default 'false')
WA_NOTIFIKASI_AKTIF=true
```
Di lingkungan pengujian otomatis (`solemate_test`), saklar aktif secara bawaan demi keterujian fitur.

#### 2. Aturan Pengiriman & Privasi (Zero Trust)
1. **Nomor Tepercaya Saja (FR-25):** Notifikasi hanya dikirim ke nomor yang terverifikasi resmi oleh webhook gateway (`nomor_terverifikasi = true` pada tiket WA) atau nomor yang diketik langsung oleh kasir di toko (`sumber = 'toko'`). Tiket WA dengan nomor tidak terverifikasi ditandai `dilewati` dengan alasan `nomor_tidak_terverifikasi`.
2. **Kerahasiaan Isi Pesan:** Pesan hanya memuat kode tiket, konfirmasi bahwa sepatu sudah selesai dan siap diambil, serta status pembayaran (`Belum bayar` atau `Lunas`). Pesan **tidak** memuat nama pelanggan, harga cucian, nama toko, alamat, atau jam operasional.
3. **Pengecekan Nomor Terdaftar di WhatsApp (WAHA):**
   - Sebelum mengirim, sistem memverifikasi bahwa nomor terdaftar di WhatsApp melalui endpoint WAHA:
     `GET /api/contacts/check-exists?phone={phone}&session={session}` (Dokumentasi: https://waha.devlike.pro/docs/how-to/contacts/).
   - Respons yang diharapkan: `{ numberExists: boolean, chatId?: string | null }`.
   - *Catatan Keamanan:* Karena WAHA saat ini hanya menyediakan metode `GET` untuk pengecekan kontak, nomor telepon berada pada URL query string permintaan ke container WAHA lokal.
   - Jika nomor dipastikan tidak terdaftar di WhatsApp (`numberExists === false`), baris ditandai `dilewati` (`nomor_tidak_terdaftar_wa`).
   - Jika endpoint WAHA mengalami galat jaringan, timeout, atau mengembalikan HTTP 5xx, baris ditandai `gagal` sementara (`GATEWAY_CHECK_GAGAL`), **bukan** dianggap nomor tidak terdaftar.
4. **Idempotensi & Pencegahan Dobel:**
   - Antrean `wa_notifikasi` memiliki constraint `UNIQUE (order_id, jenis)`.
   - Transisi status pesanan dan pencatatan antrean berada dalam transaksi database yang sama.
   - Pengiriman keluar menggunakan klaim atomik (`UPDATE ... WHERE status IN ('menunggu', 'gagal') RETURNING`) sehingga proses serentak atau klik ganda kasir tidak akan menduplikasi pesan.
   - Koreksi status mundur (misal kembali ke `Diproses`) dan maju kembali ke `Siap diambil` tidak akan memicu pengiriman ganda.
5. **Penanganan Baris Macet:** Baris yang macet pada status `mengirim` lebih dari 2 menit (misalnya akibat proses server terhenti mendadak) dapat diambil alih dan diproses kembali secara aman oleh pemanggil berikutnya.
6. **Pembatasan Laju (Rate Limit):**
   - Batas keluar: maksimal 20 pesan per menit dan 300 pesan per jam.
   - Jika batas tercapai, baris **tidak** ditandai gagal, melainkan tetap berstatus `menunggu` dengan `kode_galat = 'RATE_LIMIT_TERCAPAI'`. UI kasir menampilkan status "Ditunda karena batas laju".
7. **Tanpa Pemroses Latar Otomatis (No Background Worker/Cron):**
   - Tidak ada daemon atau cron otomatis yang melakukan retry pengiriman secara berkala.
   - Pengiriman ulang dilakukan secara manual oleh kasir melalui tombol "Kirim Ulang Notifikasi" di halaman Detail Tiket.
8. **Kebijakan Kirim Ulang Kasir:**
   - Tombol dan endpoint `POST /api/tiket/[id]/notifikasi` hanya diizinkan untuk notifikasi berstatus `gagal`, `menunggu` karena `RATE_LIMIT_TERCAPAI`, atau `dilewati` karena `saklar_mati` (setelah saklar server dinyalakan).
   - Status `dilewati` dengan alasan `opt_out_pelanggan`, `nomor_tidak_terverifikasi`, dan `nomor_tidak_terdaftar_wa` **dilarang keras** untuk dikirim ulang (tombol disembunyikan di UI dan server menolak dengan HTTP 409).
9. **Preferensi Pelanggan (Opt-Out):**
   - Pelanggan dengan nomor terverifikasi dapat mengirimkan pesan WhatsApp `STOP` untuk berhenti menerima notifikasi, atau `MULAI` untuk mengaktifkan kembali.
   - Pengirim `@lid` yang tidak terpetakan nomornya dan mengetik `STOP` tidak menyentuh data siapa pun (dibalas dengan pesan petunjuk).
   - Untuk pelanggan tiket toko yang datang langsung (walk-in), kasir dapat mencentang opsi "Jangan kirim notifikasi WhatsApp otomatis ke pelanggan ini" pada form Buat Tiket atau mengubah toggle preferensi di Detail Tiket.
   - *Catatan Asumsi:* Penerapan notifikasi ke pelanggan toko (FR-25) didasarkan pada asumsi nomor yang dicatat kasir di kasir toko adalah nomor sah milik pelanggan; jika pemilik menginginkan verifikasi tambahan untuk pelanggan walk-in, opsi ini dapat disesuaikan lebih lanjut.

#### 3. Menjalankan Pengujian Otomatis Phase 6B

Pengujian otomatis Phase 6B dijalankan pada database uji `solemate_test` dengan gateway tiruan (`mock`):

```bash
START_TEST_SERVER=1 node --env-file=.env scripts/with-test-db.mjs --experimental-strip-types --test 'tests/wa-notifikasi-6b.test.mjs'
```

## Rekap Bulanan & Ekspor Laporan (Phase 7B & FR-53)

Halaman `/rekap-bulanan` (khusus **owner**) menampilkan ringkasan pesanan masuk, pembayaran diterima (cash & non-cash), layanan terlaris, kartu Laba Rugi (FR-52), serta fitur tambahan tim **FR-53: Ekspor ke Excel (`.xlsx`) dan PDF**.

### Cara Menggunakan Ekspor
1. Login sebagai `owner` dan buka `/rekap-bulanan`.
2. Pilih periode **Bulan ini**, **Bulan lalu**, atau **Rentang tanggal** (`dari` s/d `sampai`, maks 366 hari) dan klik **Terapkan**.
3. Klik **Unduh Excel** atau **Unduh PDF** pada header halaman. Sistem mengirimkan rentang tanggal yang sedang ditampilkan (`periode=rentang&dari=...&sampai=...`) ke endpoint `GET /api/rekap-bulanan/ekspor`, sehingga berkas yang diunduh selalu sesuai dengan tanggal di layar meski berganti bulan.
4. Setiap ekspor dicatat ke `audit_logs` dengan aksi `EKSPOR_REKAP` (*fail-closed*: jika pencatatan audit gagal, berkas tidak dikirim). Berkas ekspor tidak memuat data pribadi pelanggan (`nama_pelanggan`, `nomor_wa`) maupun daftar per tiket.
5. **Catatan Pembulatan:** Persentase setiap baris layanan terlaris (termasuk baris `Lainnya`) menggunakan pembulatan jujur 1 desimal dari porsi aslinya terhadap total pasang sehingga baris `Lainnya` yang berisi pasang tidak bernilai `0,0%` atau negatif; total persentase yang tampil dapat berkisar `99,9%–100,1%`. Catatan ini ditampilkan konsisten pada halaman web, Excel, maupun PDF.

### Persyaratan Hosting & Deployment untuk PDF (`pdfkit`)
- `next.config.ts` mengaktifkan `serverExternalPackages: ["pdfkit"]` karena `pdfkit` membaca berkas data font standar `.afm` (`Helvetica` / `Helvetica-Bold`) secara langsung dari `node_modules/pdfkit/js/data/` saat runtime.
- Jika melakukan deployment ke container Docker atau server terpisah, pastikan direktori `node_modules` (khususnya `pdfkit` dan dependensinya) ikut disalin/terpasang pada lingkungan runtime produksi, bukan dihilangkan oleh bundling terisolasi tanpa aset font.

## Fitur Karyawan & Absensi (Ditunda — Phase 8A)

Fitur Karyawan dan Absensi (`FR-70`–`FR-72`) saat ini ditunda (`KARYAWAN_ABSENSI_AKTIF = false` pada [`src/config/fitur.ts`](src/config/fitur.ts)):
- Menu `Karyawan`, `Rekap Absensi`, dan `Absensi` (desktop sidebar, navigasi ponsel, serta tautan absen di halaman login) disembunyikan.
- Halaman & API `/karyawan`, `/rekap-absensi`, `/api/karyawan`, dan `/api/rekap-absensi` mengembalikan HTTP `404` yang identik untuk `owner` dan `kasir`, serta tetap mengarahkan pengunjung anonim ke `/login`.
- Halaman `/absensi` mengembalikan HTTP `404` untuk seluruh pengunjung termasuk anonim (tanpa redirect ke `/login`).
- Berkas halaman/API, skema tabel `employees` & `attendance`, seed, dan skrip manajemen akun tetap dipertahankan tanpa dihapus.

**Cara mengaktifkan kembali:** ubah `export const KARYAWAN_ABSENSI_AKTIF: boolean = false;` menjadi `true` pada `src/config/fitur.ts`, lalu build/restart server.

## Kesiapan produksi (Phase 9A)

Bagian ini mendokumentasikan konfigurasi kesiapan produksi untuk demo/deployment di **Vercel** (fungsi serverless, zona waktu mesin `UTC`, tanpa proses latar permanen) dengan **PostgreSQL terkelola** (mis. **Neon**, connection string berpooler + SSL) dan **WAHA** pada server terpisah.

### 1. Tabel Variabel Lingkungan

| Nama Variabel | Lokal (Dev) | Produksi (Runtime Vercel) | Contoh Nilai (Tanpa Rahasia) | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL_APP` | Opsional (direkomendasikan) | **WAJIB** | `postgresql://solemate_app:<PASSWORD>@ep-contoh-pooler.ap-southeast-1.aws.neon.tech/solemate?sslmode=require` | **Satu-satunya** URL database yang dibaca runtime aplikasi (`src/lib/db.ts`). Wajib memakai role terbatas `solemate_app` dan endpoint `-pooler` (PgBouncer transaction mode) dengan SSL. |
| `DATABASE_URL` | **WAJIB** | **DILARANG DI RUNTIME VERCEL** | `postgresql://solemate:<PASSWORD>@ep-contoh.ap-southeast-1.aws.neon.tech/solemate?sslmode=require` | URL admin / pemilik skema (endpoint direct tanpa `-pooler`). **Hanya** dipakai dari mesin lokal untuk `migrate:up`, `migrate:down`, `migrate:status`, `create-user`, `reset-pin`, `seed`, dan `with-test-db`. |
| `APP_DB_PASSWORD` | Wajib saat `migrate:up` 0003 | Tidak dipasang di Vercel | `<minimal_8_karakter_acak>` | Dipakai oleh migrasi `0003_app_user.js` dari mesin lokal saat membuat role `solemate_app`. |
| `DB_POOL_MAX` | Opsional (default `10`) | Opsional (default `5`) | `5` | Batas maksimum koneksi per instance fungsi serverless agar tidak menghabiskan kuota koneksi pooler. |
| `DB_POOL_IDLE_TIMEOUT_MS` | Opsional (default `10000`) | Opsional (default `5000`) | `5000` | Waktu tutup koneksi menganggur (ms); dikombinasikan dengan `allowExitOnIdle: true`. |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | Opsional (default `10000`) | Opsional (default `10000`) | `10000` | Batas waktu tunggu pembukaan koneksi baru (ms). |
| `DB_SSL` | Opsional (default `false` untuk `127.0.0.1`/`localhost`) | Otomatis `true` (`false` **ditolak**) | `true` | Di produksi SSL wajib aktif; menyetel `DB_SSL=false` akan ditolak (*fail-closed*). |
| `DB_SSL_REJECT_UNAUTHORIZED` | Opsional | Otomatis `true` (`false` **ditolak**) | `true` | Di produksi verifikasi sertifikat TLS wajib `rejectUnauthorized: true`; menyetel `false` akan ditolak (*fail-closed*). |
| `SESSION_SECRET` | **WAJIB** (≥ 32 karakter) | **WAJIB** (≥ 32 karakter, bukan contoh) | `<64_karakter_hex_acak>` | Kunci rahasia HMAC sesi & pencacahan rate-limit WA. Nilai placeholder dari `.env.example` ditolak saat startup produksi. |
| `SESSION_TTL_SECONDS` | Opsional (default `28800`) | Opsional (default `28800`) | `28800` | Masa berlaku cookie sesi dalam detik (default 8 jam). |
| `APP_ORIGIN` | Opsional (default `Host` lokal) | **WAJIB** (`https://`) | `https://solemate-demo.vercel.app` | Daftar origin publik aplikasi (dipisahkan koma jika >1). Di produksi wajib berskema `https://` dan dipakai untuk validasi header `Origin` pada seluruh rute mutasi (`POST`/`PUT`/`PATCH`/`DELETE`). |
| `TRUST_PROXY` | Opsional (`false`) | Opsional (`true` di Vercel) | `true` | Bila `true`, `ambilIpKlien` membaca IP pertama dari `X-Forwarded-For` untuk pembatasan laju percobaan login per IP. |
| `WA_GATEWAY_MODE` | Opsional (default `waha`; `mock` saat tes) | **WAJIB** eksplisit (`waha` atau `nonaktif`) | `waha` atau `nonaktif` | Di produksi wajib disetel eksplisit ke `waha` atau `nonaktif`. Nilai kosong atau `mock` ditolak (*fail-closed*). Jika `nonaktif`, webhook membalas `503` dan notifikasi keluar dilewati dengan alasan `saklar_mati` tanpa membutuhkan `WAHA_*`. |
| `WAHA_BASE_URL` | Wajib jika mode `waha` | **WAJIB** jika `WA_GATEWAY_MODE=waha` | `https://waha.contoh-domain.id` | URL publik/tunnel menuju mesin WAHA. |
| `WAHA_API_KEY` | Opsional di lokal | **WAJIB** jika `WA_GATEWAY_MODE=waha` | `<kunci_api_waha_acak>` | Kunci autentikasi header `X-Api-Key` ke REST API WAHA (bukan nilai contoh). |
| `WAHA_SESSION` | Opsional (default `default`) | Opsional (default `default`) | `default` | Nama sesi aktif pada WAHA. |
| `WAHA_WEBHOOK_HMAC_KEY` | Wajib untuk uji webhook | **WAJIB** jika `WA_GATEWAY_MODE=waha` (≥ 32 karakter) | `<64_karakter_hex_acak>` | Kunci rahasia verifikasi tanda tangan `X-Webhook-Hmac` (HMAC-SHA512). |
| `WA_NOTIFIKASI_AKTIF` | Opsional (`false`) | Opsional (`true` / `false`) | `true` | Saklar utama pengiriman notifikasi keluar "Siap diambil" otomatis. |

> **Peringatan Penting tentang `DATABASE_URL` dan Integrasi Marketplace Neon di Vercel:**
> 1. **JANGAN PERNAH** memasang `DATABASE_URL` (kredensial admin/pemilik skema) di Environment Variables proyek Vercel. Runtime aplikasi di produksi **hanya** membaca `DATABASE_URL_APP` dan menolak jatuh kembali (*no fallback*) ke `DATABASE_URL`.
> 2. Jika Anda menghubungkan Neon melalui **Vercel Marketplace Integration**, integrasi tersebut secara otomatis menyuntikkan variabel `DATABASE_URL` / `POSTGRES_URL` menggunakan **role pemilik database (owner/neondb_owner)** yang memiliki hak penuh (`DROP TABLE`, `TRUNCATE`, `DELETE` pada `audit_logs`). **Jangan gunakan variabel suntikan otomatis tersebut untuk runtime!** Buat variabel `DATABASE_URL_APP` secara manual di Vercel yang menunjuk ke role terbatas `solemate_app` melalui hostname `-pooler` dengan `?sslmode=require`, dan hapus `DATABASE_URL` dari lingkungan runtime Vercel jika disuntikkan otomatis.

### 2. Pengaturan Deployment & Daftar Eksplisit Env di Vercel

- **`APP_ORIGIN` sebelum deploy pertama:** `APP_ORIGIN` **wajib** sudah diisi dengan alamat produksi tetap (`https://NAMA-PROYEK.vercel.app`) **sebelum deploy pertama**.
- **Perilaku Preview Deployment vs Produksi:** Semua permintaan ubah data (`POST`, `PUT`, `PATCH`, `DELETE`) yang dikirim dari URL *preview deployment* Vercel akan **ditolak (`403`)** oleh penjaga `Origin`, **kecuali** URL *preview* tersebut ikut didaftarkan di `APP_ORIGIN` (dipisahkan dengan koma, contoh: `https://NAMA-PROYEK.vercel.app,https://solemate-git-demo-tim.vercel.app`).
- **Rekomendasi untuk demo:** Gunakan **satu deployment produksi** tetap agar `APP_ORIGIN` selalu konsisten dan tidak perlu memperbarui daftar URL setiap ada *preview* baru.

**Daftar eksplisit Environment Variables yang dipasang di Vercel (hanya variabel runtime, TANPA `DATABASE_URL` admin):**

1. **Wajib dipasang (semua skenario):**
   - `DATABASE_URL_APP` — URL pooler Neon milik role terbatas `solemate_app` (`postgresql://solemate_app:<PASSWORD>@ep-xxx-pooler.<region>.aws.neon.tech/solemate?sslmode=require`)
   - `SESSION_SECRET` — string acak ≥ 32 karakter (bukan nilai contoh)
   - `APP_ORIGIN` — `https://NAMA-PROYEK.vercel.app` (diisi sebelum deploy pertama)
   - `WA_GATEWAY_MODE` — wajib eksplisit: `waha` atau `nonaktif`
2. **Wajib tambahan bila `WA_GATEWAY_MODE=waha`:**
   - `WAHA_BASE_URL` — URL HTTPS publik/tunnel ke server WAHA
   - `WAHA_API_KEY` — kunci API WAHA asli
   - `WAHA_WEBHOOK_HMAC_KEY` — kunci HMAC webhook ≥ 32 karakter acak
   - `WAHA_SESSION` — opsional (default `default`)
   - `WA_NOTIFIKASI_AKTIF` — `true` atau `false` (default `false`)
3. **Opsional runtime (nilai default produksi sudah aman):**
   - `TRUST_PROXY=true` (untuk pembacaan IP dari proxy Vercel saat rate-limit login)
   - `SESSION_TTL_SECONDS=28800`
   - `DB_POOL_MAX=5`
   - `DB_POOL_IDLE_TIMEOUT_MS=5000`
   - `DB_POOL_CONNECTION_TIMEOUT_MS=10000`
4. **TIDAK boleh dipasang di Vercel:** `DATABASE_URL` (kredensial admin), `APP_DB_PASSWORD`, `DB_SSL=false`, `DB_SSL_REJECT_UNAUTHORIZED=false`.

### 3. Migrasi Database & Pembuatan Role Terbatas `solemate_app` di Postgres Terkelola (Neon)

Migrasi skema (`node-pg-migrate`) serta skrip CLI (`create-user`, `reset-pin`) selalu dijalankan **dari terminal mesin lokal** menggunakan koneksi **Direct (unpooled)** pada `DATABASE_URL` (bukan endpoint `-pooler`, karena migrasi DDL dan transaksi perubahan skema memerlukan sesi langsung).

1. **Kasus A — Role Admin Memiliki Hak `CREATEROLE`:**
   - Di Neon, Anda dapat membuat role `solemate_app` terlebih dahulu melalui **Neon Console -> Roles -> New Role** (atau jika role admin Anda memiliki `CREATEROLE`), lalu jalankan migrasi dari mesin lokal:
     ```bash
     DATABASE_URL="postgresql://<admin_user>:<admin_pass>@ep-xxx.ap-southeast-1.aws.neon.tech/solemate?sslmode=require" \
     APP_DB_PASSWORD="<password_kuat_solemate_app>" \
     npm run migrate:up
     ```
2. **Kasus B — Role Default Tidak Memiliki `CREATEROLE` penuh:**
   - Buat role `solemate_app` melalui **Neon Console** (atau dashboard penyedia Postgres terkelola) dan catat password-nya.
   - Karena migrasi [`migrations/0003_app_user.js`](migrations/0003_app_user.js) memeriksa `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solemate_app')`, jika role `solemate_app` sudah dibuat dari Console tetapi role `neondb_owner` tidak diizinkan menjalankan `ALTER ROLE solemate_app WITH PASSWORD ...`, Anda dapat membuat/mengatur password role dari Console dan memastikan hibah hak terbatas (`GRANT CONNECT`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT, INSERT, UPDATE` pada tabel aplikasi, serta `GRANT INSERT, SELECT ON audit_logs` tanpa `UPDATE`/`DELETE`) teraplikasi sesuai isi `migrations/0003_app_user.js`.
3. **Verifikasi Status Migrasi:**
   ```bash
   DATABASE_URL="postgresql://<admin_user>:<admin_pass>@ep-xxx.ap-southeast-1.aws.neon.tech/solemate?sslmode=require" \
   npm run migrate:status
   ```

### 4. Membuat Akun `owner` Produksi & Mereset PIN 6 Digit

Skrip `seed.js` **tidak pernah** membuat akun pengguna dan ditolak di `NODE_ENV=production`. Untuk membuat akun `owner` atau `kasir` pertama di database produksi, jalankan skrip interaktif dari mesin lokal menggunakan `DATABASE_URL` (direct + SSL):

```bash
# Membuat akun owner atau kasir baru (PIN 6 digit diketik tersembunyi, di-hash dengan Argon2id)
DATABASE_URL="postgresql://<admin_user>:<admin_pass>@ep-xxx.ap-southeast-1.aws.neon.tech/solemate?sslmode=require" \
npm run create-user

# Mereset PIN 6 digit akun yang sudah ada sekaligus membuka kunci rate-limit akun
DATABASE_URL="postgresql://<admin_user>:<admin_pass>@ep-xxx.ap-southeast-1.aws.neon.tech/solemate?sslmode=require" \
npm run reset-pin
```

### 5. Perbandingan Lingkungan Lokal vs Produksi

1. **Zona Waktu (`UTC` vs `Asia/Jakarta` WIB):**
   - Fungsi serverless Vercel berjalan di zona waktu `UTC`. Seluruh pemformatan tampilan tanggal/jam (`formatTanggal`, `formatWaktu`, `formatTanggalYmdWib`, `formatKodeTanggalWib`, `formatDatetimeLocalWib` pada `src/lib/format.ts`) menggunakan `Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hourCycle: "h23" })` sehingga pukul `00.00 WIB` selalu tampil `00.00 WIB` (bukan `24.00 WIB`) dan kode tiket `SM-YYYYMMDD-NNN` maupun batas hari laporan selalu mengikuti kalender WIB terlepas dari `TZ` mesin.
2. **Pekerjaan Latar Belakang (`after()` dari `next/server`):**
   - Di serverless, fungsi dapat dibekukan segera setelah HTTP response dikirim. Pengiriman notifikasi WhatsApp otomatis (`PATCH /api/tiket/[id]` melalui `jadwalkanPengirimanNotifikasiSiapDiambil`) dan pembersihan catatan WA usang (`POST /api/wa/webhook`) dijadwalkan di dalam `after()` dari `next/server`.
   - Header pengujian `x-sync-notifikasi: 1` **hanya** dihormati saat `NODE_ENV !== "production"`; di produksi header ini diabaikan sehingga pemanggil eksternal tidak dapat memaksa eksekusi sinkron.
3. **Koneksi Database, Pooler (PgBouncer Transaction Mode), & `attachDatabasePool`:**
   - Seluruh query di `src/` dan `scripts/` bebas dari state tingkat sesi (`SET` non-lokal, `pg_advisory_*`, `LISTEN/NOTIFY`, `PREPARE`/named statement, maupun tabel `TEMP`), sehingga kompatibel penuh dengan PgBouncer *transaction mode* (`-pooler` di Neon).
   - Pool menggunakan singleton `globalThis` dengan `max: 5` (produksi), `idleTimeoutMillis: 5000`, `connectionTimeoutMillis: 10000`, `allowExitOnIdle: true`, serta listener `pool.on("error")` yang hanya mencatat kode galat (`ekstrakKodeGalatAman`) tanpa membocorkan query atau data.
   - *Catatan tentang `attachDatabasePool` (`@vercel/functions`):* Helper `attachDatabasePool` hanya diperlukan bila fitur **Vercel Fluid Compute** diaktifkan (di mana satu instance tetap hidup di antara banyak invocasi konkuren dan memerlukan pelepasan koneksi idle khusus sebelum suspend). Pada fungsi serverless standar dengan endpoint pooler Neon (`-pooler`) serta konfigurasi `max: 5`, `idleTimeoutMillis: 5000`, dan `allowExitOnIdle: true`, paket tambahan `@vercel/functions` tidak diperlukan.
4. **Pemeriksaan Origin (`APP_ORIGIN`), Cookie Sesi, & `TRUST_PROXY`:**
   - `periksaPermintaanUbah` (`src/lib/request-guard.ts`) **tidak** mempercayai `x-forwarded-host`. Di produksi, setiap permintaan mutasi wajib memiliki header `Origin` berskema `https://` yang cocok dengan daftar `APP_ORIGIN`.
   - Cookie sesi `solemate_session` (`src/lib/session.ts`) disetel dengan `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, dan `secure: process.env.NODE_ENV === "production"`.
   - Saat `TRUST_PROXY=true` di Vercel, `ambilIpKlien` (`src/lib/ip.ts`) mengambil elemen pertama dari header `X-Forwarded-For` yang ditimpa oleh edge proxy Vercel untuk keperluan rate-limit login per IP (20 gagal / 15 menit) di samping kunci per akun (5 gagal / 15 menit).
5. **Penjaga Rute Pengembangan & Seed:**
   - Di `NODE_ENV=production`, rute `/dev`, `/dev/*`, dan `/detail-tiket` mengembalikan HTTP `404` untuk seluruh pengunjung termasuk anonim (dijaga di `src/proxy.ts` dan di komponen halaman melalui `apakahRuteDevTerblokir`).
   - `scripts/seed.js` menolak berjalan di `NODE_ENV=production` (`exit 1`) melalui fungsi murni `periksaIzinSeed`.
6. **Bundling Font `pdfkit` untuk Ekspor PDF (`/api/rekap-bulanan/ekspor`):**
   - `next.config.ts` sudah mengonfigurasi `outputFileTracingIncludes` untuk rute `/api/rekap-bulanan/ekspor` agar berkas metrik font `.afm` (`./node_modules/pdfkit/js/data/**/*`) ikut dibundle ke fungsi serverless Vercel. Verifikasi akhir dilakukan langsung dengan **mengunduh PDF rekap bulanan dari halaman `/rekap-bulanan` di deployment Vercel**.

### 6. Cara Menguji Mode Produksi (Vercel & Alternatif Lokal yang Aman)

- **Cara utama (disarankan):** Uji mode produksi melalui **deployment produksi di Vercel** (`https://NAMA-PROYEK.vercel.app`) yang terhubung ke Neon (`?sslmode=require`), lalu unduh Excel dan PDF di `/rekap-bulanan` untuk memverifikasi fungsi serverless beserta font `pdfkit`.
- **Apa yang terjadi jika menjalankan `npm run build` lalu `npm run start` langsung dengan `.env` lokal (`APP_ORIGIN` kosong/`http://`, Postgres lokal tanpa SSL):**
  1. `npm run build` selesai karena fase build (`NEXT_PHASE=phase-production-build`) sengaja melewati pemeriksaan runtime.
  2. Saat `npm run start` (`NODE_ENV=production`) dijalankan, `src/instrumentation.ts` gagal memuat hook dengan galat `[ENV_PRODUKSI_TIDAK_VALID]` (`Failed to prepare server ...`), dan seluruh permintaan HTTP (`GET /login`, `POST /api/login`) dijawab **HTTP `500`** — sehingga **login tidak dapat bekerja**.
  3. Bila pun env `APP_ORIGIN` diisi `https://...`, koneksi ke Postgres lokal tanpa SSL tetap gagal saat runtime dengan galat `The server does not support SSL connections` (`HTTP 500`), rute mutasi berpenjaga `Origin` (seperti `POST /api/tiket`, `PATCH /api/tiket/[id]`) tetap menolak permintaan `http://`, dan cookie sesi ditandai `Secure`. Kode produksi sengaja tidak menyediakan pengecualian untuk melonggarkan aturan ini.
- **Cara aman menguji mode produksi secara lokal tanpa Vercel (opsional):**
  - Gunakan database Postgres yang memiliki **TLS/SSL valid** (mis. cabang terpisah/staging di Neon atau Postgres lokal ber-TLS dengan sertifikat tepercaya — **jangan** pakai `DB_SSL_REJECT_UNAUTHORIZED=false`), **dan**
  - Jalankan *reverse proxy* HTTPS / tunnel lokal di depan `npm run start` (mis. Caddy TLS lokal + `mkcert` atau Cloudflare Tunnel) dengan `TRUST_PROXY=true` serta `APP_ORIGIN=https://<domain-https-lokal>`.

### 7. Checklist Pra-Hosting (Sebelum Demo / Go-Live)

- [ ] Buat database di Neon, jalankan migrasi `0001` s/d `0006` dari mesin lokal via URL **Direct** (`DATABASE_URL` + `?sslmode=require`).
- [ ] Pastikan role terbatas `solemate_app` telah dibuat dan hanya memiliki hak sesuai `0003_app_user.js` (tanpa hak `UPDATE`/`DELETE` pada `audit_logs`).
- [ ] Buat akun `owner` dan `kasir` awal dari mesin lokal dengan `npm run create-user` (jangan jalankan `seed.js` di produksi).
- [ ] Sebelum deploy pertama di Vercel, pasang hanya variabel runtime (`DATABASE_URL_APP`, `SESSION_SECRET`, `APP_ORIGIN=https://NAMA-PROYEK.vercel.app`, `WA_GATEWAY_MODE` beserta `WAHA_*` jika `waha`, `TRUST_PROXY=true`) dan pastikan **TIDAK** ada `DATABASE_URL` admin.
- [ ] Verifikasi di **deployment produksi Vercel** (`https://NAMA-PROYEK.vercel.app`): login `owner` & `kasir`, buat tiket baru (kode tiket sesuai tanggal WIB), ubah status tiket, pastikan `/dev/komponen` dan `/detail-tiket` mengembalikan `404`, serta uji **unduh Excel & PDF di `/rekap-bulanan`** (sebagai verifikasi final `outputFileTracingIncludes` untuk `pdfkit`).

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
