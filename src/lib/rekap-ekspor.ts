// Layanan model dokumen tunggal & renderer ekspor Rekap Bulanan (Excel .xlsx & PDF).
// Phase 7B Extension (FR-53): hanya owner, hanya-baca, tanpa PII pelanggan, audit fail-closed.
// Menggunakan font standar lokal PDFKit (Helvetica) dan cell bertipe eksplisit di write-excel-file.

import type { Pool, PoolClient } from "pg";
import PDFDocument from "pdfkit";
import writeXlsxFile, { type Row, type Sheet, type SheetData } from "write-excel-file/node";
import type { FormatEksporRekap } from "../config/laporan.ts";
import { formatRupiah, formatTanggal } from "./format.ts";
import { getPool } from "./db.ts";
import {
  ambilJamBuatDbWib,
  ambilRekapBulanan,
  type DataRekapBulanan,
  type FilterRekapBulanan,
} from "./laporan.ts";

export type BarisMetrikDokumen = {
  kategori: string;
  label: string;
  tiket: number | null;
  pasang: number | null;
  nominal: number | null;
};

export type BarisLayananDokumen = {
  peringkat: string;
  nama: string;
  jumlahPasang: number;
  persentasePasang: number; // 0..100 (1 desimal)
  persentasePecahan: number; // 0..1 untuk format Excel 0.0%
  totalNominal: number;
  adalahLainnya: boolean;
};

export type ModelDokumenRekap = {
  judul: string;
  subjudul: string;
  rentangDari: string;
  rentangSampai: string;
  labelRentang: string;
  dibuatPada: string;
  namaBerkasDasar: string;
  ringkasan: BarisMetrikDokumen[];
  labaRugi: {
    label: string;
    pesan: string;
  };
  layanan: {
    daftar: BarisLayananDokumen[];
    totalPasang: number;
    totalNominal: number;
    jumlahLayananUnik: number;
    kosong: boolean;
  };
  catatanPembulatan: string;
  catatanDefinisi: string;
  disclaimer: string;
};

const MAKS_PANJANG_NAMA_PDF = 220;

function formatPersenTeks(nilai: number): string {
  const aman = Number.isFinite(nilai) && nilai >= 0 ? nilai : 0;
  return `${aman.toFixed(1).replace(".", ",")}%`;
}

function formatRentangLabel(dari: string, sampai: string): string {
  const tglDari = formatTanggal(dari);
  const tglSampai = formatTanggal(sampai);
  return dari === sampai ? tglDari : `${tglDari} s/d ${tglSampai}`;
}

/**
 * Membersihkan karakter kontrol XML 1.0 yang tidak valid agar XML .xlsx tetap valid.
 * Karakter awalan rumus (=, +, -, @) sengaja dipertahankan sebagai teks literal (bukan formula).
 */
function bersihkanTeksExcel(nilai: unknown): string {
  const s = typeof nilai === "string" ? nilai : String(nilai ?? "");
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Sanitasi teks untuk PDF berbasis font Type1 WinAnsi (Helvetica/Helvetica-Bold).
 * Menormalkan tanda baca umum, menghapus karakter kontrol/bidi agar tidak rusak/crash,
 * dan mengganti emoji atau aksara non-Latin di luar jangkauan WinAnsi secara aman dengan '?'.
 */
export function sanitasiTeksPdf(nilai: unknown): string {
  const mentah = typeof nilai === "string" ? nilai : String(nilai ?? "");
  const ternormalisasi = mentah
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");

  const hasil: string[] = [];
  for (const ch of ternormalisasi) {
    const cp = ch.codePointAt(0) ?? 0;
    const amanAscii = cp >= 0x20 && cp <= 0x7e;
    const amanLatin1 = cp >= 0xa1 && cp <= 0xff && cp !== 0xad;
    if (amanAscii || amanLatin1) {
      hasil.push(ch);
    } else {
      hasil.push("?");
    }
  }

  return hasil.join("").replace(/ {2,}/g, " ").trim();
}

function potongNamaPdf(nama: string): string {
  const bersih = sanitasiTeksPdf(nama) || "-";
  if (bersih.length <= MAKS_PANJANG_NAMA_PDF) return bersih;
  return `${bersih.slice(0, MAKS_PANJANG_NAMA_PDF - 3).trimEnd()}...`;
}

/**
 * Membangun model dokumen tunggal yang dipakai bersama oleh renderer Excel dan PDF.
 * Tidak melakukan hitung ulang agregasi dan tidak menyertakan data pribadi pelanggan.
 */
export function bangunModelDokumenRekap(
  rekap: DataRekapBulanan,
  dibuatPadaWib: string
): ModelDokumenRekap {
  const pm = rekap.pesanan_masuk;
  const pb = rekap.pembayaran_diterima;
  const lt = rekap.layanan_terlaris;

  const ringkasan: BarisMetrikDokumen[] = [
    {
      kategori: "Pesanan Masuk",
      label: "Total Pesanan Masuk (Non-Batal)",
      tiket: pm.total_tiket,
      pasang: pm.total_pasang,
      nominal: pm.total_nominal,
    },
    {
      kategori: "Pesanan Masuk",
      label: "Pesanan Lunas",
      tiket: pm.lunas.total_tiket,
      pasang: pm.lunas.total_pasang,
      nominal: pm.lunas.total_nominal,
    },
    {
      kategori: "Pesanan Masuk",
      label: "Pesanan Belum Bayar",
      tiket: pm.belum_bayar.total_tiket,
      pasang: pm.belum_bayar.total_pasang,
      nominal: pm.belum_bayar.total_nominal,
    },
    {
      kategori: "Pembayaran Diterima",
      label: "Total Pembayaran Diterima",
      tiket: pb.total_tiket,
      pasang: null,
      nominal: pb.total_nominal,
    },
    {
      kategori: "Pembayaran Diterima",
      label: "Tunai / Cash",
      tiket: pb.cash.total_tiket,
      pasang: null,
      nominal: pb.cash.total_nominal,
    },
    {
      kategori: "Pembayaran Diterima",
      label: "Non-Cash",
      tiket: pb.non_cash.total_tiket,
      pasang: null,
      nominal: pb.non_cash.total_nominal,
    },
  ];

  const daftarLayanan: BarisLayananDokumen[] = lt.daftar.map((item) => {
    const namaTampil = item.adalah_lainnya
      ? "Lainnya"
      : item.aktif
        ? item.nama_layanan
        : `${item.nama_layanan} (nonaktif)`;

    return {
      peringkat: item.adalah_lainnya ? "Lainnya" : `#${item.peringkat ?? "-"}`,
      nama: namaTampil,
      jumlahPasang: item.jumlah_pasang,
      persentasePasang: item.persentase_pasang,
      persentasePecahan: Number((item.persentase_pasang / 100).toFixed(3)),
      totalNominal: item.total_nominal,
      adalahLainnya: item.adalah_lainnya,
    };
  });

  return {
    judul: "Rekap Bulanan Solemate Shoes Clean",
    subjudul: "Laporan Operasional & Keuangan (Hanya-Baca)",
    rentangDari: rekap.rentang.dari,
    rentangSampai: rekap.rentang.sampai,
    labelRentang: formatRentangLabel(rekap.rentang.dari, rekap.rentang.sampai),
    dibuatPada: dibuatPadaWib || "-",
    namaBerkasDasar: `rekap-solemate_${rekap.rentang.dari}_sd_${rekap.rentang.sampai}`,
    ringkasan,
    labaRugi: {
      label: "Laba Rugi (FR-52)",
      pesan: rekap.laba_rugi.pesan,
    },
    layanan: {
      daftar: daftarLayanan,
      totalPasang: lt.total_pasang,
      totalNominal: lt.total_nominal,
      jumlahLayananUnik: lt.jumlah_layanan_unik,
      kosong: daftarLayanan.length === 0,
    },
    catatanPembulatan: lt.catatan_pembulatan,
    catatanDefinisi:
      "Pesanan Masuk & Layanan Terlaris dihitung dari tiket non-batal menurut tanggal masuk (WIB). Pembayaran Diterima dihitung menurut tanggal bayar (WIB) dan tidak menyertakan tiket berstatus Dibatalkan. Nominal memakai harga saat transaksi masing-masing tiket.",
    disclaimer: rekap.disclaimer,
  };
}

function selTeks(
  nilai: unknown,
  opsi?: {
    fontWeight?: "bold";
    align?: "left" | "center" | "right";
    wrap?: boolean;
  }
): Row[number] {
  return {
    value: bersihkanTeksExcel(nilai),
    type: String,
    ...(opsi?.fontWeight ? { fontWeight: opsi.fontWeight } : {}),
    ...(opsi?.align ? { align: opsi.align } : {}),
    ...(opsi?.wrap ? { wrap: opsi.wrap } : {}),
  };
}

function selAngka(
  nilai: number,
  format: string,
  opsi?: { fontWeight?: "bold" }
): Row[number] {
  const aman = Number.isFinite(nilai) ? nilai : 0;
  return {
    value: aman,
    type: Number,
    format,
    align: "right",
    ...(opsi?.fontWeight ? { fontWeight: opsi.fontWeight } : {}),
  };
}

/**
 * Merender workbook Excel (.xlsx) 2 sheet ("Ringkasan" & "Layanan Terlaris")
 * dari model dokumen tunggal tanpa formula Excel.
 */
export async function renderRekapExcel(model: ModelDokumenRekap): Promise<Buffer> {
  const FORMAT_JUMLAH = "#,##0";
  const FORMAT_RUPIAH = '"Rp "#,##0';
  const FORMAT_PERSEN = "0.0%";

  const dataRingkasan: SheetData = [
    [
      selTeks(model.judul, { fontWeight: "bold" }),
      selTeks(model.subjudul),
      selTeks(""),
      selTeks(""),
      selTeks(""),
    ],
    [
      selTeks("Rentang Periode (WIB)", { fontWeight: "bold" }),
      selTeks(`${model.labelRentang} (${model.rentangDari} s/d ${model.rentangSampai})`),
      selTeks(""),
      selTeks(""),
      selTeks(""),
    ],
    [
      selTeks("Dibuat Pada (WIB)", { fontWeight: "bold" }),
      selTeks(model.dibuatPada),
      selTeks(""),
      selTeks(""),
      selTeks(""),
    ],
    [],
    [
      selTeks("Bagian", { fontWeight: "bold" }),
      selTeks("Metrik", { fontWeight: "bold" }),
      selTeks("Tiket", { fontWeight: "bold", align: "right" }),
      selTeks("Pasang", { fontWeight: "bold", align: "right" }),
      selTeks("Nominal (Rp)", { fontWeight: "bold", align: "right" }),
    ],
  ];

  for (const r of model.ringkasan) {
    dataRingkasan.push([
      selTeks(r.kategori),
      selTeks(r.label),
      r.tiket !== null ? selAngka(r.tiket, FORMAT_JUMLAH) : selTeks("-"),
      r.pasang !== null ? selAngka(r.pasang, FORMAT_JUMLAH) : selTeks("-"),
      r.nominal !== null ? selAngka(r.nominal, FORMAT_RUPIAH) : selTeks("-"),
    ]);
  }

  dataRingkasan.push([]);
  dataRingkasan.push([
    selTeks(model.labaRugi.label, { fontWeight: "bold" }),
    selTeks(model.labaRugi.pesan, { wrap: true }),
  ]);
  dataRingkasan.push([
    selTeks("Definisi Angka", { fontWeight: "bold" }),
    selTeks(model.catatanDefinisi, { wrap: true }),
  ]);
  dataRingkasan.push([
    selTeks("Catatan", { fontWeight: "bold" }),
    selTeks(model.disclaimer, { wrap: true }),
  ]);

  const dataLayanan: SheetData = [
    [
      selTeks(`${model.judul} - Layanan Terlaris`, { fontWeight: "bold" }),
      selTeks(model.labelRentang),
      selTeks(""),
      selTeks(""),
      selTeks(""),
    ],
    [
      selTeks("Rentang Tanggal (WIB)", { fontWeight: "bold" }),
      selTeks(`${model.rentangDari} s/d ${model.rentangSampai}`),
      selTeks("Layanan", { fontWeight: "bold" }),
      selAngka(model.layanan.jumlahLayananUnik, FORMAT_JUMLAH),
      selTeks(""),
    ],
    [],
    [
      selTeks("Peringkat", { fontWeight: "bold" }),
      selTeks("Nama Layanan", { fontWeight: "bold" }),
      selTeks("Jumlah Pasang", { fontWeight: "bold", align: "right" }),
      selTeks("Persentase", { fontWeight: "bold", align: "right" }),
      selTeks("Nominal (Rp)", { fontWeight: "bold", align: "right" }),
    ],
  ];

  if (model.layanan.kosong) {
    dataLayanan.push([
      selTeks("-"),
      selTeks("Belum ada layanan pada rentang tanggal ini"),
      selAngka(0, FORMAT_JUMLAH),
      selAngka(0, FORMAT_PERSEN),
      selAngka(0, FORMAT_RUPIAH),
    ]);
  } else {
    for (const bar of model.layanan.daftar) {
      dataLayanan.push([
        selTeks(bar.peringkat),
        selTeks(bar.nama),
        selAngka(bar.jumlahPasang, FORMAT_JUMLAH),
        selAngka(bar.persentasePecahan, FORMAT_PERSEN),
        selAngka(bar.totalNominal, FORMAT_RUPIAH),
      ]);
    }
  }

  dataLayanan.push([
    selTeks("Total", { fontWeight: "bold" }),
    selTeks("Total Seluruh Layanan", { fontWeight: "bold" }),
    selAngka(model.layanan.totalPasang, FORMAT_JUMLAH, { fontWeight: "bold" }),
    selTeks("-", { align: "right", fontWeight: "bold" }),
    selAngka(model.layanan.totalNominal, FORMAT_RUPIAH, { fontWeight: "bold" }),
  ]);

  dataLayanan.push([]);
  dataLayanan.push([
    selTeks("Catatan Pembulatan", { fontWeight: "bold" }),
    selTeks(model.catatanPembulatan, { wrap: true }),
  ]);
  dataLayanan.push([
    selTeks("Catatan", { fontWeight: "bold" }),
    selTeks(model.disclaimer, { wrap: true }),
  ]);

  const sheets: Sheet<Buffer>[] = [
    {
      sheet: "Ringkasan",
      data: dataRingkasan,
      stickyRowsCount: 5,
      columns: [
        { width: 24 },
        { width: 38 },
        { width: 14 },
        { width: 14 },
        { width: 22 },
      ],
    },
    {
      sheet: "Layanan Terlaris",
      data: dataLayanan,
      stickyRowsCount: 4,
      columns: [
        { width: 14 },
        { width: 38 },
        { width: 16 },
        { width: 14 },
        { width: 22 },
      ],
    },
  ];

  return await writeXlsxFile(sheets, {
    fontFamily: "Calibri",
    fontSize: 11,
  }).toBuffer();
}

/**
 * Merender dokumen PDF A4 portrait dari model dokumen tunggal menggunakan font lokal Helvetica.
 */
export async function renderRekapPdf(model: ModelDokumenRekap): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      bufferPages: true,
      compress: false,
      info: {
        Title: sanitasiTeksPdf(model.judul),
        Author: "Solemate Shoes Clean",
        Subject: `Rekap Bulanan ${model.rentangDari} s/d ${model.rentangSampai}`,
        Creator: "Solemate",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const kiri = 44;
    const lebarKonten = doc.page.width - kiri * 2;
    const batasBawah = doc.page.height - 56;

    const warnaTeksUtama: [number, number, number] = [24, 30, 41];
    const warnaTeksRedup: [number, number, number] = [88, 96, 110];
    const warnaPrimer: [number, number, number] = [13, 47, 82];
    const warnaLatarHeader: [number, number, number] = [238, 242, 247];
    const warnaGaris: [number, number, number] = [212, 218, 226];

    let y = kiri;

    function pastikanRuang(tinggiButuh: number, gambarHeaderLayanan?: () => void) {
      if (y + tinggiButuh <= batasBawah) return;
      doc.addPage();
      y = kiri;
      if (gambarHeaderLayanan) {
        gambarHeaderLayanan();
      }
    }

    function gambarGarisHorizontal(posY: number) {
      doc
        .save()
        .strokeColor(warnaGaris)
        .lineWidth(0.75)
        .moveTo(kiri, posY)
        .lineTo(kiri + lebarKonten, posY)
        .stroke()
        .restore();
    }

    // --- Header Laporan ---
    doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(9);
    doc.text("SOLEMATE SHOES CLEAN", kiri, y, { width: lebarKonten });
    y += 14;

    doc.fillColor(warnaTeksUtama).font("Helvetica-Bold").fontSize(16);
    doc.text(sanitasiTeksPdf(model.judul), kiri, y, { width: lebarKonten });
    y += 22;

    doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(9.5);
    doc.text(sanitasiTeksPdf(model.subjudul), kiri, y, { width: lebarKonten });
    y += 15;

    doc.fillColor(warnaTeksUtama).font("Helvetica").fontSize(9.5);
    doc.text(
      `Rentang Periode (WIB): ${sanitasiTeksPdf(model.labelRentang)} (${model.rentangDari} s/d ${model.rentangSampai})`,
      kiri,
      y,
      { width: lebarKonten }
    );
    y += 14;

    doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(9);
    doc.text(`Dibuat pada (WIB): ${sanitasiTeksPdf(model.dibuatPada)}`, kiri, y, {
      width: lebarKonten,
    });
    y += 16;

    gambarGarisHorizontal(y);
    y += 12;

    // --- Bagian 1: Ringkasan Pesanan Masuk & Pembayaran Diterima ---
    doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(11);
    doc.text("Ringkasan Operasional & Pembayaran", kiri, y, { width: lebarKonten });
    y += 16;

    const kolRing = {
      metrik: { x: kiri, w: 240 },
      tiket: { x: kiri + 240, w: 68 },
      pasang: { x: kiri + 308, w: 68 },
      nominal: { x: kiri + 376, w: lebarKonten - 376 },
    };

    // Header tabel ringkasan
    doc.save().fillColor(warnaLatarHeader).rect(kiri, y, lebarKonten, 20).fill().restore();
    doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(8.5);
    doc.text("Metrik", kolRing.metrik.x + 6, y + 6, { width: kolRing.metrik.w - 8 });
    doc.text("Tiket", kolRing.tiket.x + 4, y + 6, { width: kolRing.tiket.w - 8, align: "right" });
    doc.text("Pasang", kolRing.pasang.x + 4, y + 6, { width: kolRing.pasang.w - 8, align: "right" });
    doc.text("Nominal", kolRing.nominal.x + 4, y + 6, { width: kolRing.nominal.w - 8, align: "right" });
    y += 20;

    for (const r of model.ringkasan) {
      const teksMetrik = sanitasiTeksPdf(r.label);
      doc.font("Helvetica").fontSize(8.5);
      const hMetrik = doc.heightOfString(teksMetrik, { width: kolRing.metrik.w - 10 });
      const tinggiBaris = Math.max(20, Math.ceil(hMetrik) + 8);

      pastikanRuang(tinggiBaris);

      const adalahUtama = r.label.startsWith("Total ");
      doc.fillColor(warnaTeksUtama).font(adalahUtama ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      doc.text(teksMetrik, kolRing.metrik.x + 6, y + 4, { width: kolRing.metrik.w - 10 });
      doc.text(r.tiket !== null ? `${r.tiket}` : "-", kolRing.tiket.x + 4, y + 4, {
        width: kolRing.tiket.w - 8,
        align: "right",
      });
      doc.text(r.pasang !== null ? `${r.pasang}` : "-", kolRing.pasang.x + 4, y + 4, {
        width: kolRing.pasang.w - 8,
        align: "right",
      });
      doc.text(
        r.nominal !== null ? sanitasiTeksPdf(formatRupiah(r.nominal)) : "-",
        kolRing.nominal.x + 4,
        y + 4,
        { width: kolRing.nominal.w - 8, align: "right" }
      );

      y += tinggiBaris;
      gambarGarisHorizontal(y);
    }

    y += 10;

    // Kartu Laba Rugi (FR-52)
    const teksPesanLaba = sanitasiTeksPdf(model.labaRugi.pesan);
    doc.font("Helvetica").fontSize(8.5);
    const tinggiLaba = Math.max(
      34,
      18 + Math.ceil(doc.heightOfString(teksPesanLaba, { width: lebarKonten - 16 })) + 8
    );
    pastikanRuang(tinggiLaba);
    doc.save().fillColor(warnaLatarHeader).rect(kiri, y, lebarKonten, tinggiLaba).fill().restore();
    doc.fillColor(warnaTeksUtama).font("Helvetica-Bold").fontSize(8.5);
    doc.text(sanitasiTeksPdf(model.labaRugi.label), kiri + 8, y + 6, { width: lebarKonten - 16 });
    doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(8.5);
    doc.text(teksPesanLaba, kiri + 8, y + 18, { width: lebarKonten - 16 });
    y += tinggiLaba + 14;

    // --- Bagian 2: Layanan Terlaris ---
    const kolLay = {
      peringkat: { x: kiri, w: 50 },
      nama: { x: kiri + 50, w: 222 },
      pasang: { x: kiri + 272, w: 68 },
      persen: { x: kiri + 340, w: 62 },
      nominal: { x: kiri + 402, w: lebarKonten - 402 },
    };

    const gambarHeaderTabelLayanan = () => {
      doc.save().fillColor(warnaLatarHeader).rect(kiri, y, lebarKonten, 22).fill().restore();
      doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(8.5);
      doc.text("No", kolLay.peringkat.x + 6, y + 7, { width: kolLay.peringkat.w - 8 });
      doc.text("Nama Layanan", kolLay.nama.x + 6, y + 7, { width: kolLay.nama.w - 8 });
      doc.text("Pasang", kolLay.pasang.x + 4, y + 7, { width: kolLay.pasang.w - 8, align: "right" });
      doc.text("Porsi", kolLay.persen.x + 4, y + 7, { width: kolLay.persen.w - 8, align: "right" });
      doc.text("Nominal", kolLay.nominal.x + 4, y + 7, {
        width: kolLay.nominal.w - 8,
        align: "right",
      });
      y += 22;
    };

    pastikanRuang(54);
    doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(11);
    doc.text(
      `Layanan Terlaris (${model.layanan.jumlahLayananUnik} layanan unik)`,
      kiri,
      y,
      { width: lebarKonten }
    );
    y += 16;

    gambarHeaderTabelLayanan();

    if (model.layanan.kosong) {
      pastikanRuang(28, gambarHeaderTabelLayanan);
      doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(9);
      doc.text("Belum ada layanan pada rentang tanggal ini.", kiri + 6, y + 8, {
        width: lebarKonten - 12,
      });
      y += 26;
      gambarGarisHorizontal(y);
    } else {
      for (const bar of model.layanan.daftar) {
        const namaAman = potongNamaPdf(bar.nama);
        doc.font("Helvetica").fontSize(8.5);
        const tinggiNama = doc.heightOfString(namaAman, { width: kolLay.nama.w - 10 });
        const tinggiBaris = Math.max(22, Math.ceil(tinggiNama) + 8);

        pastikanRuang(tinggiBaris, gambarHeaderTabelLayanan);

        doc
          .fillColor(bar.adalahLainnya ? warnaPrimer : warnaTeksUtama)
          .font(bar.adalahLainnya ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.5);
        doc.text(sanitasiTeksPdf(bar.peringkat), kolLay.peringkat.x + 6, y + 5, {
          width: kolLay.peringkat.w - 8,
        });
        doc.fillColor(warnaTeksUtama).font(bar.adalahLainnya ? "Helvetica-Bold" : "Helvetica");
        doc.text(namaAman, kolLay.nama.x + 6, y + 5, { width: kolLay.nama.w - 10 });
        doc.text(`${bar.jumlahPasang}`, kolLay.pasang.x + 4, y + 5, {
          width: kolLay.pasang.w - 8,
          align: "right",
        });
        doc.text(formatPersenTeks(bar.persentasePasang), kolLay.persen.x + 4, y + 5, {
          width: kolLay.persen.w - 8,
          align: "right",
        });
        doc.text(sanitasiTeksPdf(formatRupiah(bar.totalNominal)), kolLay.nominal.x + 4, y + 5, {
          width: kolLay.nominal.w - 8,
          align: "right",
        });

        y += tinggiBaris;
        gambarGarisHorizontal(y);
      }
    }

    // Baris total layanan
    pastikanRuang(24, gambarHeaderTabelLayanan);
    doc.save().fillColor(warnaLatarHeader).rect(kiri, y, lebarKonten, 22).fill().restore();
    doc.fillColor(warnaPrimer).font("Helvetica-Bold").fontSize(8.5);
    doc.text("Total", kolLay.peringkat.x + 6, y + 7, { width: kolLay.peringkat.w - 8 });
    doc.text("Seluruh Layanan", kolLay.nama.x + 6, y + 7, { width: kolLay.nama.w - 10 });
    doc.text(`${model.layanan.totalPasang}`, kolLay.pasang.x + 4, y + 7, {
      width: kolLay.pasang.w - 8,
      align: "right",
    });
    doc.text("-", kolLay.persen.x + 4, y + 7, {
      width: kolLay.persen.w - 8,
      align: "right",
    });
    doc.text(
      sanitasiTeksPdf(formatRupiah(model.layanan.totalNominal)),
      kolLay.nominal.x + 4,
      y + 7,
      { width: kolLay.nominal.w - 8, align: "right" }
    );
    y += 30;

    // --- Catatan Pembulatan, Definisi, & Disclaimer ---
    const catatanBlok = [
      `Pembulatan: ${sanitasiTeksPdf(model.catatanPembulatan)}`,
      `Definisi Angka: ${sanitasiTeksPdf(model.catatanDefinisi)}`,
      `Peringatan: ${sanitasiTeksPdf(model.disclaimer)}`,
    ];

    doc.font("Helvetica").fontSize(8);
    for (const teksCatatan of catatanBlok) {
      const h = Math.ceil(doc.heightOfString(teksCatatan, { width: lebarKonten })) + 4;
      pastikanRuang(h);
      doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(8);
      doc.text(teksCatatan, kiri, y, { width: lebarKonten });
      y += h;
    }

    // Nomor halaman di footer setiap halaman
    const jangkauan = doc.bufferedPageRange();
    for (let i = 0; i < jangkauan.count; i++) {
      doc.switchToPage(jangkauan.start + i);
      const posisiFooterY = doc.page.height - 34;
      doc.fillColor(warnaTeksRedup).font("Helvetica").fontSize(8);
      doc.text("Solemate Shoes Clean - Rekap Bulanan", kiri, posisiFooterY, {
        width: lebarKonten / 2,
        lineBreak: false,
      });
      doc.text(`Halaman ${i + 1} dari ${jangkauan.count}`, kiri + lebarKonten / 2, posisiFooterY, {
        width: lebarKonten / 2,
        align: "right",
        lineBreak: false,
      });
    }

    doc.end();
  });
}

export type ParameterAuditEkspor = {
  userId: number;
  format: FormatEksporRekap;
  dari: string;
  sampai: string;
};

/**
 * Mencatat audit EKSPOR_REKAP ke audit_logs tanpa isi laporan ataupun data pribadi pelanggan.
 */
export async function catatAuditEksporRekap(
  pool: Pool | PoolClient,
  params: ParameterAuditEkspor
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_baru, user_id)
     VALUES ('rekap_bulanan', 0, 'EKSPOR_REKAP', $1, $2)`,
    [
      JSON.stringify({
        format: params.format,
        dari: params.dari,
        sampai: params.sampai,
      }),
      params.userId,
    ]
  );
}

/**
 * Orkestrasi ekspor Rekap Bulanan dengan perilaku audit fail-closed:
 * apabila pencatatan audit_logs gagal, file ekspor tidak dikirimkan.
 */
export async function eksporRekapDenganAudit(opsi: {
  filter: FilterRekapBulanan;
  format: FormatEksporRekap;
  userId: number;
  poolClient?: Pool | PoolClient;
  tanggalAcuanWib?: string;
  auditLogger?: (params: ParameterAuditEkspor) => Promise<void>;
}): Promise<{ buffer: Buffer; model: ModelDokumenRekap; rekap: DataRekapBulanan }> {
  const pool = opsi.poolClient ?? getPool();
  const rekap = await ambilRekapBulanan(opsi.filter, pool, opsi.tanggalAcuanWib);
  const dibuatPadaWib = await ambilJamBuatDbWib(pool);
  const model = bangunModelDokumenRekap(rekap, dibuatPadaWib);

  const buffer =
    opsi.format === "xlsx" ? await renderRekapExcel(model) : await renderRekapPdf(model);

  const logAudit = opsi.auditLogger ?? ((params) => catatAuditEksporRekap(pool, params));
  await logAudit({
    userId: opsi.userId,
    format: opsi.format,
    dari: rekap.rentang.dari,
    sampai: rekap.rentang.sampai,
  });

  return { buffer, model, rekap };
}
