# PHASE 3 SPEC — Login, Peran, Otorisasi (Solemate)

Dokumen serah-terima. Sesi Claude Code sebelumnya terlalu panjang dan rusak, jadi semua syarat yang sudah disepakati ditulis di sini. Jangan mengandalkan ingatan sesi lama.

## Status terakhir (harus diverifikasi ulang, jangan dipercaya begitu saja)

- Phase 1 dan 2 sudah selesai. Phase 3 BELUM selesai dan BELUM di-commit.
- File Phase 3 sudah ada sebagian: migrations 0002 (sessions), 0003 (app user), 0004 (login_rate_limit), src/config/auth.ts, menu.ts, src/lib, halaman login dan absensi, tests/auth.test.mjs, tests/helpers/akun.mjs.
- Migrasi 0004 baru ditulis. Belum terbukti dijalankan dan dites.
- Tes terakhir yang diketahui gagal. Salah satunya karena data tes menumpuk di database utama (orders dan audit_logs tidak bisa dihapus).

## Syarat (sudah disetujui)

### PIN dan akun
- Hash PIN dengan argon2id (bcrypt jika argon2 gagal dipasang). Owner minimal 6 digit, kasir minimal 4 digit. Keypad menerima 4 sampai 8 digit.
- Tolak PIN mudah di skrip pembuatan akun: 1234, 0000, 123456, angka berulang atau berurutan.
- Skrip buat akun: PIN diminta lewat prompt tersembunyi, tidak lewat argumen, tidak ditulis ke log atau layar.

### Pembatasan login
- Per akun dan per IP, hitungan disimpan di DATABASE (bukan memori), dan update-nya ATOMIK (satu perintah SQL yang menaikkan counter), bukan baca dulu lalu tulis.
- Selama akun terkunci, PIN yang benar pun ditolak. Kunci berakhir sesuai masa kunci.
- Jika IP tidak diketahui: lewati batas per IP (jangan satu keranjang NULL untuk semua pengguna), pakai batas per akun, dan catat peringatan.
- IP dari X-Forwarded-For hanya dipercaya jika diatur lewat konfigurasi (TRUST_PROXY).
- Pesan gagal login seragam untuk semua kasus (tidak membedakan akun nonaktif).

### Sesi
- Sesi di tabel sessions di server. Cookie HttpOnly, SameSite, Secure di production, kedaluwarsa 8 jam (configurable). Rahasia di .env.
- ID sesi baru setiap login. Di setiap request, peran dan status aktif diambil dari tabel users. Tolak jika nonaktif. Sesi dihapus saat akun dinonaktifkan. Logout menghapus sesi.

### Otorisasi
- Pengecekan peran di setiap page, route handler, dan server action lewat satu fungsi pembantu (requireAuth, requireOwner, requireKasir). Jangan hanya mengandalkan middleware atau proxy.
- /absensi bisa diakses tanpa login (pilih nama dan PIN pribadi), tidak memakai requireKasir.
- Daftar Tiket dan Detail Tiket: requireAuth (owner hanya lihat). Buat Tiket: khusus kasir. Halaman owner menolak kasir.

### Database
- User solemate_app dengan hak eksplisit per tabel (bukan GRANT semua lalu REVOKE). Tidak boleh DELETE dan TRUNCATE di orders. Di audit_logs hanya SELECT dan INSERT. Boleh DELETE di sessions.
- Migrasi: 0002 sessions, 0003 user database, 0004 pembatasan login. Password solemate_app dibaca dari .env, tidak ditulis di file SQL.

### Audit
- Login berhasil dan gagal dicatat ke audit_logs tanpa PIN.
- Batas pencatatan login gagal dihitung PER IP dan PER AKUN, bukan global. Percobaan di atas batas dicatat sebagai satu baris ringkasan, bukan dilewatkan (supaya penyerang tidak bisa menghilangkan jejak).

### Halaman
- Login (ikuti desain Stitch di docs/design/stitch_export/solemate_shoes_clean_login), layout dengan sidebar berbeda per peran, placeholder terlindungi untuk halaman lain.
- Jangan membuat fitur tiket, laporan, atau katalog di fase ini.

## Tes

- Tes memakai DATABASE TERPISAH (solemate_test) yang dibuat ulang tiap run lewat migrate:down dan migrate:up. Jangan biarkan data tes di database utama. Username unik per tes.
- Jangan mengubah tes hanya agar lolos jika penyebabnya bug aplikasi. Perbaiki aplikasinya.
- Tes wajib: login berhasil dan gagal; pembatasan percobaan memblokir; akun terkunci menolak PIN benar; kunci berakhir sesuai masa kunci; 10 percobaan serentak tidak melewati batas 5; kasir ditolak di semua rute owner (halaman dan API); tanpa sesi diarahkan ke Login; PIN uji acak tidak muncul di log aplikasi dan audit_logs; user aplikasi ditolak DELETE dan TRUNCATE pada orders serta UPDATE pada audit_logs; sesi akun nonaktif tidak berlaku; ID sesi berubah setelah login ulang; batas pencatatan audit per IP dan akun (bukan global).

## Pembersihan

- Hapus kode mati (withClient, getClient), variabel tidak terpakai, dan konstanta tidak terpakai.

## Aturan kerja

- Baca CLAUDE.md dulu. Satu langkah kecil per giliran. Tampilkan output asli perintah dan tes. Jangan mengklaim berhasil tanpa bukti.
- Jangan commit. Pengguna yang memutuskan commit.
