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
- Per akun: maks 5 percobaan salah per 15 menit → akun terkunci (pra-inkremen atomik sebelum verifikasi PIN).
- Per IP: maks 20 percobaan salah per 30 menit (jika IP diketahui); login berhasil mengembalikan tepat 1 hitungan IP (`GREATEST(gagal - 1, 0)`) tanpa mereset kegagalan sebelumnya.
- **Selama akun terkunci, PIN yang benar pun ditolak** dengan status HTTP (`403`) dan pesan yang identik dengan kegagalan biasa serta verifikasi hash dummy konstan untuk mencegah enumerasi akun. Tunggu 15 menit atau hubungi owner.
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

Setiap percobaan login pada akun terdaftar (berhasil atau gagal) dicatat ke `audit_logs` tanpa PIN, beserta IP (jika diketahui). Nama pengguna yang tidak terdaftar di tabel `users` tetap dihitung pada batas laju per-IP (`login_rate_limit`), namun tidak ditulis ke `audit_logs` agar tabel *append-only* tidak membengkak akibat nama acak. Jika percobaan gagal melebihi batas per `(akun, ip)`, baris ringkasan satu kali direkam daripada dilewatkan.

Catatan audit `login` dan `login_gagal`:
- `login`: login berhasil.
- `login_gagal`: login gagal pada akun terdaftar (sebab: `pin_salah`, `nonaktif`, atau `dikunci`).
- `login_gagal_ringkasan`: batas pencatatan audit tercapai (detail diedit agar tak terlalu banyak baris).

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

**Cara mengaktifkan kembali:** ubah `export const KARYAWAN_ABSENSI_AKTIF: boolean = false;` menjadi `true` pada `src/config/fitur.ts`, buat migrasi baru untuk mengembalikan hak `INSERT, UPDATE` pada tabel `employees`, `attendance` (serta `USAGE, SELECT` pada `employees_id_seq`, `attendance_id_seq`) kepada `solemate_app` yang dicabut di [`migrations/0014_hak_minimum_solemate_app.js`](migrations/0014_hak_minimum_solemate_app.js), lalu build/restart server.

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
| `TRUST_PROXY` | Opsional (`false`) | **WAJIB `true` saat `VERCEL=1`** | `true` | Bila `true`, `ambilIp` membaca IP klien dari proxy tepercaya; di produksi Vercel (`VERCEL=1`), `TRUST_PROXY=true` wajib diatur (*fail-closed*) agar pembatas laju login per-IP aktif. |
| `WA_GATEWAY_MODE` | Opsional (default `waha`; `mock` saat tes) | **WAJIB** eksplisit (`waha` atau `nonaktif`) | `waha` atau `nonaktif` | Di produksi wajib disetel eksplisit ke `waha` atau `nonaktif`. Nilai kosong atau `mock` ditolak (*fail-closed*). Jika `nonaktif`, webhook membalas `503` dan notifikasi keluar dilewati dengan alasan `saklar_mati` tanpa membutuhkan `WAHA_*`. |
| `WAHA_BASE_URL` | Wajib jika mode `waha` | **WAJIB `https://`** jika `WA_GATEWAY_MODE=waha` | `https://waha.contoh-domain.id` | URL publik/tunnel terenkripsi menuju mesin WAHA. Di produksi wajib `https://` kecuali host loopback (`127.0.0.1`/`localhost`/`::1`) atau `WAHA_IZINKAN_HTTP_INTERNAL=true`. |
| `WAHA_IZINKAN_HTTP_INTERNAL` | Opsional (`false`) | Opsional (`false`) | `false` | **Hanya** setel `true` jika WAHA berjalan lewat jaringan internal/VPN tertutup/tunnel terenkripsi (`http://` non-TLS). **Peringatan keamanan:** pada jaringan publik, HTTP polos membuka `X-Api-Key` serta isi pesan/nomor WA pelanggan terhadap penyadapan/MITM. |
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
   - `DATABASE_URL_APP` — URL pooler Neon milik role terbatas `solemate_app` (`postgresql://solemate_app:<PASSWORD>@ep-xxx-pooler.<region>.aws.neon.tech/solemate?sslmode=require`, hapus `&channel_binding=require` bila ada di salinan URL Neon)
   - `SESSION_SECRET` — string acak ≥ 32 karakter (bukan nilai contoh)
   - `APP_ORIGIN` — `https://NAMA-PROYEK.vercel.app` (diisi sebelum deploy pertama)
   - `TRUST_PROXY=true` — **WAJIB** di Vercel (`VERCEL=1`) agar pembatas laju IP login berjalan (*fail-closed* bila kosong/`false`)
   - `WA_GATEWAY_MODE` — wajib eksplisit: `waha` atau `nonaktif`
2. **Wajib tambahan bila `WA_GATEWAY_MODE=waha`:**
   - `WAHA_BASE_URL` — URL `https://` publik/tunnel ke server WAHA (`http://` non-loopback ditolak di produksi kecuali opt-in `WAHA_IZINKAN_HTTP_INTERNAL=true` pada jaringan internal tertutup)
   - `WAHA_API_KEY` — kunci API WAHA asli
   - `WAHA_WEBHOOK_HMAC_KEY` — kunci HMAC webhook ≥ 32 karakter acak
   - `WAHA_SESSION` — opsional (default `default`)
   - `WA_NOTIFIKASI_AKTIF` — `true` atau `false` (default `false`)
3. **Opsional runtime (nilai default produksi sudah aman):**
   - `WAHA_IZINKAN_HTTP_INTERNAL=false` (setel `true` hanya pada jaringan internal tertutup / VPN antar-mesin; membawa risiko tanpa TLS jika melintasi jaringan tidak tepercaya)
   - `SESSION_TTL_SECONDS=28800`
   - `DB_POOL_MAX=5`
   - `DB_POOL_IDLE_TIMEOUT_MS=5000`
   - `DB_POOL_CONNECTION_TIMEOUT_MS=10000` (opsional setel `15000` bila Neon sering bangun dari *cold start* > 10 detik)
4. **TIDAK boleh dipasang di Vercel:** `DATABASE_URL` (kredensial admin), `APP_DB_PASSWORD`, `POSTGRES_*`, `DB_SSL*`, `WAHA_*` (saat `WA_GATEWAY_MODE=nonaktif`).

### 3. Migrasi Database & Pembuatan Role Terbatas `solemate_app` di Postgres Terkelola (Neon)

Migrasi skema (`node-pg-migrate`) serta skrip CLI (`create-user`, `reset-pin`) selalu dijalankan **dari terminal mesin lokal** menggunakan koneksi **Direct (unpooled)** pada `DATABASE_URL` (bukan endpoint `-pooler`, karena migrasi DDL dan transaksi perubahan skema memerlukan sesi langsung). **Hapus `&channel_binding=require`** bila ada pada string koneksi Neon, dan **jangan menyunting berkas `.env` lokal** — ekspor variabel ke sesi shell saja karena variabel shell **menang atas isi `.env`** pada `node --env-file=.env`.

- **DILARANG membuat role `solemate_app` terlebih dahulu di Neon Console.** Pada PostgreSQL 16+ di Neon, role owner bawaan Neon bukan superuser dan tidak memiliki `ADMIN OPTION` atas role yang dibuat lewat Console, sehingga `ALTER ROLE` di [`migrations/0003_app_user.js`](migrations/0003_app_user.js) akan ditolak. Biarkan migrasi `0003` yang membuat role `solemate_app` memakai hak `CREATEROLE` milik owner Neon, lalu migrasi [`migrations/0015_neon_schema_usage.js`](migrations/0015_neon_schema_usage.js) memastikan izin `USAGE` pada schema `public` terpenuhi secara kondisional.
- Jalankan migrasi & verifikasi dari sesi shell laptop:
  ```bash
  export DATABASE_URL="postgresql://<admin_user>:<admin_pass>@ep-xxx.ap-southeast-1.aws.neon.tech/solemate?sslmode=require"
  export APP_DB_PASSWORD="<password_kuat_solemate_app>"
  npm run migrate:up
  npm run migrate:status
  ```

### 4. Membuat Akun `owner` Produksi & Mereset PIN 6 Digit

Skrip `seed.js` **tidak pernah** membuat akun pengguna dan ditolak di `NODE_ENV=production`. Selama variabel `DATABASE_URL` (Direct, tanpa `&channel_binding=require`) masih diekspor di sesi shell yang sama, jalankan skrip interaktif dari laptop:

```bash
# Membuat akun owner atau kasir baru (PIN 6 digit diketik tersembunyi, di-hash dengan Argon2id)
npm run create-user

# Mereset PIN 6 digit akun yang sudah ada, mencabut seluruh sesi aktifnya, sekaligus membuka kunci rate-limit akun
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
4. **Pemeriksaan Origin (`APP_ORIGIN`), Cookie Sesi, `TRUST_PROXY`, & Risiko Lockout Akun:**
   - `periksaPermintaanUbah` (`src/lib/request-guard.ts`) **tidak** mempercayai `x-forwarded-host` dan diterapkan di seluruh endpoint mutasi termasuk `POST /api/login` dan `POST /api/logout` (satu-satunya pengecualian adalah `POST /api/wa/webhook` yang memakai tanda tangan HMAC). Di produksi, setiap permintaan mutasi wajib memiliki `Content-Type: application/json` dan header `Origin` berskema `https://` yang cocok dengan daftar `APP_ORIGIN`.
   - Cookie sesi memakai helper `namaCookieSesi()` (`src/config/keamanan.ts` / `src/lib/session.ts`): bernama `__Host-solemate_session` saat `NODE_ENV === "production"` (`httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure: true`) untuk mencegah *cookie tossing* subdomain, dan `solemate_session` (`secure: false`) saat lokal/tes. Login baru menghapus sesi lama dari cookie yang dibawa serta membersihkan baris `sessions` kedaluwarsa; `scripts/reset-pin.mjs` juga mencabut seluruh sesi aktif pengguna tersebut di database.
   - Saat `TRUST_PROXY=true` (wajib saat `VERCEL=1`), `ambilIp` (`src/lib/ip.ts`) memvalidasi sintaks IP lewat `node:net` `isIP()` (maksimal 45 karakter), membaca `x-vercel-forwarded-for` / `x-real-ip` / `x-forwarded-for` hanya bila `VERCEL=1`, dan tidak mempercayai header vendor pihak ketiga di luar Vercel (`cf-connecting-ip`, `true-client-ip`, dll.). Batas percobaan login menggunakan pra-inkremen atomik *sebelum* verifikasi Argon2 (`5` gagal / 15 menit per akun lewat `LOGIN_WINDOW_PER_AKUN`; `20` gagal / 30 menit per IP lewat `LOGIN_WINDOW_PER_IP`): saat login **berhasil**, penghitung akun di-reset sedangkan penghitung IP dikembalikan tepat satu hitungan (`GREATEST(gagal - 1, 0)`) agar login sah dari kasir tidak menghabiskan kuota IP toko dan pemegang akun sah tidak bisa me-reset kuota gagal IP. Akun tak dikenal tidak menulis baris ke `login_rate_limit` maupun `audit_logs`.
   - **Paritas Respons & Waktu Login (`cobaLogin` + `POST /api/login`):** Untuk mencegah enumerasi akun, HTTP status (`403`) dan pesan `PESAN_GAGAL` disamakan persis untuk PIN salah, akun tak dikenal, akun nonaktif, maupun akun terkunci (`gagalAkun > 5`), dan verifikasi `argon2.verify` tetap dijalankan dengan *hash dummy* berparameter identik (dihitung sekali per proses) baik ketika akun tak dikenal maupun ketika akun terkunci/nonaktif sehingga hash PIN asli akun terkunci tidak diuji dan waktu respons tetap seragam. Pada pengujian lokal tetap tampak selisih sangat kecil (rasio median <= 2x) karena jalur akun terdaftar menulis pengawasan ke tabel pembatas laju akun/audit. **Dampak pra-inkremen pada pengguna sah:** pengguna yang mencoba masuk saat kuota belum habis masih berkesempatan memverifikasi PIN pada percobaan ke-1 s/d ke-5 (dan langsung di-reset/dikembalikan 1 hitungan IP bila benar), namun bila >= 5 permintaan serentak masuk bersamaan untuk akun yang sama, permintaan ke-6 ke atas langsung tertolak oleh pra-inkremen atomik tanpa menghabiskan verifikasi PIN terhadap hash asli.
   - **Risiko Lockout Akun Eksternal (DoS) & Pemulihan:** Karena batas gagal login per akun (`5 gagal / 15 menit`) dihitung berdasarkan nama akun terdaftar, pihak luar yang sengaja mengirim 5 PIN salah dapat mengunci login akun sasaran selama 15 menit sementara. Bila perlu pemulihan sebelum jendela 15 menit berakhir, jalankan **`npm run reset-pin`** dari mesin admin (memerlukan `DATABASE_URL`): skrip ini mengganti hash PIN, menghapus seluruh `sessions` aktif akun tersebut, dan langsung menghapus kunci `login_rate_limit` kategori `akun`.
5. **Penjaga Rute Pengembangan, Hak Minimum DB (`0014`), & Seed:**
   - Di `NODE_ENV=production`, rute `/dev`, `/dev/*`, dan `/detail-tiket` mengembalikan HTTP `404` untuk seluruh pengunjung termasuk anonim (dijaga di `src/proxy.ts` dan di komponen halaman melalui `apakahRuteDevTerblokir`). Di non-produksi, `/dev/komponen` menangkap `AksesDitolakError` dan merender `<AksesDitolak />` untuk peran selain owner.
   - Migrasi `0014_hak_minimum_solemate_app.js` mencabut hak `INSERT`/`UPDATE` pada `users`, `employees`, `attendance` serta semua hak pada tabel usang `login_attempts` (beserta sequence-nya) dari `solemate_app`, sambil mempertahankan `UPDATE` pada `wa_messages` karena dipakai `buatTiketDariWa()`.
   - `scripts/seed.js` menolak berjalan di `NODE_ENV=production` (`exit 1`) melalui fungsi murni `periksaIzinSeed`.
6. **Bundling Font `pdfkit` untuk Ekspor PDF (`/api/rekap-bulanan/ekspor`):**
   - `next.config.ts` sudah mengonfigurasi `outputFileTracingIncludes` untuk rute `/api/rekap-bulanan/ekspor` agar berkas metrik font `.afm` (`./node_modules/pdfkit/js/data/**/*`) ikut dibundle ke fungsi serverless Vercel. Verifikasi akhir dilakukan langsung dengan **mengunduh PDF rekap bulanan dari halaman `/rekap-bulanan` di deployment Vercel**.
7. **Header Keamanan, CSP, Pembatasan Laju API, & Sanitasi Galat:**
   - `next.config.ts headers()` menerapkan `bangunHeaderKeamanan()` (`src/lib/security-headers.ts`) untuk seluruh rute `/:path*` (halaman, API, unduhan): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`, `Content-Security-Policy`, dan `Strict-Transport-Security: max-age=63072000` (dipasang **hanya** saat `NODE_ENV === "production"`, tanpa `includeSubDomains` maupun `preload`).
   - **Keterbatasan CSP saat ini:** Kebijakan `Content-Security-Policy` statis ini mengizinkan `'unsafe-inline'` pada `script-src` dan `style-src` agar skrip hidrasi RSC Next.js dan atribut gaya grafik Rekap tetap berjalan, sehingga **CSP ini tidak memblokir XSS skrip inline**. Pelindungan XSS saat ini mengandalkan escaping React, penulisan DOM via `textContent`, dan validasi ketat input. **CSP ketat berbasis nonce** direncanakan saat pindah ke hosting berbayar.
   - **Pembatasan Laju API (`src/lib/api-rate-limit.ts`):** Setelah validasi CSRF & sesi, endpoint terautentikasi menegakkan batas laju atomik berbasis PostgreSQL (`wa_rate_limit`) dengan kunci HMAC-SHA256 berlabel dari `SESSION_SECRET` (`POST /api/pelanggan/cek`: 30/menit; `GET /api/rekap-bulanan/ekspor`: 15/menit; mutasi terautentikasi lain: 120/menit). Permintaan di atas batas membalas HTTP `429` dengan header `Retry-After` (counter tertahan di `maks + 1` tanpa memperpanjang jendela), dan baris `api_*` kedaluwarsa (> 300 detik) dibersihkan berkala lewat `after()`.
   - **Sanitasi Galat:** Seluruh route handler meneruskan sinyal navigasi Next.js (`redirect()`/`notFound()`) sambil menormalisasi galat tak terduga menjadi HTTP `500` generik lewat `tanganiGalatRoute` tanpa membocorkan stack trace, nama tabel, atau nama constraint database.

### 6. Cara Menguji Mode Produksi (Vercel & Alternatif Lokal yang Aman)

- **Cara utama (disarankan):** Uji mode produksi melalui **deployment produksi di Vercel** (`https://NAMA-PROYEK.vercel.app`) yang terhubung ke Neon (`?sslmode=require`), lalu unduh Excel dan PDF di `/rekap-bulanan` untuk memverifikasi fungsi serverless beserta font `pdfkit`.
- **Apa yang terjadi jika menjalankan `npm run build` lalu `npm run start` langsung dengan `.env` lokal (`APP_ORIGIN` kosong/`http://`, Postgres lokal tanpa SSL):**
  1. `npm run build` selesai karena fase build (`NEXT_PHASE=phase-production-build`) sengaja melewati pemeriksaan runtime.
  2. Saat `npm run start` (`NODE_ENV=production`) dijalankan, `src/instrumentation.ts` gagal memuat hook dengan galat `[ENV_PRODUKSI_TIDAK_VALID]` (`Failed to prepare server ...`), dan seluruh permintaan HTTP (`GET /login`, `POST /api/login`) dijawab **HTTP `500`** — sehingga **login tidak dapat bekerja**.
  3. Bila pun env `APP_ORIGIN` diisi `https://...`, koneksi ke Postgres lokal tanpa SSL tetap gagal saat runtime dengan galat `The server does not support SSL connections` (`HTTP 500`), rute mutasi berpenjaga `Origin` (seperti `POST /api/tiket`, `PATCH /api/tiket/[id]`) tetap menolak permintaan `http://`, dan cookie sesi `__Host-solemate_session` ditandai `Secure`. Kode produksi sengaja tidak menyediakan pengecualian untuk melonggarkan aturan ini.
- **Cara aman menguji mode produksi secara lokal tanpa Vercel (opsional):**
  - Gunakan database Postgres yang memiliki **TLS/SSL valid** (mis. cabang terpisah/staging di Neon atau Postgres lokal ber-TLS dengan sertifikat tepercaya — **jangan** pakai `DB_SSL_REJECT_UNAUTHORIZED=false`), **dan**
  - Jalankan *reverse proxy* HTTPS / tunnel lokal di depan `npm run start` (mis. Caddy TLS lokal + `mkcert` atau Cloudflare Tunnel) dengan `TRUST_PROXY=true` serta `APP_ORIGIN=https://<domain-https-lokal>`.

### 7. Checklist Pra-Hosting (Sebelum Demo / Go-Live)

- [ ] Buat database kosong di Neon (**DILARANG** membuat role `solemate_app` lebih dulu di Neon Console), hapus `&channel_binding=require` bila ada di string koneksi Neon, lalu jalankan migrasi `0001` s/d `0015` dari laptop memakai URL **Direct** lewat `export DATABASE_URL` dan `export APP_DB_PASSWORD` di sesi shell (tanpa mengedit `.env`; variabel shell menimpa `.env`).
- [ ] Pastikan role terbatas `solemate_app` hanya memiliki hak minimum sesuai `0003_app_user.js` s/d `0015_neon_schema_usage.js` (memiliki `USAGE` pada schema `public`, tanpa hak `UPDATE`/`DELETE` pada `audit_logs`, tanpa `INSERT`/`UPDATE` pada `users`/`employees`/`attendance`, dan tanpa akses ke `login_attempts`).
- [ ] Buat akun `owner` dan `kasir` awal dari mesin lokal dengan `npm run create-user` (jangan jalankan `seed.js` di produksi).
- [ ] Sebelum deploy pertama di Vercel, setel **Node.js Version = 22** di Project Settings Vercel, pasang hanya variabel runtime (`DATABASE_URL_APP`, `SESSION_SECRET`, `APP_ORIGIN=https://NAMA-PROYEK.vercel.app`, `WA_GATEWAY_MODE` beserta `WAHA_*` jika `waha`, `TRUST_PROXY=true`, serta opsional `DB_POOL_CONNECTION_TIMEOUT_MS=15000` untuk *cold start* Neon), dan pastikan **TIDAK** ada `DATABASE_URL` admin.
- [ ] Deploy melalui integrasi **GitHub** (cloud build di Vercel, bukan `vercel deploy --prebuilt` dari Mac) dan verifikasi di **deployment produksi Vercel** (`https://NAMA-PROYEK.vercel.app`): login `owner` & `kasir`, buat tiket baru (kode tiket sesuai tanggal WIB), ubah status tiket, pastikan `/dev/komponen` dan `/detail-tiket` mengembalikan `404`, serta uji **unduh Excel & PDF di `/rekap-bulanan`** (sebagai verifikasi final `outputFileTracingIncludes` untuk `pdfkit`).

## Deploy demo (Vercel + Neon)

Bagian ini merangkum panduan langkah demi langkah untuk demo di **Vercel** (Node 22, serverless, runtime `UTC` dengan pemformatan bisnis `Asia/Jakarta` WIB) menggunakan database **Neon** kosong dan role aplikasi terbatas `solemate_app` tanpa integrasi WAHA (`WA_GATEWAY_MODE=nonaktif`). Semua contoh menggunakan placeholder tanpa rahasia maupun URL nyata.

### 1. Langkah Berurutan

1. **Siapkan database kosong di Neon:**
   - Buat project Neon baru (pilih region terdekat, mis. Singapore `ap-southeast-1`) dengan database kosong.
   - Ambil dua connection string untuk database tersebut dan **hapus parameter `&channel_binding=require`** bila ikut tersalin dari dashboard Neon:
     - **Direct (unpooled)** — hostname tanpa `-pooler`, dipakai **hanya di sesi shell laptop** (`DATABASE_URL`) untuk migrasi & skrip CLI.
     - **Pooled (`-pooler`)** — hostname berakhiran `-pooler`, nanti dipakai oleh runtime Vercel (`DATABASE_URL_APP`) menggunakan akun terbatas `solemate_app`.
   - Gunakan `?sslmode=verify-full` (disarankan untuk menghindari peringatan keamanan `pg-connection-string`) atau `?sslmode=require`, dan **jangan** menambahkan `uselibpqcompat=true` maupun `ssl=no-verify`.
   - **DILARANG membuat role `solemate_app` terlebih dahulu di Neon Console;** biarkan migrasi `0003_app_user.js` dan `0015_neon_schema_usage.js` yang membuatnya dan memberi hak schema `public` lewat role owner bawaan Neon (`CREATEROLE`) agar kepemilikan & `ALTER ROLE` tetap konsisten.

2. **Jalankan seluruh migrasi (`0001`–`0015`) dari laptop via sesi shell:**
   - Skrip di `package.json` memakai `node --env-file=.env`: Node.js hanya mengisi variabel dari `.env` bila belum ada di lingkungan proses, sehingga variabel yang diekspor di sesi shell (`export ...`) **menimpa** isi `.env` lokal tanpa perlu menyunting `.env`.
   - Ekspor URL **Direct** (tanpa `&channel_binding=require`) dan password role aplikasi di sesi shell laptop, lalu jalankan migrasi:
     ```bash
     export DATABASE_URL="postgresql://<neon_owner>:<password_owner>@ep-contoh.<region>.aws.neon.tech/<nama_db>?sslmode=verify-full"
     export APP_DB_PASSWORD="<password_acak_solemate_app_min_8_karakter>"
     npm run migrate:up
     ```
   - Verifikasi seluruh berkas migrasi `0001` s/d `0015` sudah bertanda `[X] sudah dijalankan`:
     ```bash
     npm run migrate:status
     ```

3. **Buat akun pengguna awal & siapkan `DATABASE_URL_APP`:**
   - Masih di sesi shell yang sama (atau dengan `DATABASE_URL` Direct yang sudah di-`export` — **jangan** menjalankan `npm run seed` ke database demo/produksi), buat akun `owner` dan `kasir` awal lewat prompt PIN tersembunyi, lalu bersihkan variabel sesi setelah selesai:
     ```bash
     npm run create-user
     unset DATABASE_URL APP_DB_PASSWORD
     ```
   - Susun `DATABASE_URL_APP` untuk Vercel menggunakan role terbatas `solemate_app`, password dari `APP_DB_PASSWORD`, hostname **`-pooler`**, dan tanpa `&channel_binding=require`:
     `postgresql://solemate_app:<password_solemate_app>@ep-contoh-pooler.<region>.aws.neon.tech/<nama_db>?sslmode=verify-full`

4. **Konfigurasi proyek & Environment Variables di Vercel:**
   - Di **Project Settings -> General -> Node.js Version**, pastikan versi disetel ke **`22`** (`22.x`).
   - **Hindari** menghubungkan integrasi otomatis Neon–Vercel Marketplace (atau hapus seluruh `DATABASE_URL` dan `POSTGRES_*` jika integrasi tersebut menyuntikkannya otomatis).
   - Di **Settings -> Environment Variables** (scope **Production**), isi **hanya** variabel wajib demo (ditambah opsional `DB_POOL_CONNECTION_TIMEOUT_MS=15000`) dan pastikan variabel terlarang tidak ada (daftar di bawah).

5. **Deploy melalui integrasi GitHub (Vercel Cloud Build):**
   - Deploy dengan menghubungkan repositori **GitHub** ke Vercel agar build (`next build`) berjalan langsung di **cloud Vercel (Linux)** yang sama dengan runtime Vercel, sehingga modul native `argon2` (`.node`) dan font `pdfkit` (`.afm`) ikut terbawa. **JANGAN** memakai `vercel deploy --prebuilt` dari Mac/Windows.
   - Gunakan URL produksi tetap (`https://<nama-proyek>.vercel.app`) sesuai `APP_ORIGIN`.

6. **Verifikasi pasca-deploy:**
   - Buka `/login`, masuk memakai akun `owner` dan `kasir` yang dibuat di Langkah 3.
   - Buat satu tiket dan ubah status pesanan/bayar (memverifikasi `Origin`, cookie `__Host-solemate_session`, zona waktu WIB, dan query PgBouncer melalui `-pooler`).
   - Pastikan `/dev/komponen` dan `/detail-tiket` membalas `404`.
   - Buka `/rekap-bulanan`, lalu uji unduh **Excel (`.xlsx`)** dan **PDF (`.pdf`)** (`/api/rekap-bulanan/ekspor`).
   - Periksa **Logs** runtime Vercel untuk memastikan tidak ada galat startup maupun peringatan koneksi.

### 2. Daftar Variabel Vercel (Demo Tanpa WAHA)

| Kategori | Nama Variabel | Nilai / Keterangan |
| :--- | :--- | :--- |
| **WAJIB dipasang** | `DATABASE_URL_APP` | URL `-pooler` Neon milik role `solemate_app` dengan `?sslmode=verify-full` (atau `?sslmode=require`), tanpa `&channel_binding=require` |
| **WAJIB dipasang** | `SESSION_SECRET` | String acak kuat ≥ 32 karakter (bukan nilai contoh) |
| **WAJIB dipasang** | `APP_ORIGIN` | Origin `https://` deployment produksi (mis. `https://<nama-proyek>.vercel.app`) |
| **WAJIB dipasang** | `TRUST_PROXY` | `true` (wajib saat `VERCEL=1`) |
| **WAJIB dipasang** | `WA_GATEWAY_MODE` | `nonaktif` (untuk demo tanpa WAHA) |
| **OPSIONAL** | `DB_POOL_CONNECTION_TIMEOUT_MS` | `15000` (disarankan untuk memberi toleransi lebih saat *cold start* compute Neon bangun dari *auto-suspend*; default `10000` ms) |
| **DILARANG dipasang** | `DATABASE_URL` | Kredensial owner/admin; hanya untuk migrasi & CLI di laptop |
| **DILARANG dipasang** | `APP_DB_PASSWORD` | Password mentah pembuatan role `0003`; tidak dipakai saat runtime |
| **DILARANG dipasang** | `POSTGRES_*` | Variabel suntikan integrasi (`POSTGRES_URL`, `POSTGRES_USER`, dll.) umumnya memakai role owner |
| **DILARANG dipasang** | `DB_SSL*` | Jangan menyetel `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` di Vercel; TLS terverifikasi wajib aktif di produksi |
| **DILARANG dipasang** | `WAHA_*` | `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC_KEY`, `WAHA_SESSION`, `WAHA_IZINKAN_HTTP_INTERNAL` jangan dipasang saat `WA_GATEWAY_MODE=nonaktif` |

### 3. Cara Membaca Log Runtime Vercel

1. **Melalui Vercel Dashboard:** Buka proyek -> tab **Logs** (atau buka **Deployments** -> pilih deployment Production aktif -> tab **Logs** / **Functions**), lalu filter **Environment: Production** serta status **500** / **403** atau cari path fungsi (`/api/login`, `/api/tiket`, `/api/rekap-bulanan/ekspor`).
2. **Melalui Vercel CLI:** Setelah `vercel login`, pantau log fungsi secara langsung dari terminal:
   ```bash
   npx vercel logs https://<nama-proyek>.vercel.app --follow
   ```
3. **Menemukan sinyal yang relevan:** Aplikasi menyensor data sensitif di log server (`[ENV_PRODUKSI_TIDAK_VALID]` tidak mencetak nilai rahasia; `[DB_POOL] Galat klien idle: <kode>` hanya mencetak kode error aman SQLSTATE/Node; handler API mencatat `<LABEL> gagal: <kode>`). Fokuskan pengecekan pada kode galat, status HTTP, dan stack startup `instrumentation.ts`.

### 4. Tabel Galat Umum & Artinya

| Galat / Gejala | Kemungkinan Penyebab | Cara Mengatasi |
| :--- | :--- | :--- |
| **`ENV_PRODUKSI_TIDAK_VALID`** (startup `instrumentation.ts` gagal, HTTP `500`) | Ada variabel wajib produksi yang kosong, bernilai placeholder, memakai `http://` pada `APP_ORIGIN`, `TRUST_PROXY` bukan `true`, `WA_GATEWAY_MODE` kosong/`mock`, atau `DATABASE_URL_APP` melemahkan SSL. | Baca pesan setelah `[ENV_PRODUKSI_TIDAK_VALID]` di log Vercel; perbaiki env yang kurang di **Environment Variables** lalu **Redeploy**. |
| **Origin ditolak** (mutasi `POST`/`PATCH`/`DELETE` membalas `403` `Asal permintaan tidak valid.`) | Request dikirim dari URL *preview deployment* yang belum terdaftar di `APP_ORIGIN`, skema bukan `https://`, atau terdapat salah ketik/slash di belakang nilai `APP_ORIGIN`. | Samakan `APP_ORIGIN` persis dengan skema + host + port (tanpa path/garis miring akhir, mis. `https://<nama-proyek>.vercel.app`), lalu redeploy. |
| **Timeout DB** (`ETIMEDOUT`, `Connection terminated due to connection timeout`, HTTP `500`) | Compute Neon baru bangun dari mode tidur (*auto-suspend* cold start > 10 detik), salah region Neon jauh dari region fungsi Vercel, atau `DATABASE_URL_APP` memakai host/port yang terblokir bukan `-pooler`. | Pastikan host `-pooler` benar dan region Neon & Vercel berdekatan; bila cold start sering melewati 10 detik, naikkan `DB_POOL_CONNECTION_TIMEOUT_MS` (mis. `15000`–`20000`). |
| **Modul native** (`argon2`: `No native build was found...` / `ERR_DLOPEN_FAILED`) | Deployment diunggah memakai `vercel deploy --prebuilt` dari macOS/Windows sehingga `.node` bawaan yang ter-trace bukan biner Linux runtime Vercel, atau paket terbawa oleh bundler tanpa externalize. | Build dan deploy langsung di **Vercel cloud build** (Linux) dan pastikan `argon2` diperlakukan sebagai external server package (`serverExternalPackages`). |
| **Font PDF** (`ENOENT: no such file or directory, open '.../Helvetica.afm'` saat ekspor PDF) | Berkas metrik font `.afm` di `node_modules/pdfkit/js/data/` tidak ikut terbawa oleh tracing serverless atau `pdfkit` ikut ter-bundle. | Pastikan `serverExternalPackages` mencakup `"pdfkit"` dan `outputFileTracingIncludes` untuk `/api/rekap-bulanan/ekspor` menyertakan `./node_modules/pdfkit/js/data/**/*` di `next.config.ts`. |

## Catatan

- Password database **hanya** ada di `.env` (diabaikan git) dan dibaca `docker-compose.yml` dari sana. Tidak ada password di file yang di-commit.
- Port PostgreSQL hanya dibuka ke `127.0.0.1`, tidak ke jaringan luar.
