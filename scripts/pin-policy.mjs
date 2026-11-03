// Aturan PIN lemah — dipakai scripts/create-user.mjs dan tes.
// Lemah: semua digit sama (0000, 1111) atau deret naik/turun (1234, 456789).

export function cekPINLemah(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  return pin
    .split("")
    .every((d, i, a) => i === 0 || Math.abs(Number(d) - Number(a[i - 1])) === 1);
}
