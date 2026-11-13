# PRD — Solemate Shoes Clean
## Sistem Pelacakan Pesanan, Notifikasi WhatsApp, dan Laporan Operasional

Versi: 1.0 (draf) · Sumber: hasil wawancara requirement gathering (sesi review prototype) dengan pemilik Solemate Shoes Clean · Status: perlu diverifikasi tim

Catatan: ID kebutuhan (FR-xx, NFR-xx) mengacu langsung ke dokumen Spesifikasi Kebutuhan Sistem Solemate. Prioritas: **Must** (wajib untuk demo dan versi pertama), **Should** (dikerjakan jika waktu cukup), **Could** (opsional, boleh dipangkas).

---

## 1. Ringkasan Produk

Solemate adalah sistem web untuk usaha laundry sepatu Solemate Shoes Clean Bojongsoang. Sistem ini menggantikan kebiasaan lama: admin merekap pesanan WhatsApp satu per satu dan kasir memotret laporan penutupan harian lalu mengirimnya ke pemilik. Dengan Solemate, pesanan dari WhatsApp otomatis menjadi tiket di web, status pesanan bisa diubah kasir dengan sekali klik, pelanggan diberi tahu lewat WhatsApp, dan pemilik cukup membuka web untuk melihat angka harian dan bulanan.

Sistem berdiri sendiri. Tidak ada integrasi atau pencocokan dengan Olsera. Sistem hanya **mencatat** pembayaran, tidak memproses pembayaran online.

## 2. Tujuan

1. Setiap barang yang masuk wajib punya tiket di sistem, supaya celah transaksi di luar sistem menyempit.
2. Pesanan dari WhatsApp masuk ke web tanpa direkap manual.
3. Pelanggan menerima pemberitahuan status (terutama "pesanan selesai") lewat WhatsApp tanpa kasir mengetik manual.
4. Pemilik melihat laporan harian dan rekap bulanan langsung di web, dari mana saja, tanpa menerima foto laporan dari kasir.
5. Pekerjaan kasir menjadi "tinggal klik".

Indikator keberhasilan (kualitatif, untuk demo): tiket dari WhatsApp muncul otomatis di daftar tiket; kasir bisa mengubah status dari daftar tanpa mencari ulang; laporan harian menampilkan angka yang dihitung dari data tiket; kasir tidak lagi mengirim foto laporan.

## 3. Pengguna dan Peran

Hanya ada dua peran yang memakai web. Tidak ada peran admin atau teknisi terpisah.

| Peran | Boleh | Tidak boleh |
|---|---|---|
| **Owner** | Login dengan PIN; melihat dashboard; melihat daftar tiket dan filternya; melihat laporan harian operasional; melihat rekap bulanan; menambah, mengubah, dan menonaktifkan katalog layanan dan harga; mengelola karyawan; melihat rekap absensi | Membuat tiket baru (tugas kasir); mengubah isi laporan |
| **Kasir** | Login; membuat tiket baru; melihat daftar tiket (hari ini, kemarin, beberapa hari lalu); mengubah status pesanan dan status pembayaran; memakai filter Belum bayar; membuka chat atau mengirim notifikasi WhatsApp; absen sendiri dengan PIN pribadi | Mengubah katalog; membuka laporan harian operasional dan rekap; melihat data karyawan dan absensi orang lain |
| **Pelanggan** (eksternal) | Berinteraksi lewat WhatsApp: lihat menu, kirim format pesanan, cek progress | Tidak punya akun web |

Asumsi: Owner hanya melihat tiket (tidak mengubah status), karena pengubahan status dicatat sebagai tugas kasir. Konfirmasi ke pemilik.

## 4. Ruang Lingkup

**Masuk (in scope):**
- Login berbasis peran (owner, kasir) dengan PIN.
- Tiket pesanan (satu tiket bisa berisi banyak barang), daftar tiket, filter tanggal, filter Belum bayar, ubah status dari daftar.
- Log audit; tiket tidak bisa dihapus, hanya dibatalkan dengan alasan.
- Bot WhatsApp: menu, format pemesanan, cek progress, pembuatan tiket otomatis.
- Tombol click-to-chat WhatsApp di tiket, dan notifikasi otomatis saat pesanan selesai (jika memungkinkan).
- Dashboard ringkasan operasional.
- Laporan harian operasional dan rekap bulanan (khusus owner, tidak bisa diedit).
- Katalog layanan dan harga (khusus owner).
- Karyawan dan absensi dengan PIN pribadi.
- Pencatatan status dan metode pembayaran (cash atau non-cash).

**Tidak masuk (out of scope):**
- Integrasi atau pencocokan dengan Olsera.
- Pembayaran online (QRIS, transfer, payment gateway) dan verifikasi pembayaran.
- Pengaturan QRIS, rekening bank, atau gambar pricelist (pricelist bot diambil dari katalog).
- Ekspor CSV maupun ekspor/cetak untuk Laporan Harian Operasional (ekspor Excel & PDF ditambahkan khusus untuk Rekap Bulanan melalui FR-53).
- Peran admin, teknisi, kurir, atau pencuci dengan akun sendiri.
- Kas awal dan kas akhir shift.
- Penghapusan tiket.

## 5. Alur Utama

### 5.1 Pesanan online lewat WhatsApp
1. Pelanggan menghubungi WhatsApp Solemate. Bot menampilkan menu: **Info layanan dan pricelist**, **Format pemesanan**, **Cek progress**.
2. Pelanggan mengisi format baku lalu mengirimkannya. Sistem membaca pesan dan otomatis membuat tiket di web dengan status pembayaran awal **Belum bayar**. Pesan yang tidak sesuai format dibalas bot dengan petunjuk perbaikan.
3. Barang dijemput atau diantar sekitar satu atau dua kali sehari (kira-kira pukul 11.00 dan 16.00 sampai 17.00), diverifikasi kasir.
4. Saat sepatu selesai, kasir menandai di web. Pelanggan menerima notifikasi WhatsApp otomatis, atau minimal kasir mengklik tombol yang membuka chat WhatsApp dengan pesan yang sudah terisi.

### 5.2 Pesanan di toko (walk-in)
1. Pelanggan datang. Kasir langsung membuat tiket baru di web: pilih layanan dari katalog, estimasi selesai terisi otomatis dari durasi layanan (perlu konfirmasi).
2. Kasir mencetak resi, lalu meminta nomor WhatsApp pelanggan untuk mengirim resi online dan info status selesai.
3. Selanjutnya komunikasi lewat WhatsApp seperti pesanan online.

### 5.3 Penutupan harian dan laporan
Pemilik membuka web dan langsung melihat angka hari itu: jumlah sepatu, jumlah sudah bayar, jumlah dan nilai belum bayar, total nominal, rincian cash dan non-cash. Uang cash dibiarkan di toko dan diambil per bulan. Tiap akhir bulan pemilik membuka rekap untuk rentang tanggal tertentu.

## 6. Peta Halaman

| No | Halaman | Owner | Kasir | Prioritas |
|---|---|---|---|---|
| 1 | Login | ✓ | ✓ | Must |
| 2 | Dashboard | ✓ | ✓ | Must |
| 3 | Daftar Tiket Pesanan | ✓ (lihat saja) | ✓ | Must |
| 4 | Buat Tiket Baru | – | ✓ | Must |
| 5 | Detail Tiket (panel samping) | ✓ (lihat saja) | ✓ | Must |
| 6 | Resi Tiket (tampilan cetak) | – | ✓ | Could |
| 7 | Laporan Harian Operasional | ✓ | – | Must |
| 8 | Rekap Bulanan | ✓ | – | Should |
| 9 | Katalog Layanan dan Harga | ✓ | – | Must |
| 10 | Karyawan | ✓ | – | Should |
| 11 | Absensi (clock-in dan clock-out) | – | ✓ | Should |
| 12 | Rekap Absensi | ✓ | – | Should |

Navigasi samping (sidebar), berbeda per peran:
- **Owner:** Dashboard, Daftar Tiket, Laporan Harian, Rekap Bulanan, Katalog, Karyawan, Rekap Absensi, Keluar.
- **Kasir:** Dashboard, Daftar Tiket, Buat Tiket, Absensi, Keluar.

Pembatasan menu dan data dijalankan di server, bukan hanya disembunyikan di tampilan. Kasir yang membuka URL halaman owner mendapat halaman "Akses ditolak".

---

## 7. Spesifikasi per Halaman

Setiap bagian di bawah bisa ditempel satu per satu ke Stitch, bersama panduan desain umum di bagian 11. Semua teks antarmuka berbahasa Indonesia.

### 7.1 Login
**Tujuan:** masuk ke sistem sesuai peran (FR-01).
**Akses:** semua, sebelum login.
**Komponen:**
- Logo dan nama "Solemate Shoes Clean", teks pendek "Masuk untuk mengelola pesanan".
- Pemilihan pengguna: kartu atau dropdown berisi nama pengguna dengan label peran (Owner atau Kasir).
- Input PIN (kolom angka bertitik, dengan tombol tampilkan atau sembunyikan) atau keypad angka besar agar mudah dipakai di tablet kasir.
- Tombol utama "Masuk".
- Tautan kecil "Absen karyawan" yang mengarah ke halaman Absensi.
**State:** PIN salah (pesan "PIN tidak sesuai, coba lagi"), akun nonaktif, terlalu banyak percobaan (tunda sementara), loading pada tombol.
**Catatan:** halaman sederhana, satu kolom di tengah layar, nyaman di ponsel dan tablet.

### 7.2 Dashboard
**Tujuan:** ringkasan operasional hari ini (FR-30, FR-31, FR-32).
**Akses:** owner dan kasir (tren 7 hari hanya owner).
**Komponen:**
- Header: sapaan dan tanggal hari ini, nama pengguna dan peran.
- Kartu ringkasan hari ini (Should): jumlah pesanan hari ini, jumlah belum bayar. Kasir dan owner melihatnya.
- Daftar **5 tiket terbaru** (Must): kolom kode tiket, nama pelanggan, jumlah barang, status pesanan (badge berwarna), status pembayaran (badge), waktu masuk. Selalu 5 baris walau pesanan hari itu lebih banyak. Di bawahnya tautan "Lihat semua tiket" ke Daftar Tiket.
- Grafik garis atau batang **tren pesanan 7 hari terakhir** (Should, khusus owner). Diberi label jelas sebagai tren, bukan laporan harian.
- Tombol cepat untuk kasir: "Buat tiket baru".
**State:** belum ada tiket hari ini (ilustrasi kosong dan ajakan membuat tiket), loading skeleton.

### 7.3 Daftar Tiket Pesanan
**Tujuan:** melihat dan mengelola semua tiket dari semua status (FR-12 sampai FR-17, FR-23).
**Akses:** kasir (penuh), owner (lihat saja).
**Komponen:**
- Judul "Daftar Tiket Pesanan" dan tombol "Buat tiket baru" (hanya kasir).
- Bar filter tanggal: segmen **Hari ini**, **Kemarin**, **Beberapa hari lalu**, dan **Rentang tanggal** (date picker dua tanggal).
- Tombol filter **Belum bayar**. Saat aktif, tiket belum bayar tampil paling atas sebagai pengingat kasir menghubungi pelanggan, terutama sepatu yang sudah selesai tapi belum dibayar atau diambil.
- Kolom pencarian (kode tiket, nama, nomor WhatsApp).
- Tabel tiket (kartu pada layar ponsel) dengan kolom: kode tiket, pelanggan (nama dan nomor), sumber (WA atau Toko), jumlah barang, tanggal masuk, estimasi selesai, **status pesanan** (dropdown inline), **status pembayaran** (dropdown inline), total, aksi.
- Status pesanan memuat: Belum dicuci, Diproses, Siap diambil, Sudah diambil (daftar final perlu konfirmasi, lihat bagian 13). Status pembayaran: Belum bayar, Lunas. Kasir mengubah keduanya langsung dari baris tabel, tanpa membuka halaman lain (keluhan pemilik pada Olsera).
- Tombol aksi per baris: ikon **WhatsApp** (click-to-chat; membuka chat dengan pesan awal terisi sesuai status, misalnya "pesanan selesai") dan "Detail".
- Penanda visual untuk tiket yang sudah lama belum diambil (misalnya lencana "2 hari belum diambil") (Should).
- Paginasi.
**State:** hasil filter kosong, loading, gagal memuat. Tidak ada tombol hapus tiket.
**Catatan:** untuk owner, dropdown status tampil sebagai badge biasa (tidak bisa diubah).

### 7.4 Buat Tiket Baru
**Tujuan:** kasir membuat tiket untuk pelanggan di toko (FR-10, FR-11, FR-25, FR-81).
**Akses:** kasir saja.
**Komponen (formulir satu halaman, dua kolom di desktop):**
- Bagian **Data pelanggan:** nama, nomor WhatsApp (wajib agar resi online dan notifikasi bisa dikirim; jika nomor sudah pernah ada, data pelanggan terisi otomatis).
- Bagian **Barang dan layanan:** daftar item yang bisa ditambah dan dikurangi. Tiap item: deskripsi barang (misal merek dan warna sepatu), pilihan layanan dari katalog (dropdown, hanya layanan aktif), jumlah, harga otomatis dari katalog. Tombol "+ Tambah barang".
- Bagian **Jadwal:** tanggal masuk (default hari ini), estimasi selesai (terisi otomatis dari durasi layanan, bisa diubah).
- Bagian **Status:** status pesanan awal, status pembayaran (Belum bayar atau Lunas), metode pembayaran (Cash atau Non-cash; muncul bila Lunas).
- Panel ringkasan di samping atau bawah: daftar item, jumlah pasang, total harga.
- Tombol "Simpan tiket" dan "Simpan dan cetak resi" (Could), "Batal".
**State:** validasi nomor WhatsApp dan layanan wajib, pesan sukses dengan kode tiket yang baru dibuat.
**Catatan:** harga disalin dari katalog dan disimpan per tiket sehingga perubahan harga di katalog tidak mengubah tiket lama (FR-61).

### 7.5 Detail Tiket (panel samping atau halaman)
**Tujuan:** melihat isi tiket lengkap dan riwayat perubahan (FR-16, NFR-01, NFR-02).
**Akses:** kasir dan owner (owner hanya lihat).
**Komponen:**
- Header: kode tiket, badge status pesanan dan pembayaran, sumber (WA atau Toko).
- Info pelanggan dengan tombol WhatsApp.
- Tabel barang: deskripsi, layanan, jumlah, harga saat transaksi, subtotal; total di bawah.
- Info jadwal (tanggal masuk, estimasi selesai) dan pembayaran (status, metode, tanggal bayar).
- **Riwayat perubahan (log audit):** daftar kronologis "siapa, mengubah apa, dari nilai lama ke nilai baru, kapan". Hanya bisa dibaca.
- Tombol "Batalkan tiket" (kasir) yang meminta **alasan pembatalan** di dialog konfirmasi. Tiket tidak dihapus, hanya berstatus Dibatalkan.
- Tombol "Cetak resi" (Could).

### 7.6 Resi Tiket (tampilan cetak) — Could
**Tujuan:** resi untuk pelanggan di toko (FR-83).
**Komponen:** tampilan sempit ala struk: nama dan alamat toko, kode tiket, tanggal masuk dan estimasi selesai, nama pelanggan, daftar barang dan layanan beserta harga, total, status pembayaran, catatan "Cucian tanpa struk gratis" sesuai aturan stiker, tombol "Cetak".

### 7.7 Laporan Harian Operasional
**Tujuan:** pengganti foto laporan penutupan dari kasir (FR-40 sampai FR-44).
**Akses:** owner saja. Laporan tidak bisa diedit sama sekali; angka dihitung dari data tiket.
**Komponen:**
- Pemilih periode: **Hari ini**, **Kemarin**, **Rentang tanggal**.
- Kartu angka ringkas (tanpa daftar nama per tiket):
  1. Jumlah sepatu atau barang masuk (dihitung per pasang, bukan per orang atau per tiket).
  2. Jumlah yang sudah bayar.
  3. Jumlah belum bayar dan nilainya (utang).
  4. Total nominal.
- Rincian pembayaran (Should): total dibayar cash dan total non-cash.
- Label kecil "Dihitung otomatis dari data tiket" dan tanda hanya-baca.
**State:** periode tanpa transaksi (semua angka 0 dengan teks penjelasan), loading.
**Catatan:** tampilan harus nyaman di ponsel karena pemilik membukanya dari jarak jauh (NFR-07).

### 7.8 Rekap Bulanan — Should
**Tujuan:** rekap keuangan akhir bulan untuk rentang tanggal bebas (FR-50 sampai FR-53).
**Akses:** owner saja.
**Komponen:**
- Pemilih rentang tanggal (misal 1 sampai 31 Oktober) dengan pintasan "Bulan ini" dan "Bulan lalu".
- Kartu total: jumlah barang, total nominal, jumlah dan nilai belum bayar.
- **Layanan atau produk terlaris:** daftar atau diagram batang horizontal diurutkan dari terbanyak.
- **Total per metode pembayaran:** cash dan non-cash (diagram donat atau dua kartu).
- Kartu **Laba rugi** (Could): ditandai "Belum tersedia" sampai sumber data pengeluaran diputuskan (lihat bagian 13).
- Tombol **Unduh Excel** dan **Unduh PDF** (FR-53, Could — *tambahan tim*): mengekspor rentang tanggal yang sedang ditampilkan ke Excel (`.xlsx`, sheet Ringkasan & Layanan Terlaris) atau PDF (A4 portrait), khusus owner dan tercatat pada audit log `EKSPOR_REKAP`.
**State:** rentang kosong, loading.

### 7.9 Katalog Layanan dan Harga
**Tujuan:** sumber tunggal pricelist untuk web dan bot (FR-60, FR-61).
**Akses:** owner saja (kasir hanya memilih layanan saat membuat tiket).
**Komponen:**
- Tabel layanan: nama layanan, harga (Rp), estimasi durasi (hari), status (Aktif atau Nonaktif), aksi (Ubah, Nonaktifkan atau Aktifkan).
- Tombol "Tambah layanan".
- Dialog atau panel formulir: nama, harga, estimasi durasi, status aktif.
- Catatan kecil: "Perubahan harga tidak mengubah tiket yang sudah dibuat."
**State:** katalog kosong, konfirmasi saat menonaktifkan. Layanan tidak dihapus permanen.

### 7.10 Karyawan — Should
**Tujuan:** owner mengelola daftar karyawan (FR-70).
**Akses:** owner saja.
**Komponen:** tabel karyawan (nama, status aktif, tombol Ubah), tombol "Tambah karyawan", formulir nama dan **atur PIN pribadi** (PIN tidak pernah ditampilkan, hanya bisa diatur ulang), tombol nonaktifkan.

### 7.11 Absensi (clock-in dan clock-out) — Should
**Tujuan:** karyawan absen sendiri tanpa bisa dicurangi (FR-71).
**Akses:** kasir dan karyawan (juga bisa dibuka dari halaman login).
**Komponen:**
- Jam dan tanggal besar di bagian atas.
- Pilihan nama karyawan (dropdown atau grid kartu nama).
- Input PIN pribadi (keypad angka).
- Dua tombol besar: **Clock-in (datang)** dan **Clock-out (pulang)**.
- Daftar singkat absensi hari ini (nama, jam datang, jam pulang).
**State:** PIN salah, sudah clock-in (tombol clock-in nonaktif), belum clock-in saat clock-out, sukses (konfirmasi hijau dengan jam tercatat).

### 7.12 Rekap Absensi — Should
**Tujuan:** owner melihat absensi karyawan (FR-72).
**Akses:** owner saja.
**Komponen:** filter rentang tanggal dan karyawan, tabel (tanggal, nama, jam datang, jam pulang, total jam), baris kosong bila tidak hadir. Hanya baca.

---

## 8. Bot WhatsApp (bukan halaman web)

Bot berjalan di WhatsApp Solemate dan memakai data yang sama dengan web.

**Menu utama** (saat pelanggan menghubungi):
1. Info layanan dan pricelist: daftar layanan, harga, dan estimasi durasi yang diambil langsung dari katalog (FR-20).
2. Format pemesanan: bot mengirim format baku untuk diisi.
3. Cek progress: bot membalas status tiket dari data (misalnya sedang dicuci, siap diambil) (FR-22, Should).

Selalu sediakan jawaban teks sebagai cadangan, misalnya pelanggan mengetik `1`, `2`, `3`, atau `MENU`, agar bot tidak bergantung pada tombol interaktif.

**Format pemesanan (usulan, perlu konfirmasi pemilik):** nama, nomor WhatsApp, layanan, jumlah pasang, deskripsi barang, serta pilihan jemput atau antar sendiri.

**Pembuatan tiket otomatis (FR-21):** pesan sesuai format dibaca sistem dan menjadi tiket dengan status pembayaran Belum bayar. Pesan yang tidak sesuai dibalas dengan petunjuk perbaikan.

**Notifikasi ke pelanggan:** resi saat tiket dibuat (Should), dan pemberitahuan "pesanan selesai" saat kasir menandai selesai (FR-24, Should). Cadangan: tombol click-to-chat di web (FR-23, Must).

**Gateway:** gateway tidak resmi atau gratis dipakai untuk demo (risiko nomor diblokir). Sistem dirancang agar gateway mudah diganti ke yang resmi (NFR-05).

---

## 9. Ringkasan Kebutuhan Fungsional

| Modul | ID | Prioritas |
|---|---|---|
| Autentikasi dan hak akses | FR-01 login wajib dan PIN owner; FR-02 pembatasan di server; FR-03 kasir tidak bisa membuka halaman owner | Must |
| Tiket pesanan | FR-10 buat tiket; FR-11 banyak barang per tiket, hitung per pasang; FR-12 daftar semua status; FR-13 filter tanggal; FR-14 filter Belum bayar; FR-15 ubah status dari daftar; FR-16 tiket tidak bisa dihapus dan ada log audit | Must |
| Tiket pesanan | FR-17 tiket lama belum diambil mudah terlihat | Should |
| WhatsApp | FR-20 menu bot dan pricelist dari katalog; FR-21 pesan format menjadi tiket; FR-23 click-to-chat | Must |
| WhatsApp | FR-22 cek progress; FR-24 notifikasi otomatis saat selesai; FR-25 nomor WhatsApp wajib untuk walk-in | Should |
| Dashboard | FR-30 lima tiket terbaru | Must |
| Dashboard | FR-31 tren 7 hari; FR-32 ringkasan angka hari ini | Should |
| Laporan harian | FR-40 hanya owner dan tidak bisa diedit; FR-41 pilihan periode; FR-42 isi ringkas; FR-44 pengganti foto laporan | Must |
| Laporan harian | FR-43 rincian cash dan non-cash | Should |
| Rekap bulanan | FR-50 rentang tanggal bebas; FR-51 terlaris dan per metode pembayaran | Should |
| Rekap bulanan | FR-52 laba rugi | Could |
| Rekap bulanan | FR-53 ekspor rekap bulanan ke Excel (.xlsx) dan PDF *(tambahan tim)* | Could |
| Katalog | FR-60 kelola layanan; FR-61 harga disimpan per tiket | Must |
| Karyawan dan absensi | FR-70 kelola karyawan; FR-71 clock-in dan clock-out dengan PIN; FR-72 rekap absensi | Should |
| Pembayaran | FR-80 status Belum bayar dan Lunas; FR-82 hanya mencatat pembayaran | Must |
| Pembayaran | FR-81 metode cash atau non-cash | Should |
| Pembayaran | FR-83 cetak resi | Could |

## 10. Model Data (usulan tim, sesuaikan dengan prototype)

| Entitas | Atribut utama | Catatan |
|---|---|---|
| users | id, nama, peran (owner atau kasir), pin_hash, aktif | Akun login web |
| employees | id, nama, pin_hash, aktif, user_id (opsional) | Untuk absensi; bisa digabung dengan users (perlu keputusan) |
| customers | id, nama, nomor_wa | Nomor WhatsApp unik |
| orders | id, kode_tiket, customer_id, sumber (wa atau toko), dibuat_oleh, tanggal_masuk, estimasi_selesai, status_pesanan, status_bayar, metode_bayar, tanggal_bayar, total, alasan_batal | Tanpa hapus fisik |
| order_items | id, order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi | Harga disalin dari katalog saat tiket dibuat |
| services | id, nama, harga, estimasi_hari, aktif | Sumber pricelist web dan bot |
| attendance | id, employee_id, tanggal, clock_in, clock_out | Dicatat dengan PIN pribadi |
| audit_logs | id, entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id, waktu | Hanya bisa ditambah, tidak bisa diubah atau dihapus |
| wa_messages (opsional) | id, customer_id, arah, isi, waktu | Melacak pesanan yang masuk lewat bot |

Aturan data: laporan dihitung dari orders dan order_items, tidak disimpan sebagai data yang bisa diedit; jumlah sepatu dihitung dari order_items; status pesanan dan status bayar adalah dua kolom terpisah.

## 11. Kebutuhan Non-Fungsional dan Panduan Desain

**Non-fungsional:**
- Keamanan: PIN disimpan sebagai hash; hak akses diperiksa di server; tiket tidak bisa dihapus (NFR-01).
- Audit: perubahan penting tercatat dan log tidak bisa diedit lewat antarmuka (NFR-02).
- Kemudahan pakai: kasir cukup mengklik dengan sedikit langkah (NFR-03).
- Biaya rendah: hosting dan gateway berbiaya minimal (NFR-04).
- Risiko WhatsApp: gateway mudah diganti (NFR-05).
- Data pribadi pelanggan dikumpulkan seperlunya dan dibatasi sesuai peran (NFR-06).
- Ketersediaan selama jam operasional; laporan bisa dibuka dari jarak jauh (NFR-07).

**Panduan desain umum untuk Stitch (tempel di awal setiap prompt):**
- Aplikasi dashboard web responsif untuk desktop, tablet kasir, dan ponsel pemilik. Bahasa antarmuka Indonesia.
- Gaya bersih, modern, mudah dipindai. Latar terang, aksen satu warna utama yang segar dan sesuai tema laundry sepatu (misalnya biru atau teal; sesuaikan dengan identitas Solemate dan prototype yang sudah ada).
- Sidebar di kiri pada desktop, berubah menjadi menu bawah atau hamburger pada ponsel.
- Badge status berwarna konsisten: Belum dicuci (abu), Diproses (biru), Siap diambil (kuning atau oranye), Sudah diambil (hijau), Dibatalkan (merah); Belum bayar (merah muda atau oranye), Lunas (hijau).
- Tombol besar dan jelas untuk kasir, jarak sentuh nyaman, jumlah klik minimal.
- Format uang Rupiah (Rp 25.000), tanggal gaya Indonesia, zona waktu Asia/Jakarta.
- Setiap halaman perlu state kosong, loading, dan error.

**Cara memakai di Stitch:** buat satu prompt per halaman. Isi prompt = panduan desain umum + bagian spesifikasi halaman dari bagian 7. Mulai dari Login, Dashboard, Daftar Tiket, lalu Buat Tiket, supaya gaya visual konsisten sebelum halaman lain dibuat.

## 12. Prioritas Pengerjaan

1. **Must:** login dan peran, tiket (buat, daftar, filter, ubah status), log audit, bot menu dan pembuatan tiket otomatis, click-to-chat, dashboard lima tiket terbaru, laporan harian, katalog.
2. **Should:** notifikasi otomatis saat selesai, cek progress, tren 7 hari, rekap bulanan, rincian cash dan non-cash, karyawan dan absensi, tiket lama belum diambil.
3. **Could:** laba rugi, cetak resi dari sistem, ekspor rekap bulanan ke Excel dan PDF (FR-53, tambahan tim).

Jika fitur terlalu sulit, pemilik setuju fitur tersebut dipangkas atau ditunda.

## 13. Pertanyaan Terbuka (dari requirement gathering)

1. Daftar lengkap status pesanan (transkrip terpotong). Sementara memakai daftar dari prototype.
2. Apakah Olsera benar-benar dihentikan? Pemilik masih ragu untuk bagian pembayaran.
3. Sumber data pengeluaran untuk laba rugi: input manual atau ditunda.
4. Jenis metode non-cash yang perlu dicatat.
5. Apakah petugas antar-jemput dan pencuci perlu akun (saat ini hanya owner dan kasir).
6. Apakah cetak resi harus dari sistem, dan perlu kas awal atau kas akhir shift.
7. Gateway WhatsApp yang dipakai (resmi berbayar atau tidak resmi). Demo dulu.
8. Detail ide status atau tombol "pesanan selesai" di alur WhatsApp.
9. Apakah estimasi selesai terisi otomatis dari durasi layanan.
10. Kolom laporan yang dimaksud ringkas (pemilik tidak perlu nama per tiket).
11. Asumsi tim: owner hanya melihat tiket (tidak mengubah status); karyawan absen disimpan di tabel terpisah dari users.
