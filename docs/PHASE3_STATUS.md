# STATUS KERJA PHASE 3 — per 2026-11-03 (pembaruan ketiga: aturan PIN)

Dokumen status. Semua angka di bawah dari perintah yang benar-benar dijalankan hari ini (Node 22.23.4).

## 0. Perubahan kebutuhan PIN (2026-11-03, keputusan PEMILIK TOKO)

**Ini perubahan kebutuhan dari pemilik, bukan pelonggaran tes.** Detail:

- **Aturan lama dihapus**: owner minimal 6 digit / kasir minimal 4 digit, rentang keypad 4–8 digit, dan penolakan PIN lemah (1234, 0000, angka berulang, berurutan). Tes yang menguji aturan lama **diubah mengikuti aturan baru**, bukan dihapus agar lolos.
- **Aturan baru**: semua PIN (owner, kasir, absensi karyawan) **persis 6 digit angka**. `000000`, `123456`, angka berulang/berurutan sekarang **diterima**. Tetap ditolak: bukan 6 digit (5/7 digit), berisi huruf.
- **Keypad login**: 6 titik (bukan 8), tidak mengirim otomatis. **Penyebab form terkirim di 4 digit**: `login-form.tsx` memanggil `kirim()` otomatis di dalam `tekan()` saat `next.length >= 4`. Baris itu dihapus — sekarang hanya tombol Masuk atau Enter (dan hanya saat 6 digit) yang mengirim.
- **Diperketat di sisi server**: `POST /api/login` menolak PIN bukan 6 digit dengan 400 sebelum menyentuh rate-limit — sebelumnya PIN 4/8 digit lolos ke verifikasi argon2.
- **Tidak dilonggarkan yang lain**: hash argon2id, pembatasan per akun & IP (atomik, di database), penguncian, audit tanpa PIN, pesan gagal seragam, sesi, dan semua pengecekan peran tetap.
- **Skrip baru `npm run reset-pin`** (`scripts/reset-pin.mjs`): ganti PIN akun yang sudah ada + buka kuncinya, PIN lewat prompt tersembunyi (tidak lewat argumen, tidak ditulis ke log). Untuk memindahkan akun lama ke PIN 6 digit.
- Generator PIN di tes diperbaiki: `prefix + Math.floor(Math.random()*900000)` bisa menghasilkan 2–7 digit — sekarang selalu `Math.floor(Math.random()*900000)+100000` (tepat 6 digit).

## 1. Yang sudah selesai dan terbukti

- **Lint**: 0 error, 0 warning (`npm run lint`).
- **Build**: lolos — "Compiled successfully", TypeScript selesai, 21 rute (`npm run build`).
- **Tes**: `npm test` → db **18/18 lulus**, auth **29/29 lulus** (lihat butir 2–3).
- **Database utama dibuat ulang dari nol** (2026-11-03, sesi sebelumnya):
  - Backup terverifikasi dulu: `~/solemate-backups/solemate-20261103-140913.dump` (52K, 137 TOC entries, 12 blok TABLE DATA).
  - `docker compose down -v` → hanya volume `capstone_solemate_solemate_pgdata` yang dihapus; `up -d` → healthy.
  - `npm run migrate:up` → 0001–0004 semua jalan; `migrate:status` → 4× `[X] sudah dijalankan`; `\dt` → 13 tabel termasuk `login_rate_limit`.
- `.next-test/` masuk `.gitignore` (terbukti `git check-ignore`); `.env` tidak ter-track (`git ls-files .env` kosong).

## 2. Tes auth (tests/auth.test.mjs 15 butir + tests/auth-extra.test.mjs 14 butir = 29)

Butir lama yang tetap: login sukses/gagal, audit tanpa PIN, kunci akun, jendela kunci, 10 percobaan serentak ≤ 5, rute owner (halaman + API), logout, hak `solemate_app`, tanpa sesi → Login, PIN tidak bocor ke log, audit per IP/akun.

Butir baru (auth-extra):
1. Sesi akun nonaktif tidak berlaku (halaman & API).
2. Akun nonaktif tidak bisa login; pesan tidak bocor status.
3. Sesi kedaluwarsa ditolak; sesi belum kedaluwarsa (8 jam) diterima.
4. Kasir ditolak di HALAMAN owner (bukan hanya API).
5. `/absensi` terbuka tanpa login.
6. **Aturan PIN baru**: `000000` diterima; 5/7 digit dan huruf ditolak (fungsi `cekPINValid`).
7. **API tolak PIN bukan 6 digit** (400 + pesan "6 digit").
8. **create-user tolak PIN 5 digit, 7 digit, huruf** (exit 1, tidak membuat akun).
9. **create-user terima `000000`** (PIN lemah diterima, akun terbuat).
10. **Form login tidak mengirim sebelum 6 digit** (periksa sumber: `tekan()` tidak panggil `kirim()`, tombol disabled `!== 6`, Enter `=== 6`, 6 titik).
11. **reset-pin**: ganti PIN + buka kunci (PIN baru login 200, PIN lama 403, baris rate-limit terhapus, PIN tidak bocor ke keluaran).
12. IP tidak diketahui: batas per-IP dilewati, tidak ada kunci kosong.
13. XFF diabaikan saat `TRUST_PROXY=false`, dipakai saat `true`.
14. Tes lain: akun nonaktif, sesi, halaman, absensi, dsb. (lihat nama tiap `ok` di output `npm test`).

## 3. File yang diubah untuk aturan PIN

| File | Perubahan |
|---|---|
| `scripts/pin-policy.mjs` | `cekPINLemah` → `cekPINValid` (hanya `/^\d{6}$/`) |
| `scripts/create-user.mjs` | Hapus minPin per peran + cek lemah; PIN tepat 6 digit |
| `scripts/reset-pin.mjs` | **Baru** — ganti PIN + buka kunci (npm `reset-pin`) |
| `src/app/login/login-form.tsx` | 6 titik; hapus kirim otomatis di `tekan()`; disabled `!== 6`; Enter `=== 6` |
| `src/app/api/login/route.ts` | Tolak PIN bukan 6 digit → 400 (trust boundary di server) |
| `tests/auth.test.mjs`, `tests/auth-extra.test.mjs` | Tes aturan baru; generator PIN selalu 6 digit |
| `docs/PHASE3_SPEC.md`, `README.md`, `docs/PHASE3_STATUS.md` | Dokumentasi aturan baru |

## 4. Yang masih tersisa dari docs/PHASE3_SPEC.md

1. **Verifikasi visual halaman login/sidebar (desain Stitch) belum dilakukan.**
2. **Akun belum ada di database utama** (users kosong setelah DB dibuat ulang) — jalankan `npm run create-user` sekali untuk akun owner, atau `npm run reset-pin` kalau sudah ada.
3. **Server dev lama (PID 22981) belum dimatikan/dijalankan ulang** dari build baru.
4. Belum ada tes browser (Playwright dsb.) untuk keypad — tes form memeriksa sumber kode, bukan klik sungguhan.

## 5. Langkah berikutnya

1. Minta user: matikan PID 22981, restart dev server dari build baru.
2. Buat akun owner di DB utama: `npm run create-user` (PIN 6 digit).
3. Verifikasi visual halaman login dan sidebar per peran.
4. User memutuskan commit.
