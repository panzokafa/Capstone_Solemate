# STATUS KERJA PHASE 3 — per 2026-11-03 (pembaruan kedua)

Dokumen status. Semua angka di bawah dari perintah yang benar-benar dijalankan hari ini (Node 22.23.4).

## 1. Yang sudah selesai dan terbukti

- **Lint**: 0 error, 0 warning (`npm run lint`).
- **Build**: lolos — "Compiled successfully", TypeScript selesai, 21 rute (`npm run build`).
- **Tes**: `npm test` → db **18/18 lulus**, auth **25/25 lulus** (15 lama + 10 baru).
- **Migrasi 0004 sudah dijalankan di database utama** (`solemate`) setelah backup:
  - Backup: `~/solemate-backups/solemate-20261103-140913.dump` (pg_dump custom, 52K, di luar repo).
  - `npm run migrate:up` → hanya 0004 yang jalan (0001–0003 sudah ada), sukses.
  - `npm run migrate:status` → 0001, 0002, 0003, 0004 semua `[X] sudah dijalankan`.
  - Tabel `login_rate_limit` dibuat oleh migrasi; tidak ada tabel/data lain yang disentuh.
- `.next-test/` masuk `.gitignore` (terbukti lewat `git check-ignore`); `.env` tidak ter-track (`git ls-files .env` kosong). `git status --short -uall` kini 50 file (sebelumnya 408, 359 di antaranya artefak `.next-test/`).

## 2. Tes baru (tests/auth-extra.test.mjs, 10 butir)

1. Sesi akun yang dinonaktifkan tidak berlaku lagi (halaman & API ditolak).
2. Akun nonaktif tidak bisa login; pesan tidak membocorkan status akun.
3. Sesi kedaluwarsa (`kedaluwarsa_pada` di masa lalu) ditolak, diarahkan ke /login.
4. Sesi yang belum kedaluwarsa (8 jam) masih berlaku.
5. Kasir ditolak di HALAMAN owner (bukan hanya API) — "Akses ditolak".
6. `/absensi` bisa dibuka tanpa login.
7. Aturan PIN lemah: 0000, 111111, 1234, 123456, 0123, 9876, 456789, 6789 ditolak; PIN wajar diterima.
8. Skrip `create-user` nyata menolak PIN lemah (exit 1) dan tidak membuat akun.
9. IP tidak diketahui: batas per-IP dilewati, akun lain tidak ikut terkunci, tidak ada kunci IP kosong.
10. X-Forwarded-For diabaikan saat `TRUST_PROXY=false`, dipakai (entri pertama) saat `true`.

Dukungan untuk butir 7–8:
- Aturan PIN lemah dipindah ke `scripts/pin-policy.mjs` (dipakai skrip dan tes).
- `create-user.mjs` kini bisa menerima input lewat pipe (stdin non-TTY) sehingga bisa dites otomatis; di terminal tetap prompt tersembunyi.

## 3. Perbaikan kecil yang dilakukan

- `scripts/create-user.mjs`: baca stdin pipa baris demi baris (sebelumnya `rl.question` berurutan diam-diam gagal dengan stdin pipa — skrip exit 0 tanpa membuat akun).
- `scripts/pin-policy.mjs`: aturan PIN lemah digeneralisasi (semua digit sama, atau deret naik/turun bersambung) — sebelumnya hanya regex daftar tetap.
- README.md: status proyek, cara tes, cara create-user, tabel variabel `.env` Phase 3, tabel hak akses halaman.

## 4. Yang masih tersisa dari docs/PHASE3_SPEC.md

1. **Verifikasi visual halaman login/sidebar (desain Stitch) belum dilakukan.**
2. **DB utama masih berisi sisa data tes lama** (orders, audit_logs, login_attempts 232 baris) — menunggu keputusan user untuk dibuat ulang; jangan dilakukan sendiri.
3. **Server dev lama (PID 22981) belum dimatikan/dijalankan ulang** — masih memakai build lama. Migrasi 0004 sudah jalan, jadi setelah dev server di-restart login di DB utama seharusnya tidak 500 lagi.
4. Pembersihan DB utama juga perlu keputusan user (backup sudah ada di `~/solemate-backups/`).

## 5. Langkah berikutnya

1. Minta user: matikan PID 22981, restart dev server dari build baru, coba login di DB utama.
2. Verifikasi visual halaman login dan sidebar per peran (bandingkan dengan `docs/design/stitch_export/`).
3. Minta keputusan user soal pembuatan ulang DB utama (backup tersedia).
4. Setelah semua selesai: user yang memutuskan commit.
