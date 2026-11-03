// Aturan PIN: tepat 6 digit angka saja (semua kekuatan diterima — keputusan pemilik).
export function cekPINValid(pin) {
  return /^\d{6}$/.test(pin);
}
