# CLAUDE.md — Solemate Shoes Clean

Proyek capstone: sistem web untuk laundry sepatu Solemate Shoes Clean (Bojongsoang). Nama bisnis hanya **Solemate**. Pengguna proyek ini masih pemula, jadi jelaskan langkah dengan bahasa sederhana dan jangan menjalankan perintah berisiko tanpa menjelaskannya dulu.

## Dokumen acuan (baca sebelum mengerjakan apa pun)

- `docs/design/stitch_export/` — hasil desain Stitch. Tiap folder adalah satu layar (code.html dan screen.png). `docs/design/DESIGN.md` berisi gaya visual. Gambar dan kode ini hanya acuan tampilan, bukan kode final.
- `docs/MASTER_PROMPT_Solemate_v2.md` — aturan kerja, stack, fase pengerjaan, dan kriteria selesai.
- `docs/PRD_Solemate.md` — daftar halaman, peran, alur, dan spesifikasi tiap halaman.
- `docs/Requirement_Gathering_Capstone_Solemate.pdf` — sumber kebutuhan asli dari pemilik (ID FR-xx dan NFR-xx).

## Urutan prioritas jika ada konflik

1. Requirement gathering (PDF)
2. PRD
3. Master prompt
4. Desain Stitch

Desain dipakai untuk layout, komponen, warna, dan tipografi saja. Fitur, data, dan hak akses mengikuti PRD. Jika desain memuat elemen yang tidak ada di PRD (misalnya QRIS, verifikasi pembayaran, ekspor PDF atau Excel), jangan dibangun dan beri tahu pengguna.

## Ringkasan produk

- Sistem berdiri sendiri, tanpa integrasi Olsera.
- Hanya dua peran: **owner** dan **kasir**. Pelanggan hanya lewat WhatsApp.
- Pesanan online masuk lewat WhatsApp (format baku) dan otomatis jadi tiket. Pesanan di toko dibuat kasir di web.
- Sistem hanya mencatat pembayaran (Belum bayar atau Lunas, cash atau non-cash). Tidak memproses pembayaran.
- Tiket tidak boleh dihapus. Semua perubahan masuk log audit. Pembatalan wajib alasan.
- Laporan hanya bisa dilihat owner, tidak bisa diedit, dan dihitung dari data tiket per pasang.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, PostgreSQL dengan migrasi SQL, WAHA dan n8n untuk WhatsApp, Docker Compose. Logika bot ada di backend Next.js, WAHA dan n8n hanya meneruskan pesan. Pengirim WhatsApp lewat adapter supaya gateway mudah diganti.

## Aturan kerja

- Kerjakan satu fase dari master prompt per sesi, lalu berhenti dan laporkan: file yang dibuat atau diubah, perintah yang dijalankan, hasil tes yang sebenarnya, kendala, dan langkah berikutnya.
- Jangan membuat fitur di luar PRD. Fitur yang masuk daftar "tidak masuk ruang lingkup" tidak boleh dibangun.
- Jangan mengarang data bisnis (harga, nomor owner, pengeluaran, PIN). Pakai placeholder yang bisa diatur dan beri tahu di mana mengisinya.
- Jangan pernah menulis rahasia (password, token, API key) ke repo. Pakai `.env` dan buat `.env.example`. Jangan commit `.env`.
- Hak akses harus dicek di server, bukan hanya disembunyikan di tampilan.
- Jangan menghapus data atau melakukan perubahan database yang merusak. Pakai migrasi bertahap.
- Jangan mengklaim sesuatu berhasil kalau belum benar-benar dijalankan dan dicek.
- Tanyakan dulu sebelum menginstal dependensi besar, mengubah struktur folder, atau menjalankan perintah yang menghapus file.
- Bahasa antarmuka: Indonesia. Mata uang Rupiah (`Rp 25.000`). Zona waktu Asia/Jakarta.

## Urutan fase

1. Inspeksi prototype dan siapkan infrastruktur (Docker, database)
2. Database dan migrasi
3. Login, peran, dan otorisasi di server
4. Katalog layanan
5. Tiket (buat, daftar, filter, ubah status, detail, audit, pembatalan)
6. Click-to-chat dan bot WhatsApp
7. Dashboard dan laporan harian
8. Fitur Should: notifikasi otomatis, cek progress, tren 7 hari, rekap bulanan, karyawan dan absensi
9. Fitur Could jika sempat: cetak resi, laba rugi
10. Tes menyeluruh dan dokumentasi

## Pertanyaan terbuka (pakai default yang bisa diubah)

Daftar status pesanan final, format pesan pemesanan WhatsApp, apakah Olsera dihentikan, jenis pembayaran non-cash, sumber data pengeluaran, kebutuhan akun kurir, cetak resi dari sistem, gateway WhatsApp final.
