// Satu tempat untuk daftar status pesanan, status pembayaran, dan aturan transisinya.
// Kalau daftar final atau alur transisi berubah (pertanyaan terbuka PRD), ubah hanya di sini.

export const STATUS_PESANAN = [
  "Belum dicuci",
  "Diproses",
  "Siap diambil",
  "Sudah diambil",
  "Dibatalkan",
] as const;

export type StatusPesanan = (typeof STATUS_PESANAN)[number];

export const STATUS_BAYAR = ["Belum bayar", "Lunas"] as const;

export type StatusBayar = (typeof STATUS_BAYAR)[number];

// Metode pembayaran hanya dicatat, tidak diproses sistem (PRD FR-81).
// Sementara cash / non-cash saja; jenis non-cash masih pertanyaan terbuka.
export const METODE_BAYAR = ["Cash", "Non-cash"] as const;

export type MetodeBayar = (typeof METODE_BAYAR)[number];

// ---------- Aturan Transisi Status Pesanan (Phase 5B) ----------
// CATATAN ASUMSI (perlu dikonfirmasi pemilik toko — PRD bagian 13 butir 1):
// 1. Alur maju normal: Belum dicuci -> Diproses -> Siap diambil -> Sudah diambil (1 langkah).
// 2. Koreksi mundur: diizinkan mundur maksimal 1 langkah (Diproses -> Belum dicuci,
//    Siap diambil -> Diproses, Sudah diambil -> Siap diambil) dan tercatat sebagai KOREKSI di audit.
// 3. Status "Dibatalkan" bersifat final (tidak ada perubahan status maupun pembayaran setelahnya).
// 4. Status "Sudah diambil" tidak dapat dibatalkan.
// 5. Pengubahan ke "Sudah diambil" saat status_bayar masih "Belum bayar" tidak diblokir, namun
//    wajib disertai konfirmasi eksplisit kasir dan dicatat belum_bayar_saat_diambil: true di audit.

export const URUTAN_ALUR_PESANAN = [
  "Belum dicuci",
  "Diproses",
  "Siap diambil",
  "Sudah diambil",
] as const;

export const STATUS_BOLEH_DIBATALKAN: readonly StatusPesanan[] = [
  "Belum dicuci",
  "Diproses",
  "Siap diambil",
] as const;

export type HasilCekTransisiStatus =
  | { izinkan: true; jenis: "idempoten" }
  | { izinkan: true; jenis: "maju"; aksiAudit: "UBAH_STATUS" }
  | { izinkan: true; jenis: "koreksi"; aksiAudit: "KOREKSI" }
  | { izinkan: false; alasan: string };

export function periksaTransisiStatusPesanan(
  dari: StatusPesanan,
  ke: StatusPesanan
): HasilCekTransisiStatus {
  if (dari === "Dibatalkan") {
    return {
      izinkan: false,
      alasan: "Tiket sudah berstatus Dibatalkan dan bersifat final (tidak dapat diubah lagi).",
    };
  }
  if (ke === "Dibatalkan") {
    return {
      izinkan: false,
      alasan: "Gunakan aksi pembatalan tiket beserta alasan pembatalan.",
    };
  }
  if (dari === ke) {
    return { izinkan: true, jenis: "idempoten" };
  }

  const idxDari = (URUTAN_ALUR_PESANAN as readonly string[]).indexOf(dari);
  const idxKe = (URUTAN_ALUR_PESANAN as readonly string[]).indexOf(ke);

  if (idxDari === -1 || idxKe === -1) {
    return {
      izinkan: false,
      alasan: `Transisi status dari '${dari}' ke '${ke}' tidak dikenali.`,
    };
  }

  const selisih = idxKe - idxDari;
  if (selisih === 1) {
    return { izinkan: true, jenis: "maju", aksiAudit: "UBAH_STATUS" };
  }
  if (selisih === -1) {
    return { izinkan: true, jenis: "koreksi", aksiAudit: "KOREKSI" };
  }

  return {
    izinkan: false,
    alasan: `Transisi status dari '${dari}' langsung ke '${ke}' tidak diizinkan. Status pesanan hanya boleh maju atau mundur satu langkah.`,
  };
}

export function bolehBatalkanTiket(
  statusSaatIni: StatusPesanan
): { boleh: true } | { boleh: false; alasan: string } {
  if (statusSaatIni === "Dibatalkan") {
    return {
      boleh: false,
      alasan: "Tiket sudah berstatus Dibatalkan dan bersifat final.",
    };
  }
  if (statusSaatIni === "Sudah diambil") {
    return {
      boleh: false,
      alasan: "Tiket yang sudah diambil pelanggan tidak dapat dibatalkan.",
    };
  }
  return { boleh: true };
}

export type OpsiTransisiStatusUi = {
  status: StatusPesanan;
  arah: "saat_ini" | "maju" | "koreksi";
  labelPilihan: string;
};

export function daftarTargetStatusPesananValid(
  dari: StatusPesanan
): OpsiTransisiStatusUi[] {
  if (dari === "Dibatalkan") {
    return [{ status: "Dibatalkan", arah: "saat_ini", labelPilihan: "Dibatalkan (Final)" }];
  }

  const idx = (URUTAN_ALUR_PESANAN as readonly string[]).indexOf(dari);
  const hasil: OpsiTransisiStatusUi[] = [
    { status: dari, arah: "saat_ini", labelPilihan: dari },
  ];

  if (idx >= 0 && idx + 1 < URUTAN_ALUR_PESANAN.length) {
    const maju = URUTAN_ALUR_PESANAN[idx + 1];
    hasil.push({
      status: maju,
      arah: "maju",
      labelPilihan: `${maju} (Maju)`,
    });
  }

  if (idx > 0) {
    const mundur = URUTAN_ALUR_PESANAN[idx - 1];
    hasil.push({
      status: mundur,
      arah: "koreksi",
      labelPilihan: `${mundur} (Koreksi)`,
    });
  }

  return hasil;
}
