// Perhitungan geometri murni untuk grafik batang tren 7 hari (Dashboard Owner, Phase 7A/7B).
// Menjamin seluruh batang, label nilai di atas batang tertinggi, dan label tanggal bawah
// selalu berada di dalam viewBox (tidak terpotong) dan tidak saling menimpa pada layar sempit.

export type TitikTrenMasukan = {
  tanggal: string;
  jumlah_pasang: number;
};

export type ModeGrafikTren = "desktop" | "ponsel";

export type BatangGrafikTren = {
  tanggal: string;
  jumlahPasang: number;
  adalahHariIni: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  labelNilai: {
    x: number;
    y: number;
    text: string;
    perkiraanLebar: number;
    perkiraanAtas: number;
  };
  labelTanggal: {
    x: number;
    y: number;
    text: string;
    perkiraanLebar: number;
    xKiri: number;
    xKanan: number;
  };
};

export type GeometriGrafikTren = {
  mode: ModeGrafikTren;
  viewBoxWidth: number;
  viewBoxHeight: number;
  viewBox: string;
  paddingAtas: number;
  baselineY: number;
  yLabelHariIni: number;
  maksNilai: number;
  gridLinesY: number[];
  bars: BatangGrafikTren[];
};

const KONFIG_MODE = {
  desktop: {
    viewBoxWidth: 700,
    viewBoxHeight: 230,
    paddingAtas: 42,
    baselineY: 174,
    paddingKiri: 30,
    paddingKanan: 20,
    lebarBatangMaks: 44,
    yLabelTanggal: 196,
    yLabelHariIni: 214,
    jarakLabelNilai: 10,
    tinggiTeksNilai: 14,
    lebarKarakterNilai: 7.2,
    lebarKarakterTanggal: 6.2,
  },
  ponsel: {
    viewBoxWidth: 360,
    viewBoxHeight: 220,
    paddingAtas: 42,
    baselineY: 168,
    paddingKiri: 8,
    paddingKanan: 8,
    lebarBatangMaks: 28,
    yLabelTanggal: 188,
    yLabelHariIni: 206,
    jarakLabelNilai: 9,
    tinggiTeksNilai: 12,
    lebarKarakterNilai: 5.8,
    lebarKarakterTanggal: 5.2,
  },
} as const;

const BULAN_PENDEK_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/**
 * Memformat tanggal YYYY-MM-DD ke label tanggal grafik dalam Bahasa Indonesia (WIB).
 * Mode "ponsel" menghasilkan format pendek tanpa tahun ("6 Nov") agar tidak saling menimpa.
 */
export function formatTanggalGrafik(tanggal: string, mode: ModeGrafikTren): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tanggal.trim());
  if (m) {
    const tahun = Number(m[1]);
    const bulanIdx = Number(m[2]) - 1;
    const hari = Number(m[3]);
    const namaBulan = BULAN_PENDEK_ID[bulanIdx];
    if (namaBulan && hari >= 1 && hari <= 31) {
      return mode === "ponsel" ? `${hari} ${namaBulan}` : `${hari} ${namaBulan} ${tahun}`;
    }
  }

  const d = new Date(tanggal);
  if (isNaN(d.getTime())) return tanggal;
  const opsi: Intl.DateTimeFormatOptions =
    mode === "ponsel"
      ? { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }
      : { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("id-ID", opsi).format(d);
}

/**
 * Fungsi murni menghitung posisi batang dan label grafik tren 7 hari.
 * Menjamin seluruh koordinat berada di dalam viewBox, bebas pembagian nol,
 * tinggi batang tidak negatif, dan label tanggal ponsel tidak bertumpuk.
 */
export function hitungGeometriGrafikTren(
  titik: readonly TitikTrenMasukan[],
  opsi?: { mode?: ModeGrafikTren }
): GeometriGrafikTren {
  const mode: ModeGrafikTren = opsi?.mode ?? "desktop";
  const cfg = KONFIG_MODE[mode];

  const areaBatang = cfg.baselineY - cfg.paddingAtas;
  const nilaiBersih = titik.map((t) =>
    Number.isFinite(t.jumlah_pasang) && t.jumlah_pasang > 0 ? Math.round(t.jumlah_pasang) : 0
  );
  const maksNilai = nilaiBersih.length > 0 ? Math.max(0, ...nilaiBersih) : 0;

  const jumlah = Math.max(1, titik.length);
  const areaLebar = cfg.viewBoxWidth - cfg.paddingKiri - cfg.paddingKanan;
  const slotLebar = areaLebar / jumlah;
  const lebarBatang = Math.min(cfg.lebarBatangMaks, Math.max(12, Math.floor(slotLebar * 0.65)));

  const gridLinesY = [
    cfg.paddingAtas,
    Math.round((cfg.paddingAtas + cfg.baselineY) / 2),
    cfg.baselineY,
  ];

  const bars: BatangGrafikTren[] = titik.map((t, idx) => {
    const jumlahPasang = nilaiBersih[idx];
    const centerX = Math.round((cfg.paddingKiri + (idx + 0.5) * slotLebar) * 10) / 10;
    const x = Math.round((centerX - lebarBatang / 2) * 10) / 10;

    let height = 3; // penanda visual minimal untuk hari kosong (0 pasang)
    if (jumlahPasang > 0 && maksNilai > 0) {
      const rasio = jumlahPasang / maksNilai;
      height = Math.min(areaBatang, Math.max(8, Math.round(rasio * areaBatang)));
    }
    const y = cfg.baselineY - height;

    const teksNilai = jumlahPasang > 0 ? `${jumlahPasang} psg` : "0";
    const perkiraanLebarNilai = Math.round(teksNilai.length * cfg.lebarKarakterNilai * 10) / 10;
    const labelNilaiY = y - cfg.jarakLabelNilai;
    const perkiraanAtasNilai = labelNilaiY - cfg.tinggiTeksNilai;

    const teksTanggal = formatTanggalGrafik(t.tanggal, mode);
    const perkiraanLebarTanggal = Math.round(teksTanggal.length * cfg.lebarKarakterTanggal * 10) / 10;
    const setengahTanggal = perkiraanLebarTanggal / 2;

    return {
      tanggal: t.tanggal,
      jumlahPasang,
      adalahHariIni: idx === titik.length - 1,
      x,
      y,
      width: lebarBatang,
      height,
      labelNilai: {
        x: centerX,
        y: labelNilaiY,
        text: teksNilai,
        perkiraanLebar: perkiraanLebarNilai,
        perkiraanAtas: perkiraanAtasNilai,
      },
      labelTanggal: {
        x: centerX,
        y: cfg.yLabelTanggal,
        text: teksTanggal,
        perkiraanLebar: perkiraanLebarTanggal,
        xKiri: Math.round((centerX - setengahTanggal) * 10) / 10,
        xKanan: Math.round((centerX + setengahTanggal) * 10) / 10,
      },
    };
  });

  return {
    mode,
    viewBoxWidth: cfg.viewBoxWidth,
    viewBoxHeight: cfg.viewBoxHeight,
    viewBox: `0 0 ${cfg.viewBoxWidth} ${cfg.viewBoxHeight}`,
    paddingAtas: cfg.paddingAtas,
    baselineY: cfg.baselineY,
    yLabelHariIni: cfg.yLabelHariIni,
    maksNilai,
    gridLinesY,
    bars,
  };
}
