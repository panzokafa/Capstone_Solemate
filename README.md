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

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
