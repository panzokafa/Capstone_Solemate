// Konfigurasi autentikasi. Angka mudah diubah di sini.

// Batas percobaan login GAGAL per akun.
export const LOGIN_MAX_PER_AKUN = 5;
export const LOGIN_WINDOW_PER_AKUN = 15 * 60; // 15 menit

// Batas percobaan login GAGAL per alamat IP.
export const LOGIN_MAX_PER_IP = 20;
export const LOGIN_WINDOW_PER_IP = 30 * 60; // 30 menit

// Jumlah catatan login gagal yang disimpan ke audit_logs per jendela waktu,
// supaya tidak menumpuk (mis. serangan yang mengunci terus).
export const AUDIT_GAGAL_PER_JENDELA = 20;
export const AUDIT_GAGAL_JENDELA = 60 * 60; // 1 jam
