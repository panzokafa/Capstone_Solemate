"use client";

// Antarmuka Buat Tiket Baru khusus Kasir (Phase 5A).
// Seluruh teks pengguna dirender sebagai teks biasa (React auto-escape).
// Perkiraan total di layar hanya bantuan visual; server menghitung ulang total resmi saat menyimpan.

import * as React from "react";
import Link from "next/link";
import type { LayananPublik } from "@/lib/katalog";
import type { DetailTiket, InfoPelangganTiket, PeringatanNamaPelanggan } from "@/lib/tiket";
import {
  BATAS_TOTAL_TIKET,
  MAKS_DESKRIPSI_BARANG,
  MAKS_ITEM_PER_TIKET,
  MAKS_JUMLAH_PASANG,
  MAKS_NAMA_PELANGGAN,
  MIN_JUMLAH_PASANG,
  OFFSET_WIB,
  hitungEstimasiSelesaiDefault,
} from "@/config/tiket";
import type { MetodeBayar, StatusBayar } from "@/config/order-status";
import { normalisasiNomorWa, buatUrlWaMe, buatPesanWaTiket } from "@/lib/nomor-wa";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { Ikon } from "@/components/ikon";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";

type BarisBarangForm = {
  uid: number;
  serviceId: string;
  deskripsiBarang: string;
  jumlah: string;
};

type PetaGalatField = Record<string, string>;

function formatDatetimeLocalWib(tgl: Date): string {
  const bagian = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(tgl);

  const ambil = (tipe: string) => bagian.find((b) => b.type === tipe)?.value ?? "00";
  const jam = ambil("hour") === "24" ? "00" : ambil("hour");
  return `${ambil("year")}-${ambil("month")}-${ambil("day")}T${jam}:${ambil("minute")}`;
}

function uraiInputDatetimeWib(nilai: string): Date | null {
  const bersih = nilai.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(bersih)) return null;
  const d = new Date(`${bersih}:00${OFFSET_WIB}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function petakanGalatServerKeField(pesan: string): PetaGalatField {
  const peta: PetaGalatField = {};
  const barisMatch = pesan.match(/^Baris barang ke-(\d+):\s*(.+)$/i);
  if (barisMatch) {
    const idx = Number(barisMatch[1]) - 1;
    const detail = barisMatch[2];
    if (/service_id|layanan/i.test(detail)) {
      peta[`item_${idx}_service`] = detail;
    } else if (/deskripsi/i.test(detail)) {
      peta[`item_${idx}_deskripsi`] = detail;
    } else if (/jumlah/i.test(detail)) {
      peta[`item_${idx}_jumlah`] = detail;
    }
    return peta;
  }

  if (/nomor whatsapp/i.test(pesan)) {
    peta.nomor_wa = pesan;
  } else if (/nama pelanggan/i.test(pesan)) {
    peta.nama_pelanggan = pesan;
  } else if (/tanggal masuk/i.test(pesan)) {
    peta.tanggal_masuk = pesan;
  } else if (/estimasi selesai/i.test(pesan)) {
    peta.estimasi_selesai = pesan;
  } else if (/metode pembayaran/i.test(pesan)) {
    peta.metode_bayar = pesan;
  } else if (/status pembayaran/i.test(pesan)) {
    peta.status_bayar = pesan;
  } else if (/layanan.*tidak ditemukan|layanan.*nonaktif/i.test(pesan)) {
    peta.item_0_service = pesan;
  }
  return peta;
}

export interface BuatTiketClientProps {
  layananAwal: LayananPublik[];
  waktuMasukAwalWib: string;
}

export function BuatTiketClient({
  layananAwal,
  waktuMasukAwalWib,
}: BuatTiketClientProps) {
  const counterUidRef = React.useRef(2);
  const sedangKirimRef = React.useRef(false);

  const [daftarLayanan, setDaftarLayanan] = React.useState<LayananPublik[]>(layananAwal);
  const [memuatLayanan, setMemuatLayanan] = React.useState(false);

  const layananPertamaId = daftarLayanan[0] ? String(daftarLayanan[0].id) : "";

  const [nomorWa, setNomorWa] = React.useState("");
  const [namaPelanggan, setNamaPelanggan] = React.useState("");
  const [sedangCekWa, setSedangCekWa] = React.useState(false);
  const [infoCekWa, setInfoCekWa] = React.useState<string | null>(null);
  const [pelangganTerdaftar, setPelangganTerdaftar] =
    React.useState<InfoPelangganTiket | null>(null);
  const [konfirmasiUbahNama, setKonfirmasiUbahNama] = React.useState(false);

  const [items, setItems] = React.useState<BarisBarangForm[]>([
    {
      uid: 1,
      serviceId: layananPertamaId,
      deskripsiBarang: "",
      jumlah: "1",
    },
  ]);

  const [tanggalMasukWib, setTanggalMasukWib] = React.useState(waktuMasukAwalWib);
  // Bila null, estimasi selesai diturunkan otomatis dari tanggalMasukWib + durasi layanan terlama.
  const [estimasiManualWib, setEstimasiManualWib] = React.useState<string | null>(null);

  const [statusBayar, setStatusBayar] = React.useState<StatusBayar>("Belum bayar");
  const [metodeBayar, setMetodeBayar] = React.useState<MetodeBayar>("Cash");

  const [galatField, setGalatField] = React.useState<PetaGalatField>({});
  const [galatUmum, setGalatUmum] = React.useState<string | null>(null);
  const [menyimpan, setMenyimpan] = React.useState(false);

  const [hasilSukses, setHasilSukses] = React.useState<{
    tiket: DetailTiket;
    peringatan: PeringatanNamaPelanggan | null;
  } | null>(null);

  const petaLayanan = React.useMemo(() => {
    const m = new Map<number, LayananPublik>();
    for (const l of daftarLayanan) {
      m.set(l.id, l);
    }
    return m;
  }, [daftarLayanan]);

  const muatDariEndpointAktif = React.useCallback(async () => {
    const res = await fetch("/api/katalog/aktif");
    const json = await res.json().catch(() => null);
    if (res.ok && Array.isArray(json?.data)) {
      return json.data as LayananPublik[];
    }
    return null;
  }, []);

  const segarkanLayananAktif = React.useCallback(async () => {
    setMemuatLayanan(true);
    try {
      const baru = await muatDariEndpointAktif();
      if (baru) {
        setDaftarLayanan(baru);
        setItems((lama) =>
          lama.map((b) =>
            !b.serviceId && baru[0] ? { ...b, serviceId: String(baru[0].id) } : b
          )
        );
      }
    } catch {
      // Gunakan layananAwal dari SSR bila jaringan sempat terputus.
    } finally {
      setMemuatLayanan(false);
    }
  }, [muatDariEndpointAktif]);

  React.useEffect(() => {
    let dibatalkan = false;
    (async () => {
      try {
        const baru = await muatDariEndpointAktif();
        if (!dibatalkan && baru) {
          setDaftarLayanan(baru);
          setItems((lama) =>
            lama.map((b) =>
              !b.serviceId && baru[0] ? { ...b, serviceId: String(baru[0].id) } : b
            )
          );
        }
      } catch {
        // Gunakan layananAwal dari SSR bila jaringan sempat terputus.
      }
    })();
    return () => {
      dibatalkan = true;
    };
  }, [muatDariEndpointAktif]);

  const estimasiOtomatisWib = React.useMemo(() => {
    const tglMasuk = uraiInputDatetimeWib(tanggalMasukWib);
    if (!tglMasuk) return "";
    const daftarHari: number[] = [];
    for (const b of items) {
      const l = petaLayanan.get(Number(b.serviceId));
      if (l) daftarHari.push(l.estimasi_hari);
    }
    return formatDatetimeLocalWib(hitungEstimasiSelesaiDefault(tglMasuk, daftarHari));
  }, [tanggalMasukWib, items, petaLayanan]);

  const estimasiManual = estimasiManualWib !== null;
  const estimasiSelesaiWib = estimasiManualWib ?? estimasiOtomatisWib;

  const namaTrim = namaPelanggan.trim();
  const namaBerbedaDenganTerdaftar =
    pelangganTerdaftar !== null &&
    namaTrim.length > 0 &&
    namaTrim !== pelangganTerdaftar.nama;

  async function cekNomorPelanggan() {
    const hasilNorm = normalisasiNomorWa(nomorWa);
    if (!hasilNorm.ok) {
      setGalatField((lama) => ({ ...lama, nomor_wa: hasilNorm.galat }));
      setPelangganTerdaftar(null);
      setInfoCekWa(null);
      return;
    }

    setGalatField((lama) => {
      const salin = { ...lama };
      delete salin.nomor_wa;
      return salin;
    });
    setSedangCekWa(true);
    setInfoCekWa(null);

    try {
      const res = await fetch("/api/pelanggan/cek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomor_wa: nomorWa }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setGalatField((lama) => ({
          ...lama,
          nomor_wa: json?.error ?? "Gagal memeriksa nomor WhatsApp pelanggan.",
        }));
        return;
      }

      if (json?.ditemukan && json?.data) {
        const ditemukan = json.data as InfoPelangganTiket;
        setPelangganTerdaftar(ditemukan);
        setKonfirmasiUbahNama(false);
        if (namaPelanggan.trim().length === 0) {
          setNamaPelanggan(ditemukan.nama);
        }
        setInfoCekWa(`Pelanggan terdaftar ditemukan atas nama "${ditemukan.nama}".`);
      } else {
        setPelangganTerdaftar(null);
        setKonfirmasiUbahNama(false);
        setInfoCekWa("Nomor belum terdaftar. Data pelanggan baru akan dibuat otomatis.");
      }
    } catch {
      setGalatField((lama) => ({
        ...lama,
        nomor_wa: "Tidak dapat memeriksa nomor pelanggan ke server.",
      }));
    } finally {
      setSedangCekWa(false);
    }
  }

  function tambahBaris() {
    if (items.length >= MAKS_ITEM_PER_TIKET) return;
    const uidBaru = counterUidRef.current++;
    setItems((lama) => [
      ...lama,
      {
        uid: uidBaru,
        serviceId: daftarLayanan[0] ? String(daftarLayanan[0].id) : "",
        deskripsiBarang: "",
        jumlah: "1",
      },
    ]);
  }

  function hapusBaris(uid: number) {
    if (items.length <= 1) return;
    setItems((lama) => lama.filter((b) => b.uid !== uid));
  }

  function ubahBaris(uid: number, perubahan: Partial<BarisBarangForm>) {
    setItems((lama) =>
      lama.map((b) => (b.uid === uid ? { ...b, ...perubahan } : b))
    );
  }

  // Hitung perkiraan ringkasan di layar (hanya indikasi visual; server menghitung ulang).
  const ringkasanPerkiraan = React.useMemo(() => {
    const rincian = items.map((b) => {
      const layanan = petaLayanan.get(Number(b.serviceId)) ?? null;
      const jml = /^\d+$/.test(b.jumlah.trim()) ? Number(b.jumlah.trim()) : 0;
      const subtotal = layanan && jml > 0 ? layanan.harga * jml : 0;
      return {
        uid: b.uid,
        namaLayanan: layanan?.nama ?? "Belum dipilih",
        hargaSatuan: layanan?.harga ?? 0,
        deskripsi: b.deskripsiBarang.trim(),
        jumlah: jml,
        subtotal,
      };
    });
    const totalPasang = rincian.reduce((akum, r) => akum + r.jumlah, 0);
    const totalHarga = rincian.reduce((akum, r) => akum + r.subtotal, 0);
    return { totalPasang, totalHarga, rincian };
  }, [items, petaLayanan]);

  function resetFormBaru() {
    const sekarangStr = formatDatetimeLocalWib(new Date());

    setNomorWa("");
    setNamaPelanggan("");
    setPelangganTerdaftar(null);
    setKonfirmasiUbahNama(false);
    setInfoCekWa(null);
    setItems([
      {
        uid: counterUidRef.current++,
        serviceId: daftarLayanan[0] ? String(daftarLayanan[0].id) : "",
        deskripsiBarang: "",
        jumlah: "1",
      },
    ]);
    setTanggalMasukWib(sekarangStr);
    setEstimasiManualWib(null);
    setStatusBayar("Belum bayar");
    setMetodeBayar("Cash");
    setGalatField({});
    setGalatUmum(null);
    setHasilSukses(null);
  }

  async function kirimTiket(e: React.FormEvent) {
    e.preventDefault();
    if (sedangKirimRef.current || menyimpan) return;

    const galatBaru: PetaGalatField = {};
    const cekWa = normalisasiNomorWa(nomorWa);
    if (!cekWa.ok) {
      galatBaru.nomor_wa = cekWa.galat;
    }

    if (namaPelanggan.trim().length === 0) {
      galatBaru.nama_pelanggan = "Nama pelanggan wajib diisi.";
    } else if (namaPelanggan.trim().length > MAKS_NAMA_PELANGGAN) {
      galatBaru.nama_pelanggan = `Nama pelanggan maksimal ${MAKS_NAMA_PELANGGAN} karakter.`;
    }

    const payloadItems: {
      service_id: number;
      deskripsi_barang: string;
      jumlah: number;
    }[] = [];

    items.forEach((b, idx) => {
      const sid = Number(b.serviceId);
      if (!b.serviceId || !Number.isInteger(sid) || sid < 1) {
        galatBaru[`item_${idx}_service`] = "Pilih layanan aktif dari katalog.";
      }
      const desk = b.deskripsiBarang.trim();
      if (desk.length === 0) {
        galatBaru[`item_${idx}_deskripsi`] = "Deskripsi sepatu atau barang wajib diisi.";
      } else if (desk.length > MAKS_DESKRIPSI_BARANG) {
        galatBaru[`item_${idx}_deskripsi`] = `Deskripsi maksimal ${MAKS_DESKRIPSI_BARANG} karakter.`;
      }
      if (!/^\d+$/.test(b.jumlah.trim())) {
        galatBaru[`item_${idx}_jumlah`] = "Jumlah pasang harus berupa bilangan bulat.";
      } else {
        const jml = Number(b.jumlah.trim());
        if (jml < MIN_JUMLAH_PASANG || jml > MAKS_JUMLAH_PASANG) {
          galatBaru[`item_${idx}_jumlah`] = `Jumlah pasang antara ${MIN_JUMLAH_PASANG} sampai ${MAKS_JUMLAH_PASANG}.`;
        } else {
          payloadItems.push({
            service_id: sid,
            deskripsi_barang: desk,
            jumlah: jml,
          });
        }
      }
    });

    const tglMasukDate = uraiInputDatetimeWib(tanggalMasukWib);
    if (!tglMasukDate) {
      galatBaru.tanggal_masuk = "Tanggal dan jam masuk wajib diisi dengan benar.";
    }

    let tglEstimasiDate: Date | null = null;
    if (estimasiSelesaiWib.trim().length > 0) {
      tglEstimasiDate = uraiInputDatetimeWib(estimasiSelesaiWib);
      if (!tglEstimasiDate) {
        galatBaru.estimasi_selesai = "Format estimasi selesai tidak valid.";
      } else if (tglMasukDate && tglEstimasiDate.getTime() < tglMasukDate.getTime()) {
        galatBaru.estimasi_selesai =
          "Estimasi selesai tidak boleh lebih awal dari tanggal masuk.";
      }
    }

    if (Object.keys(galatBaru).length > 0) {
      setGalatField(galatBaru);
      setGalatUmum("Periksa kembali kolom yang ditandai merah sebelum menyimpan tiket.");
      return;
    }

    sedangKirimRef.current = true;
    setMenyimpan(true);
    setGalatField({});
    setGalatUmum(null);

    try {
      const muatan = {
        nama_pelanggan: namaPelanggan.trim(),
        nomor_wa: nomorWa.trim(),
        konfirmasi_ubah_nama: namaBerbedaDenganTerdaftar ? konfirmasiUbahNama : false,
        items: payloadItems,
        tanggal_masuk: tglMasukDate!.toISOString(),
        estimasi_selesai: tglEstimasiDate ? tglEstimasiDate.toISOString() : null,
        status_bayar: statusBayar,
        metode_bayar: statusBayar === "Lunas" ? metodeBayar : null,
      };

      const res = await fetch("/api/tiket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(muatan),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const pesanServer: string =
          typeof json?.error === "string"
            ? json.error
            : "Gagal membuat tiket. Silakan periksa kembali data pesanan.";
        setGalatField(petakanGalatServerKeField(pesanServer));
        setGalatUmum(pesanServer);
        return;
      }

      setHasilSukses({
        tiket: json.data as DetailTiket,
        peringatan: (json.peringatan as PeringatanNamaPelanggan | null) ?? null,
      });
    } catch {
      setGalatUmum("Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.");
    } finally {
      sedangKirimRef.current = false;
      setMenyimpan(false);
    }
  }

  // Tampilan sukses setelah tiket berhasil disimpan di server
  if (hasilSukses) {
    const { tiket, peringatan } = hasilSukses;
    const urlWa = buatUrlWaMe(
      tiket.pelanggan.nomor_wa,
      buatPesanWaTiket({
        kodeTiket: tiket.kode_tiket,
        namaPelanggan: tiket.pelanggan.nama,
        statusPesanan: tiket.status_pesanan,
        statusBayar: tiket.status_bayar,
        totalRupiah: formatRupiah(tiket.total),
      })
    );

    return (
      <div className="flex flex-col gap-6 max-w-3xl mx-auto">
        <PageHeader
          title="Tiket Berhasil Dibuat"
          description="Data pesanan, rincian harga katalog, dan log audit telah tersimpan."
        />

        {peringatan && (
          <div
            role="status"
            className="rounded-2xl border border-status-siap-diambil-border bg-status-siap-diambil-bg px-5 py-4 font-jakarta text-sm text-status-siap-diambil-text flex items-start gap-3"
          >
            <Ikon
              name="alert_triangle"
              size={20}
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p>{peringatan.pesan}</p>
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-status-sudah-diambil-bg text-status-sudah-diambil-text">
                  <Ikon name="check_circle" size={24} className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-jakarta text-xs uppercase tracking-wider text-text-muted">
                    Kode Tiket Resmi
                  </p>
                  <CardTitle as="h2" className="text-2xl">
                    {tiket.kode_tiket}
                  </CardTitle>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="pesanan" statusPesanan={tiket.status_pesanan} />
                <Badge variant="bayar" statusBayar={tiket.status_bayar} />
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl bg-surface-subtle p-4 font-jakarta text-sm">
              <div>
                <p className="text-xs text-text-muted">Pelanggan</p>
                <p className="font-semibold text-text-main break-words">{tiket.pelanggan.nama}</p>
                <p className="text-text-body">{tiket.pelanggan.nomor_wa}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Jadwal (WIB)</p>
                <p className="text-text-body">
                  Masuk: {formatTanggal(tiket.tanggal_masuk, { denganWaktu: true })}
                </p>
                <p className="text-text-body">
                  Estimasi: {formatTanggal(tiket.estimasi_selesai, { denganWaktu: true })}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-outfit text-sm font-bold uppercase tracking-wider text-text-muted">
                Rincian Barang & Harga Resmi Server
              </h3>
              <ul className="divide-y divide-border-warm rounded-2xl border border-border-card bg-surface-canvas px-4">
                {tiket.items.map((it) => (
                  <li
                    key={it.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 font-jakarta text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-text-main break-words">
                        {it.deskripsi_barang}
                      </p>
                      <p className="text-xs text-text-muted">
                        {it.nama_layanan} · {it.jumlah} pasang ×{" "}
                        {formatRupiah(it.harga_saat_transaksi)}
                      </p>
                    </div>
                    <span className="font-outfit font-bold text-text-main shrink-0">
                      {formatRupiah(it.subtotal)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between border-t border-border-warm pt-4">
              <div>
                <p className="font-jakarta text-xs text-text-muted">
                  Total Resmi ({tiket.jumlah_pasang} pasang sepatu)
                </p>
                {tiket.metode_bayar && (
                  <p className="font-jakarta text-xs text-text-muted">
                    Metode pembayaran: {tiket.metode_bayar}
                  </p>
                )}
              </div>
              <p className="font-outfit text-2xl font-extrabold text-text-main">
                {formatRupiah(tiket.total)}
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex-wrap">
            <Button variant="secondary" onClick={resetFormBaru}>
              Buat Tiket Lagi
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={urlWa}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-border-card bg-surface-subtle px-5 py-2.5 font-outfit text-sm font-semibold text-primary hover:bg-surface-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Ikon name="message_circle" size={18} className="h-4 w-4" aria-hidden="true" />
                Kirim via WhatsApp
              </a>
              <Link
                href={`/tiket/${tiket.id}`}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 font-outfit text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Lihat Detail Tiket
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const perkiraanMelebihiBatas = ringkasanPerkiraan.totalHarga > BATAS_TOTAL_TIKET;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Buat Tiket Baru"
        description="Catat pesanan cucian sepatu pelanggan di toko. Harga otomatis disalin dari katalog aktif."
        actions={
          <Link
            href="/tiket"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-border-card bg-surface-card px-4 py-2.5 font-outfit text-sm font-semibold text-primary hover:bg-surface-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Ikon name="arrow_left" size={16} className="h-4 w-4" aria-hidden="true" />
            Daftar Tiket
          </Link>
        }
      />

      {daftarLayanan.length === 0 ? (
        <EmptyState
          icon="style"
          title="Belum Ada Layanan Aktif"
          description="Katalog layanan aktif masih kosong sehingga tiket baru belum bisa dibuat. Hubungi Owner untuk mengaktifkan layanan di menu Katalog."
          action={
            <Button
              variant="secondary"
              loading={memuatLayanan}
              onClick={() => void segarkanLayananAktif()}
            >
              Muat Ulang Layanan
            </Button>
          }
        />
      ) : (
        <form
          onSubmit={kirimTiket}
          noValidate
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start"
        >
          {/* Kolom kiri (2 bagian): Data Pelanggan, Barang & Layanan, Jadwal, Status Pembayaran */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {galatUmum && (
              <div
                role="alert"
                className="rounded-2xl border border-danger bg-danger-light px-4 py-3 font-jakarta text-sm font-medium text-danger"
              >
                {galatUmum}
              </div>
            )}

            {/* 1. Data Pelanggan */}
            <Card>
              <CardHeader>
                <CardTitle as="h2">Data Pelanggan</CardTitle>
                <CardDescription>
                  Nomor WhatsApp wajib diisi untuk pengiriman informasi tiket dan pemberitahuan pesanan selesai.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <Input
                      label="Nomor WhatsApp"
                      required
                      inputMode="tel"
                      placeholder="Contoh: 081234567890"
                      value={nomorWa}
                      error={galatField.nomor_wa}
                      helperText="Format 08xxxxxxxxxx atau 628xxxxxxxxxx"
                      onChange={(e) => {
                        setNomorWa(e.target.value);
                        setPelangganTerdaftar(null);
                        setKonfirmasiUbahNama(false);
                        setInfoCekWa(null);
                      }}
                      onBlur={() => {
                        if (nomorWa.trim().length >= 10 && !pelangganTerdaftar && !sedangCekWa) {
                          void cekNomorPelanggan();
                        }
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    loading={sedangCekWa}
                    onClick={() => void cekNomorPelanggan()}
                    className="sm:mb-5 shrink-0"
                  >
                    Cek Nomor
                  </Button>
                </div>

                {infoCekWa && !galatField.nomor_wa && (
                  <p className="font-jakarta text-xs font-medium text-primary">
                    {infoCekWa}
                  </p>
                )}

                <Input
                  label="Nama Pelanggan"
                  required
                  maxLength={MAKS_NAMA_PELANGGAN}
                  placeholder="Nama pelanggan sesuai identitas atau panggilan"
                  value={namaPelanggan}
                  error={galatField.nama_pelanggan}
                  onChange={(e) => setNamaPelanggan(e.target.value)}
                />

                {namaBerbedaDenganTerdaftar && pelangganTerdaftar && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-status-siap-diambil-border bg-status-siap-diambil-bg p-4 flex flex-col gap-3 font-jakarta text-sm text-status-siap-diambil-text"
                  >
                    <div className="flex items-start gap-2.5">
                      <Ikon
                        name="alert_triangle"
                        size={18}
                        className="h-5 w-5 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-semibold">Nama berbeda dengan data pelanggan terdaftar</p>
                        <p className="mt-0.5 text-xs leading-relaxed">
                          Nomor ini sudah tercatat atas nama{" "}
                          <span className="font-bold">{pelangganTerdaftar.nama}</span>. Tanpa
                          konfirmasi pembaruan nama, tiket akan tetap memakai nama tersimpan.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                      <label className="flex min-h-[44px] items-center gap-2.5 cursor-pointer text-xs font-semibold">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-primary"
                          checked={konfirmasiUbahNama}
                          onChange={(e) => setKonfirmasiUbahNama(e.target.checked)}
                        />
                        <span>Perbarui nama pelanggan terdaftar menjadi &ldquo;{namaTrim}&rdquo;</span>
                      </label>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setNamaPelanggan(pelangganTerdaftar.nama);
                          setKonfirmasiUbahNama(false);
                        }}
                      >
                        Gunakan Nama Tersimpan
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 2. Barang & Layanan */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle as="h2">Barang & Layanan</CardTitle>
                    <CardDescription>
                      Tambahkan sepatu atau barang yang dicuci (maksimal {MAKS_ITEM_PER_TIKET} baris per tiket).
                    </CardDescription>
                  </div>
                  <Badge variant="primary">
                    {items.length} / {MAKS_ITEM_PER_TIKET} baris
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {items.map((baris, idx) => {
                  const layananTerpilih = petaLayanan.get(Number(baris.serviceId));
                  const jmlAngka = /^\d+$/.test(baris.jumlah.trim())
                    ? Number(baris.jumlah.trim())
                    : 0;
                  const subtotalBaris =
                    layananTerpilih && jmlAngka > 0 ? layananTerpilih.harga * jmlAngka : 0;

                  return (
                    <div
                      key={baris.uid}
                      className="rounded-2xl border border-border-card bg-surface-canvas p-4 flex flex-col gap-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-outfit text-sm font-bold text-text-main">
                          Barang ke-{idx + 1}
                        </span>
                        {items.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => hapusBaris(baris.uid)}
                            aria-label={`Hapus baris barang ke-${idx + 1}`}
                          >
                            <Ikon name="trash" size={16} className="h-4 w-4" aria-hidden="true" />
                            Hapus Baris
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <Select
                            label="Layanan Katalog Aktif"
                            required
                            value={baris.serviceId}
                            error={galatField[`item_${idx}_service`]}
                            options={daftarLayanan.map((l) => ({
                              value: String(l.id),
                              label: `${l.nama} — ${formatRupiah(l.harga)} (${l.estimasi_hari} hari)`,
                            }))}
                            onChange={(e) =>
                              ubahBaris(baris.uid, { serviceId: e.target.value })
                            }
                          />
                        </div>

                        <div>
                          <Input
                            label="Jumlah Pasang"
                            required
                            type="number"
                            inputMode="numeric"
                            min={MIN_JUMLAH_PASANG}
                            max={MAKS_JUMLAH_PASANG}
                            value={baris.jumlah}
                            error={galatField[`item_${idx}_jumlah`]}
                            helperText={`1–${MAKS_JUMLAH_PASANG} pasang`}
                            onChange={(e) =>
                              ubahBaris(baris.uid, { jumlah: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <Input
                        label="Deskripsi Barang / Sepatu"
                        required
                        maxLength={MAKS_DESKRIPSI_BARANG}
                        placeholder="Contoh: Sneakers putih kanvas ukuran 42, noda lumpur"
                        value={baris.deskripsiBarang}
                        error={galatField[`item_${idx}_deskripsi`]}
                        onChange={(e) =>
                          ubahBaris(baris.uid, { deskripsiBarang: e.target.value })
                        }
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-warm pt-2.5 font-jakarta text-xs text-text-muted">
                        <span>
                          Harga katalog:{" "}
                          <strong className="text-text-body">
                            {layananTerpilih ? formatRupiah(layananTerpilih.harga) : "-"}
                          </strong>{" "}
                          / pasang
                        </span>
                        <span>
                          Perkiraan subtotal:{" "}
                          <strong className="text-text-main">{formatRupiah(subtotalBaris)}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <Button
                    variant="secondary"
                    disabled={items.length >= MAKS_ITEM_PER_TIKET}
                    onClick={tambahBaris}
                  >
                    <Ikon name="add_circle" size={18} className="h-4 w-4" aria-hidden="true" />
                    Tambah Barang
                  </Button>
                  <p className="font-jakarta text-xs text-text-muted">
                    Harga pada tiket dikunci saat transaksi dan tidak berubah bila katalog diperbarui.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 3. Jadwal & Pembayaran */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Jadwal Pengerjaan</CardTitle>
                  <CardDescription>
                    Zona waktu Asia/Jakarta (WIB). Estimasi terisi otomatis dari durasi layanan terlama.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Input
                    label="Tanggal & Jam Masuk (WIB)"
                    type="datetime-local"
                    required
                    value={tanggalMasukWib}
                    error={galatField.tanggal_masuk}
                    onChange={(e) => setTanggalMasukWib(e.target.value)}
                  />

                  <Input
                    label="Estimasi Selesai (WIB)"
                    type="datetime-local"
                    value={estimasiSelesaiWib}
                    error={galatField.estimasi_selesai}
                    helperText={
                      estimasiManual
                        ? "Diatur manual oleh kasir."
                        : "Dihitung otomatis dari durasi layanan."
                    }
                    onChange={(e) => {
                      setEstimasiManualWib(e.target.value);
                    }}
                  />

                  {estimasiManual && (
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEstimasiManualWib(null)}
                      >
                        Kembalikan ke Hitungan Otomatis
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle as="h2">Status & Pembayaran</CardTitle>
                  <CardDescription>
                    Tiket baru di toko selalu dimulai dari status pengerjaan Belum dicuci.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-outfit text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Status Pesanan Awal
                    </span>
                    <div>
                      <Badge variant="pesanan" statusPesanan="Belum dicuci" />
                    </div>
                  </div>

                  <Select
                    label="Status Pembayaran"
                    required
                    value={statusBayar}
                    error={galatField.status_bayar}
                    options={[
                      { value: "Belum bayar", label: "Belum bayar" },
                      { value: "Lunas", label: "Lunas" },
                    ]}
                    onChange={(e) => setStatusBayar(e.target.value as StatusBayar)}
                  />

                  {statusBayar === "Lunas" && (
                    <Select
                      label="Metode Pembayaran"
                      required
                      value={metodeBayar}
                      error={galatField.metode_bayar}
                      options={[
                        { value: "Cash", label: "Cash" },
                        { value: "Non-cash", label: "Non-cash" },
                      ]}
                      helperText="Sistem hanya mencatat metode pembayaran (Cash atau Non-cash)."
                      onChange={(e) => setMetodeBayar(e.target.value as MetodeBayar)}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Kolom kanan: Panel Ringkasan Perkiraan */}
          <div className="lg:sticky lg:top-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle as="h2">Ringkasan Pesanan</CardTitle>
                  <Badge variant="default">Perkiraan</Badge>
                </div>
                <CardDescription>
                  Angka di bawah adalah perkiraan di layar. Total resmi dihitung ulang oleh server saat tiket disimpan.
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <ul className="divide-y divide-border-warm text-sm font-jakarta">
                  {ringkasanPerkiraan.rincian.map((r, i) => (
                    <li key={r.uid} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-text-main break-words">
                          {r.deskripsi || `Barang ke-${i + 1}`}
                        </p>
                        <p className="text-xs text-text-muted">
                          {r.namaLayanan} · {r.jumlah} pasang
                        </p>
                      </div>
                      <span className="font-outfit font-semibold text-text-body shrink-0">
                        {formatRupiah(r.subtotal)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="rounded-2xl bg-surface-subtle p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between font-jakarta text-sm text-text-body">
                    <span>Total Barang</span>
                    <span className="font-semibold">{ringkasanPerkiraan.totalPasang} pasang</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border-warm pt-2">
                    <span className="font-outfit text-sm font-bold text-text-main">
                      Perkiraan Total
                    </span>
                    <span className="font-outfit text-xl font-extrabold text-text-main">
                      {formatRupiah(ringkasanPerkiraan.totalHarga)}
                    </span>
                  </div>
                </div>

                {perkiraanMelebihiBatas && (
                  <p role="alert" className="font-jakarta text-xs font-medium text-danger">
                    Perkiraan total melebihi batas maksimal tiket ({formatRupiah(BATAS_TOTAL_TIKET)}).
                  </p>
                )}

                <div className="flex flex-col gap-2.5 pt-2">
                  <Button
                    type="submit"
                    size="lg"
                    loading={menyimpan}
                    disabled={menyimpan || perkiraanMelebihiBatas}
                    className="w-full"
                  >
                    {menyimpan ? "Menyimpan Tiket..." : "Simpan Tiket"}
                  </Button>
                  <Link
                    href="/tiket"
                    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-border-card bg-surface-card px-5 py-2.5 font-outfit text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-text-main transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Batal
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      )}
    </div>
  );
}
