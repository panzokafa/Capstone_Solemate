// Parser pesan masuk WhatsApp untuk bot Solemate (Phase 6A).
// Bersifat murni tanpa ketergantungan database.

import type { LayananPublik } from "./katalog.ts";
import { normalisasiNomorWa } from "./nomor-wa.ts";
import { mengandungKarakterTerlarang } from "./tiket-validasi.ts";
import {
  MAKS_ITEM_PER_TIKET,
  MIN_JUMLAH_PASANG,
  MAKS_JUMLAH_PASANG,
  MAKS_DESKRIPSI_BARANG,
  MAKS_NAMA_PELANGGAN,
} from "../config/tiket.ts";
import {
  SERAH_TERIMA_ANTAR_SENDIRI,
  SERAH_TERIMA_JEMPUT,
  type SerahTerima,
} from "../config/wa-bot.ts";

export type ItemPesananWaParsed = {
  service_id: number;
  nama_layanan: string;
  jumlah: number;
  deskripsi_barang: string;
  harga_saat_transaksi: number;
  estimasi_hari: number;
};

export type HasilParsePemesananWa =
  | {
      ok: true;
      nama: string;
      items: ItemPesananWaParsed[];
      serah_terima: SerahTerima;
      nomor_wa_manual?: string;
    }
  | {
      ok: false;
      galat: string;
      baris?: number;
    };

/**
 * Mendeteksi apakah pesan merupakan perintah menu / sapaan awal.
 */
export function adalahPesanMenu(teks: string): boolean {
  const t = teks.trim().toLowerCase();
  const daftarKata = ["menu", "halo", "hai", "hi", "p", "start", "bantuan", "help", "mulai"];
  return daftarKata.includes(t);
}

/**
 * Mendeteksi apakah pesan meminta daftar katalog & harga (angka 1 atau kata kunci).
 */
export function adalahPesanKatalog(teks: string): boolean {
  const t = teks.trim().toLowerCase();
  return (
    t === "1" ||
    t === "layanan" ||
    t === "katalog" ||
    t === "daftar harga" ||
    t === "harga" ||
    t === "pricelist"
  );
}

/**
 * Mendeteksi apakah pesan meminta panduan format pemesanan (angka 2 atau kata kunci).
 */
export function adalahPesanFormatPemesanan(teks: string): boolean {
  const t = teks.trim().toLowerCase();
  return (
    t === "2" ||
    t === "format" ||
    t === "cara pesan" ||
    t === "order" ||
    t === "pesan"
  );
}

/**
 * Mendeteksi apakah pesan meminta cek status / progress pesanan (angka 3 atau awalan 'cek'/'status').
 */
export function adalahPesanCekProgress(teks: string): boolean {
  const t = teks.trim().toLowerCase();
  return (
    t === "3" ||
    t === "cek" ||
    t === "status" ||
    t.startsWith("cek ") ||
    t.startsWith("status ")
  );
}

/**
 * Mengekstrak kode tiket SM-YYYYMMDD-XXX dari perintah cek (bila ada).
 */
export function ekstrakKodeTiketCek(teks: string): string | null {
  const cocok = teks.match(/\b(SM-\d{8}-\d{3})\b/i);
  return cocok ? cocok[1].toUpperCase() : null;
}

/**
 * Mendeteksi apakah pesan merupakan upaya pemesanan cuci sepatu.
 * Mendeteksi pesan multi-baris yang memuat label (Nama, Barang, Antar/Jemput),
 * atau baris berpola item "layanan/angka | jumlah | deskripsi",
 * atau kata kunci serah terima (Jemput / Antar sendiri).
 */
export function adalahUpayaPemesanan(teks: string): boolean {
  if (
    adalahPesanMenu(teks) ||
    adalahPesanKatalog(teks) ||
    adalahPesanFormatPemesanan(teks) ||
    adalahPesanCekProgress(teks)
  ) {
    return false;
  }

  const baris = teks
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  // 1. Baris berpola item "layanan/angka | jumlah | deskripsi"
  const polaItem = /^[^|]+\|\s*\d+\s*\|\s*.+$/;
  if (baris.some((b) => polaItem.test(b))) {
    return true;
  }

  // 2. Baris memuat label pemesanan dengan titik dua atau spasi
  const polaLabel = /^(?:nama|barang|sepatu|antar\s*\/\s*jemput|serah\s*terima|nomor\s*wa|no\s*wa)\s*[:\s]/i;
  if (baris.some((b) => polaLabel.test(b))) {
    return true;
  }

  // 3. Memuat kata serah terima khas
  const polaSerahTerima = /\b(jemput|antar\s*sendiri)\b/i;
  if (baris.some((b) => polaSerahTerima.test(b))) {
    return true;
  }

  // 4. Pesan multi-baris (>= 2 baris) yang memuat kata kunci pemesanan
  if (baris.length >= 2) {
    const teksLower = teks.toLowerCase();
    if (
      teksLower.includes("nama") ||
      teksLower.includes("barang") ||
      teksLower.includes("sepatu") ||
      teksLower.includes("cuci") ||
      teksLower.includes("|")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Mendeteksi apakah pesan berisi format pemesanan cuci sepatu.
 * Menggunakan deteksi upaya pemesanan yang toleran.
 */
export function adalahFormatPemesanan(teks: string): boolean {
  return adalahUpayaPemesanan(teks);
}

/**
 * Membantu pencocokan layanan berdasarkan nomor urut pricelist aktif (1..N) atau nama layanan persis.
 * Tidak mencocokkan angka ke ID database untuk menghindari ambiguitas penomoran layanan.
 */
function cariLayanan(
  pengenal: string,
  layananAktif: LayananPublik[]
): LayananPublik | null {
  const bersih = pengenal.trim();
  if (/^\d+$/.test(bersih)) {
    const angka = parseInt(bersih, 10);
    // Cek nomor urut 1-based dari urutan tampilan katalog aktif (1..N)
    if (angka >= 1 && angka <= layananAktif.length) {
      return layananAktif[angka - 1];
    }
    // Angka di luar rentang nomor urut katalog aktif ditolak
    return null;
  }

  // Cek pencocokan nama layanan (case-insensitive)
  const namaLower = bersih.toLowerCase();
  const dariNama = layananAktif.find(
    (l) => l.nama.toLowerCase() === namaLower
  );
  if (dariNama) return dariNama;

  return null;
}

/**
 * Mem-parsing isi pesan pemesanan sesuai format yang ditentukan.
 * Menerapkan toleransi:
 * - Mengabaikan spasi di sekitar titik dua pada semua label.
 * - Mengabaikan huruf besar-kecil pada nama label dan nilai.
 * - Menerima spasi di sekitar garis miring pada label "Antar / Jemput".
 * - Menerima label Barang tanpa titik dua jika langsung diikuti pola item ("Barang 1 | 1 | ...").
 * - Menerima nilai serah terima dalam variasi huruf apa pun ("antar sendiri", "Jemput").
 * - Tidak menebak label yang hilang tanpa petunjuk jelas.
 */
export function parsePesanPemesananWa(
  teks: string,
  layananAktif: LayananPublik[]
): HasilParsePemesananWa {
  const barisDaftar = teks
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  let nama: string | null = null;
  let serahTerima: SerahTerima | null = null;
  let nomorWaManual: string | undefined;
  const barisBarangRaw: string[] = [];

  let sedangDalamBlokBarang = false;

  for (let idx = 0; idx < barisDaftar.length; idx++) {
    const baris = barisDaftar[idx];

    // 1. Label Nama (case-insensitive, spasi fleksibel di sekitar titik dua)
    const matchNama = baris.match(/^nama\s*:\s*(.*)$/i);
    if (matchNama) {
      sedangDalamBlokBarang = false;
      const isi = matchNama[1].trim();
      if (isi.length === 0) {
        return {
          ok: false,
          galat: "Nama pelanggan pada baris 'Nama:' tidak boleh kosong.",
          baris: idx + 1,
        };
      }
      if (isi.length > MAKS_NAMA_PELANGGAN) {
        return {
          ok: false,
          galat: `Nama pelanggan maksimal ${MAKS_NAMA_PELANGGAN} karakter.`,
          baris: idx + 1,
        };
      }
      if (mengandungKarakterTerlarang(isi)) {
        return {
          ok: false,
          galat: "Nama pelanggan mengandung karakter terlarang (karakter kontrol, pembalik arah teks, atau karakter lebar-nol).",
          baris: idx + 1,
        };
      }
      nama = isi;
      continue;
    }

    // 2. Label Antar/Jemput (spasi di sekitar garis miring dan titik dua diabaikan)
    const matchAntarJemput = baris.match(
      /^(?:antar\s*\/\s*jemput|serah\s*terima|metode)\s*:\s*(.*)$/i
    );
    if (matchAntarJemput) {
      sedangDalamBlokBarang = false;
      const isi = matchAntarJemput[1].trim().toLowerCase();
      if (
        isi === "antar sendiri" ||
        isi === "antar" ||
        isi === "antar_sendiri" ||
        isi === "antar-sendiri"
      ) {
        serahTerima = SERAH_TERIMA_ANTAR_SENDIRI;
      } else if (isi === "jemput") {
        serahTerima = SERAH_TERIMA_JEMPUT;
      } else {
        return {
          ok: false,
          galat: "Metode serah terima harus 'Antar sendiri' atau 'Jemput'.",
          baris: idx + 1,
        };
      }
      continue;
    }

    // 3. Label Nomor WA (opsional untuk akun reguler, wajib untuk @lid)
    const matchNomorWa = baris.match(
      /^(?:nomor\s*wa|no\s*wa|wa)\s*:\s*(.*)$/i
    );
    if (matchNomorWa) {
      sedangDalamBlokBarang = false;
      const isi = matchNomorWa[1].trim();
      const norm = normalisasiNomorWa(isi);
      if (!norm.ok) {
        return {
          ok: false,
          galat: `Nomor WhatsApp tidak valid: ${norm.galat}`,
          baris: idx + 1,
        };
      }
      nomorWaManual = norm.nomor;
      continue;
    }

    // 4. Label Barang / Sepatu
    // Menerima dengan titik dua ("Barang: ...", "Barang : ...")
    // atau tanpa titik dua jika langsung diikuti pola item ber-pipa ("Barang 1 | 1 | ...")
    const matchBarang = baris.match(
      /^(?:barang|sepatu)(?:\s*:|\s+(?=\S+\s*\|))\s*(.*)$/i
    );
    if (matchBarang) {
      const sisa = matchBarang[1].trim();
      if (sisa.length > 0) {
        barisBarangRaw.push(sisa);
        sedangDalamBlokBarang = true;
      } else {
        sedangDalamBlokBarang = true;
      }
      continue;
    }

    // 5. Item dalam blok barang atau baris ber-peluru dalam blok barang
    if (sedangDalamBlokBarang) {
      const barisBersih = baris.replace(/^[-*•]\s*/, "").trim();
      if (barisBersih.includes("|")) {
        barisBarangRaw.push(barisBersih);
        continue;
      }
    }
  }

  if (!nama) {
    return {
      ok: false,
      galat: "Mohon cantumkan nama dengan format 'Nama: <Nama Anda>'.",
    };
  }

  if (barisBarangRaw.length === 0) {
    return {
      ok: false,
      galat: "Mohon cantumkan minimal 1 barang dengan format 'Barang: <Layanan> | <Jumlah> | <Deskripsi Sepatu>'.",
    };
  }

  if (barisBarangRaw.length > MAKS_ITEM_PER_TIKET) {
    return {
      ok: false,
      galat: `Jumlah barang dalam satu pesanan maksimal ${MAKS_ITEM_PER_TIKET} jenis.`,
    };
  }

  const items: ItemPesananWaParsed[] = [];
  let totalPasang = 0;

  for (let i = 0; i < barisBarangRaw.length; i++) {
    const raw = barisBarangRaw[i];
    const bagian = raw.split("|").map((p) => p.trim());
    if (bagian.length < 3) {
      return {
        ok: false,
        galat: `Baris barang ke-${i + 1} tidak lengkap. Gunakan format: '<Layanan> | <Jumlah> | <Deskripsi Sepatu>'.`,
        baris: i + 1,
      };
    }

    const [teksLayanan, teksJumlah, ...sisaDeskripsi] = bagian;
    const teksDeskripsi = sisaDeskripsi.join(" | ").trim();

    const layanan = cariLayanan(teksLayanan, layananAktif);
    if (!layanan) {
      return {
        ok: false,
        galat: `Layanan '${teksLayanan}' pada barang ke-${i + 1} tidak ditemukan pada katalog aktif. Ketik *1* untuk melihat daftar layanan.`,
        baris: i + 1,
      };
    }

    if (!/^\d+$/.test(teksJumlah)) {
      return {
        ok: false,
        galat: `Jumlah pasang pada barang ke-${i + 1} harus berupa angka bulat positif (1-${MAKS_JUMLAH_PASANG}).`,
        baris: i + 1,
      };
    }

    const jumlah = parseInt(teksJumlah, 10);
    if (jumlah < MIN_JUMLAH_PASANG || jumlah > MAKS_JUMLAH_PASANG) {
      return {
        ok: false,
        galat: `Jumlah pasang pada barang ke-${i + 1} minimal ${MIN_JUMLAH_PASANG} dan maksimal ${MAKS_JUMLAH_PASANG}.`,
        baris: i + 1,
      };
    }

    if (teksDeskripsi.length === 0) {
      return {
        ok: false,
        galat: `Deskripsi sepatu pada barang ke-${i + 1} tidak boleh kosong.`,
        baris: i + 1,
      };
    }

    if (teksDeskripsi.length > MAKS_DESKRIPSI_BARANG) {
      return {
        ok: false,
        galat: `Deskripsi sepatu pada barang ke-${i + 1} maksimal ${MAKS_DESKRIPSI_BARANG} karakter.`,
        baris: i + 1,
      };
    }

    if (mengandungKarakterTerlarang(teksDeskripsi)) {
      return {
        ok: false,
        galat: `Deskripsi sepatu pada barang ke-${i + 1} mengandung karakter terlarang.`,
        baris: i + 1,
      };
    }

    totalPasang += jumlah;
    if (totalPasang > MAKS_JUMLAH_PASANG) {
      return {
        ok: false,
        galat: `Total kuantitas sepatu dalam satu pesanan maksimal ${MAKS_JUMLAH_PASANG} pasang.`,
      };
    }

    items.push({
      service_id: layanan.id,
      nama_layanan: layanan.nama,
      jumlah,
      deskripsi_barang: teksDeskripsi,
      harga_saat_transaksi: layanan.harga,
      estimasi_hari: layanan.estimasi_hari,
    });
  }

  if (!serahTerima) {
    return {
      ok: false,
      galat: "Mohon cantumkan metode serah terima dengan format 'Antar/Jemput: Antar sendiri' atau 'Antar/Jemput: Jemput'.",
    };
  }

  return {
    ok: true,
    nama,
    items,
    serah_terima: serahTerima,
    nomor_wa_manual: nomorWaManual,
  };
}

/**
 * Menghasilkan petunjuk spesifik untuk pesan pemesanan yang belum valid atau kurang lengkap.
 * Menyebutkan baris yang salah dan apa yang kurang beserta contoh format yang benar.
 */
export function diagnosaUpayaPemesanan(
  teks: string,
  layananAktif: LayananPublik[],
  galatUtama?: string
): string {
  const barisDaftar = teks
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const petunjukBaris: string[] = [];
  let adaNama = false;
  let adaBarang = false;
  let adaAntarJemput = false;

  for (let idx = 0; idx < barisDaftar.length; idx++) {
    const noBaris = idx + 1;
    const baris = barisDaftar[idx];
    const barisLower = baris.toLowerCase();

    // 1. Cek baris Nama
    if (/^nama\s*:/i.test(baris)) {
      adaNama = true;
      const isi = baris.replace(/^nama\s*:\s*/i, "").trim();
      if (isi.length === 0) {
        petunjukBaris.push(
          `Baris ${noBaris}: setelah kata 'Nama:' perlu diisi nama Anda. Contoh: Nama: Husna`
        );
      } else if (mengandungKarakterTerlarang(isi)) {
        petunjukBaris.push(
          `Baris ${noBaris}: nama pemesan mengandung karakter terlarang (karakter kontrol, pembalik arah teks, atau zero-width).`
        );
      }
      continue;
    }
    if (/^nama\b/i.test(baris) && !/^nama\s*:/i.test(baris)) {
      adaNama = true;
      const sisa = baris.replace(/^nama\s*/i, "").trim();
      petunjukBaris.push(
        `Baris ${noBaris}: setelah kata Nama perlu tanda titik dua (:). Contoh: Nama: ${sisa || "Husna"}`
      );
      continue;
    }

    // 2. Cek baris Barang / Sepatu / Item
    if (/^(?:barang|sepatu)(?:\s*:|\s+(?=\S+\s*\|))/i.test(baris)) {
      adaBarang = true;
      const match = baris.match(/^(?:barang|sepatu)(?:\s*:|\s+(?=\S+\s*\|))\s*(.*)$/i);
      const sisa = match ? match[1].trim() : "";
      if (sisa.length > 0) {
        const bagian = sisa.split("|").map((p) => p.trim());
        if (bagian.length < 3) {
          petunjukBaris.push(
            `Baris ${noBaris}: rincian barang perlu 3 bagian dipisah tanda garis tegak (|): nomor layanan | jumlah | deskripsi sepatu. Contoh: Barang: 1 | 1 | Sepatu Nike putih`
          );
        } else {
          const [p0, p1, ...p2] = bagian;
          const lay = cariLayanan(p0, layananAktif);
          if (!lay) {
            petunjukBaris.push(
              `Baris ${noBaris}: layanan '${p0}' tidak ditemukan. Ketik *1* untuk melihat nomor & nama layanan aktif.`
            );
          }
          if (!/^\d+$/.test(p1) || parseInt(p1, 10) < 1 || parseInt(p1, 10) > 20) {
            petunjukBaris.push(
              `Baris ${noBaris}: jumlah pasang sepatu harus berupa angka antara 1 sampai 20. Contoh: Barang: 1 | 1 | Sepatu Nike putih`
            );
          }
          if (p2.join(" | ").trim().length === 0) {
            petunjukBaris.push(
              `Baris ${noBaris}: deskripsi sepatu tidak boleh kosong. Contoh: Barang: 1 | 1 | Sepatu Nike putih`
            );
          }
        }
      }
      continue;
    }
    if (/^(?:barang|sepatu)\b/i.test(baris) && !baris.includes("|")) {
      adaBarang = true;
      petunjukBaris.push(
        `Baris ${noBaris}: setelah kata Barang perlu tanda titik dua dan rincian sepatu. Contoh: Barang: 1 | 1 | Sepatu Nike putih`
      );
      continue;
    }
    if (baris.includes("|")) {
      adaBarang = true;
      petunjukBaris.push(
        `Baris ${noBaris}: sebelum rincian barang perlu label 'Barang:'. Contoh: Barang: ${baris}`
      );
      continue;
    }

    // 3. Cek baris Antar / Jemput
    if (/^(?:antar\s*\/\s*jemput|serah\s*terima|metode)\s*:/i.test(baris)) {
      adaAntarJemput = true;
      const isi = baris
        .replace(/^(?:antar\s*\/\s*jemput|serah\s*terima|metode)\s*:\s*/i, "")
        .trim()
        .toLowerCase();
      if (
        !["jemput", "antar sendiri", "antar", "antar_sendiri", "antar-sendiri"].includes(
          isi
        )
      ) {
        petunjukBaris.push(
          `Baris ${noBaris}: pilihan serah terima harus 'Antar sendiri' atau 'Jemput'. Contoh: Antar/Jemput: Jemput`
        );
      }
      continue;
    }
    if (
      barisLower === "jemput" ||
      barisLower === "antar sendiri" ||
      barisLower === "antar" ||
      barisLower.startsWith("jemput") ||
      barisLower.startsWith("antar")
    ) {
      adaAntarJemput = true;
      petunjukBaris.push(
        `Baris ${noBaris}: sebelum pilihan serah terima perlu label 'Antar/Jemput:'. Contoh: Antar/Jemput: ${baris}`
      );
      continue;
    }

    // 4. Baris tanpa label pemesanan
    if (!adaNama && idx === 0 && !baris.includes("|")) {
      adaNama = true;
      petunjukBaris.push(
        `Baris ${noBaris}: sebelum nama perlu label 'Nama:'. Contoh: Nama: ${baris}`
      );
      continue;
    }

    // 5. Nomor WA
    if (/^(?:nomor\s*wa|no\s*wa|wa)\s*:/i.test(baris)) {
      continue;
    }

    petunjukBaris.push(`Baris ${noBaris} ('${baris}'): format baris ini belum dikenali.`);
  }

  // Cek kelengkapan komponen yang sama sekali belum ada
  if (!adaNama) {
    petunjukBaris.push("Belum ada baris nama pemesan. Tambahkan: Nama: <Nama Anda>");
  }
  if (!adaBarang) {
    petunjukBaris.push(
      "Belum ada baris rincian barang. Tambahkan: Barang: 1 | 1 | <Deskripsi sepatu>"
    );
  }
  if (!adaAntarJemput) {
    petunjukBaris.push(
      "Belum ada metode serah terima. Tambahkan: Antar/Jemput: Antar sendiri (atau Jemput)"
    );
  }

  // Jika ada galat spesifik dari parser yang belum tercakup
  if (petunjukBaris.length === 0 && galatUtama) {
    petunjukBaris.push(galatUtama);
  }

  let pesan = `⚠️ *Format Pemesanan Belum Sesuai*\n\nMohon periksa bagian berikut:\n`;
  petunjukBaris.forEach((p) => {
    pesan += `• ${p}\n`;
  });
  pesan += `\n📋 *Contoh Format yang Benar:*\nNama: Budi Santoso\nBarang: 1 | 1 | Sepatu Nike putih\nAntar/Jemput: Jemput\n\n_Ketik *1* untuk melihat nomor layanan aktif, atau ketik *2* untuk panduan lengkap._`;

  return pesan;
}

