"use client";

// Tampilan Detail Tiket Pesanan (Phase 5A & Phase 5B).
// - Kasir dapat mengubah status pesanan, mengubah pembayaran, dan membatalkan tiket langsung dari halaman ini.
// - Owner hanya melihat badge baca-saja tanpa kontrol mutasi dan tanpa tautan wa.me.
// - Seluruh riwayat perubahan (audit_logs) bersifat hanya-baca dan langsung diperbarui dari respons server.

import * as React from "react";
import Link from "next/link";
import type { DetailTiket, ItemTiket, RiwayatAuditTiket } from "@/lib/tiket";
import {
  bolehBatalkanTiket,
  daftarTargetStatusPesananValid,
  type StatusPesanan,
} from "@/config/order-status";
import { buatPesanWaTiket, buatUrlWaMe } from "@/lib/nomor-wa";
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
  DataTable,
  type DataTableColumn,
  PageHeader,
  Select,
} from "@/components/ui";
import {
  DialogMutasiTiket,
  kirimPatchTiket,
  type HasilPatchKlien,
  type ModeDialogMutasi,
  type TargetTiketRingkas,
} from "../dialog-mutasi-tiket";

const LABEL_AKSI_AUDIT: Record<string, string> = {
  TAMBAH_TIKET: "Tiket dibuat",
  UBAH_STATUS: "Status pesanan diubah",
  KOREKSI: "Koreksi status pesanan (mundur 1 langkah)",
  UBAH_PEMBAYARAN: "Status pembayaran diubah",
  BATALKAN_TIKET: "Tiket dibatalkan",
  UBAH_NAMA_PELANGGAN: "Perubahan nama pelanggan",
  // Kompatibilitas catatan lama bila ada:
  UBAH_STATUS_PESANAN: "Status pesanan diubah",
  UBAH_STATUS_BAYAR: "Status pembayaran diubah",
};

const LABEL_KUNCI_AUDIT: Record<string, string> = {
  nama: "Nama pelanggan",
  kode_tiket: "Kode tiket",
  sumber: "Sumber",
  status_pesanan: "Status pesanan",
  status_bayar: "Status pembayaran",
  metode_bayar: "Metode pembayaran",
  total: "Total",
  jumlah_item: "Jumlah baris barang",
  jumlah_pasang: "Jumlah pasang",
  alasan_batal: "Alasan pembatalan",
  alasan: "Alasan pembalikan pembayaran",
  koreksi_mundur: "Koreksi mundur",
  belum_bayar_saat_diambil: "Diambil saat belum bayar",
  uang_dikembalikan_di_luar_sistem: "Pengembalian dana di luar sistem",
  catatan_pembayaran: "Catatan pembayaran",
  tanggal_masuk: "Tanggal masuk",
  estimasi_selesai: "Estimasi selesai",
  tanggal_bayar: "Tanggal bayar",
};

function formatNilaiAudit(kunci: string, nilai: unknown): string {
  if (nilai === null || nilai === undefined || nilai === "") return "-";
  if ((kunci === "total" || kunci === "harga") && typeof nilai === "number") {
    return formatRupiah(nilai);
  }
  if (
    (kunci === "tanggal_masuk" ||
      kunci === "estimasi_selesai" ||
      kunci === "tanggal_bayar") &&
    typeof nilai === "string"
  ) {
    return formatTanggal(nilai, { denganWaktu: true });
  }
  if (typeof nilai === "boolean") {
    return nilai ? "Ya" : "Tidak";
  }
  if (typeof nilai === "string" || typeof nilai === "number") {
    return String(nilai);
  }
  return JSON.stringify(nilai);
}

function ringkasObjekAudit(
  obj: Record<string, unknown> | null
): { label: string; isi: string }[] {
  if (!obj) return [];
  const hasil: { label: string; isi: string }[] = [];
  for (const [kunci, nilai] of Object.entries(obj)) {
    if (
      kunci === "customer_id" ||
      kunci === "items" ||
      kunci === "nomor_wa" ||
      kunci === "wa" ||
      kunci === "phone"
    ) {
      continue;
    }
    const label = LABEL_KUNCI_AUDIT[kunci] ?? kunci;
    hasil.push({ label, isi: formatNilaiAudit(kunci, nilai) });
  }
  return hasil;
}

function KartuBarisAudit({ audit }: { audit: RiwayatAuditTiket }) {
  const judulAksi = LABEL_AKSI_AUDIT[audit.aksi] ?? audit.aksi;
  const pelaku = audit.nama_pengguna ?? "Sistem";
  const daftarLama = ringkasObjekAudit(audit.nilai_lama);
  const daftarBaru = ringkasObjekAudit(audit.nilai_baru);

  return (
    <li className="rounded-2xl border border-border-warm bg-surface-canvas p-4 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-outfit text-sm font-bold text-text-main">
            {judulAksi}
          </span>
          <span className="font-jakarta text-xs text-text-muted">
            oleh <strong className="text-text-body">{pelaku}</strong>
          </span>
        </div>
        <time
          dateTime={audit.waktu}
          className="font-jakarta text-xs text-text-muted shrink-0"
        >
          {formatTanggal(audit.waktu, { denganWaktu: true })}
        </time>
      </div>

      {(daftarLama.length > 0 || daftarBaru.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-jakarta text-xs">
          {daftarLama.length > 0 && (
            <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
              <p className="font-outfit font-semibold uppercase tracking-wider text-text-muted">
                Nilai Sebelumnya
              </p>
              {daftarLama.map((b) => (
                <p key={b.label} className="text-text-body break-words">
                  <span className="text-text-muted">{b.label}:</span> {b.isi}
                </p>
              ))}
            </div>
          )}
          {daftarBaru.length > 0 && (
            <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
              <p className="font-outfit font-semibold uppercase tracking-wider text-text-muted">
                Nilai Tercatat
              </p>
              {daftarBaru.map((b) => (
                <p key={b.label} className="text-text-body break-words">
                  <span className="text-text-muted">{b.label}:</span> {b.isi}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function keTargetDialogDetail(t: DetailTiket): TargetTiketRingkas {
  return {
    id: t.id,
    kode_tiket: t.kode_tiket,
    nama_pelanggan: t.pelanggan.nama,
    total: t.total,
    status_pesanan: t.status_pesanan,
    status_bayar: t.status_bayar,
    metode_bayar: t.metode_bayar,
  };
}

export interface DetailTiketClientProps {
  tiketAwal: DetailTiket;
  peran: "owner" | "kasir";
}

export function DetailTiketClient({ tiketAwal, peran }: DetailTiketClientProps) {
  const [tiketMutasi, setTiketMutasi] = React.useState<DetailTiket | null>(null);
  const tiket = tiketMutasi ?? tiketAwal;

  const [sedangProses, setSedangProses] = React.useState(false);
  const [sedangKirimUlangNotif, setSedangKirimUlangNotif] = React.useState(false);
  const [sedangUbahNotif, setSedangUbahNotif] = React.useState(false);
  const [dialogAktif, setDialogAktif] = React.useState<ModeDialogMutasi | null>(null);
  const [infoMutasi, setInfoMutasi] = React.useState<{
    tipe: "sukses" | "galat";
    pesan: string;
    sesiBerakhir?: boolean;
  } | null>(null);

  const bolehUbahTiket = peran === "kasir";
  const bolehKontakWa = peran === "kasir";

  const notif = tiket.notifikasi;
  const bolehKirimUlangNotif =
    bolehUbahTiket &&
    Boolean(notif) &&
    (notif?.status === "gagal" ||
      (notif?.status === "menunggu" && notif?.kode_galat === "RATE_LIMIT_TERCAPAI") ||
      (notif?.status === "dilewati" && notif?.alasan_dilewati === "saklar_mati"));

  function formatStatusNotifikasi(n: NonNullable<DetailTiket["notifikasi"]>): {
    teks: string;
  } {
    if (n.status === "terkirim") {
      const tgl = n.terkirim_pada
        ? formatTanggal(n.terkirim_pada, { denganWaktu: true })
        : "";
      return { teks: `Terkirim${tgl ? ` (${tgl})` : ""}` };
    }
    if (n.status === "mengirim") {
      return { teks: "Sedang mengirim..." };
    }
    if (n.status === "menunggu") {
      if (n.kode_galat === "RATE_LIMIT_TERCAPAI") {
        return { teks: "Ditunda karena batas laju" };
      }
      return { teks: "Menunggu antrean" };
    }
    if (n.status === "gagal") {
      return { teks: `Gagal${n.kode_galat ? ` (${n.kode_galat})` : ""}` };
    }
    const peta: Record<string, string> = {
      opt_out_pelanggan: "Dilewati (Pelanggan opt-out)",
      nomor_tidak_terverifikasi: "Dilewati (Nomor belum terverifikasi)",
      nomor_tidak_terdaftar_wa: "Dilewati (Nomor tidak terdaftar di WhatsApp)",
      saklar_mati: "Dilewati (Layanan notifikasi nonaktif)",
    };
    return { teks: peta[n.alasan_dilewati ?? ""] ?? `Dilewati (${n.alasan_dilewati ?? "lainnya"})` };
  }

  async function kirimUlangNotifikasi() {
    if (sedangKirimUlangNotif) return;
    setSedangKirimUlangNotif(true);
    setInfoMutasi(null);
    try {
      const res = await fetch(`/api/tiket/${tiket.id}/notifikasi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        if (json?.data) {
          setTiketMutasi(json.data);
        }
        setInfoMutasi({
          tipe: "sukses",
          pesan: json?.ok
            ? "Notifikasi WhatsApp berhasil dikirim ulang."
            : `Kirim ulang selesai dengan status: ${json?.status ?? "gagal"}.`,
        });
      } else {
        setInfoMutasi({
          tipe: "galat",
          pesan: json?.error ?? json?.pesan ?? "Gagal mengirim ulang notifikasi.",
        });
      }
    } catch {
      setInfoMutasi({
        tipe: "galat",
        pesan: "Terjadi kesalahan jaringan saat mengirim ulang notifikasi.",
      });
    } finally {
      setSedangKirimUlangNotif(false);
    }
  }

  async function toggleNotifikasiPelanggan(aktif: boolean) {
    if (sedangUbahNotif) return;
    setSedangUbahNotif(true);
    setInfoMutasi(null);
    try {
      const res = await fetch(`/api/pelanggan/${tiket.pelanggan.id}/notifikasi`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktif }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setTiketMutasi((prev) => {
          const t = prev ?? tiket;
          return {
            ...t,
            pelanggan: {
              ...t.pelanggan,
              notifikasi_wa_aktif: aktif,
            },
          };
        });
        setInfoMutasi({
          tipe: "sukses",
          pesan: aktif
            ? "Notifikasi WhatsApp untuk pelanggan ini telah diaktifkan."
            : "Notifikasi WhatsApp untuk pelanggan ini telah dinonaktifkan (opt-out).",
        });
      } else {
        setInfoMutasi({
          tipe: "galat",
          pesan: json?.error ?? "Gagal mengubah preferensi notifikasi pelanggan.",
        });
      }
    } catch {
      setInfoMutasi({
        tipe: "galat",
        pesan: "Terjadi kesalahan jaringan saat mengubah preferensi notifikasi pelanggan.",
      });
    } finally {
      setSedangUbahNotif(false);
    }
  }

  let urlWa: string | null = null;
  if (bolehKontakWa) {
    try {
      urlWa = buatUrlWaMe(
        tiket.pelanggan.nomor_wa,
        buatPesanWaTiket({
          kodeTiket: tiket.kode_tiket,
          namaPelanggan: tiket.pelanggan.nama,
          statusPesanan: tiket.status_pesanan,
          statusBayar: tiket.status_bayar,
          totalRupiah: formatRupiah(tiket.total),
        })
      );
    } catch {
      urlWa = null;
    }
  }

  function tanganiSukses(detailBaru: DetailTiket, pesanSukses: string) {
    setTiketMutasi(detailBaru);
    setInfoMutasi({ tipe: "sukses", pesan: pesanSukses });
  }

  function tanganiGalat(hasilGagal: Extract<HasilPatchKlien, { ok: false }>) {
    if (hasilGagal.dataTerbaru) {
      setTiketMutasi(hasilGagal.dataTerbaru);
    }
    setInfoMutasi({
      tipe: "galat",
      pesan: hasilGagal.pesan,
      sesiBerakhir: hasilGagal.sesiBerakhir,
    });
  }

  async function ubahStatusLangsung(targetBaru: StatusPesanan) {
    if (!bolehUbahTiket) return;
    if (targetBaru === tiket.status_pesanan || targetBaru === "Dibatalkan") return;

    if (targetBaru === "Sudah diambil" && tiket.status_bayar === "Belum bayar") {
      setDialogAktif({
        jenis: "konfirmasi_ambil_belum_bayar",
        tiket: keTargetDialogDetail(tiket),
      });
      return;
    }

    setInfoMutasi(null);
    setSedangProses(true);
    try {
      const res = await kirimPatchTiket(tiket.id, {
        jenis: "status_pesanan",
        status_pesanan: targetBaru,
        status_sebelumnya: tiket.status_pesanan,
      });
      if (res.ok) {
        tanganiSukses(
          res.data,
          `Status pesanan diperbarui menjadi "${res.data.status_pesanan}".`
        );
      } else {
        tanganiGalat(res);
      }
    } finally {
      setSedangProses(false);
    }
  }

  const kolomBarang: DataTableColumn<ItemTiket>[] = [
    {
      key: "deskripsi",
      header: "Deskripsi Barang",
      render: (it) => (
        <span className="font-semibold text-text-main break-words">
          {it.deskripsi_barang}
        </span>
      ),
    },
    {
      key: "layanan",
      header: "Layanan",
      render: (it) => <span className="text-text-body">{it.nama_layanan}</span>,
    },
    {
      key: "jumlah",
      header: "Jumlah",
      render: (it) => <span className="text-text-body">{it.jumlah} pasang</span>,
    },
    {
      key: "harga",
      header: "Harga Saat Transaksi",
      render: (it) => (
        <span className="whitespace-nowrap">{formatRupiah(it.harga_saat_transaksi)}</span>
      ),
    },
    {
      key: "subtotal",
      header: "Subtotal",
      render: (it) => (
        <span className="font-outfit font-bold text-text-main whitespace-nowrap">
          {formatRupiah(it.subtotal)}
        </span>
      ),
    },
  ];

  const opsiStatusValid = daftarTargetStatusPesananValid(tiket.status_pesanan);
  const bisaBatal = bolehUbahTiket && bolehBatalkanTiket(tiket.status_pesanan).boleh;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/tiket"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3 py-2 font-outfit text-sm font-semibold text-primary hover:bg-surface-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Ikon name="arrow_left" size={16} className="h-4 w-4" aria-hidden="true" />
          Kembali ke Daftar Tiket
        </Link>
      </div>

      <PageHeader
        title={tiket.kode_tiket}
        description={`Sumber pesanan: ${tiket.sumber === "wa" ? "WhatsApp" : "Toko"}${tiket.sumber === "wa" && tiket.serah_terima ? ` (${tiket.serah_terima === "jemput" ? "Jemput" : "Antar sendiri"})` : ""} · Dicatat oleh ${tiket.nama_pembuat ?? "Sistem"}`}
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="pesanan" statusPesanan={tiket.status_pesanan} />
            {tiket.terlambat_ambil && tiket.hari_belum_diambil !== null && (
              <Badge variant="warning">
                <Ikon name="schedule" size={12} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{`${tiket.hari_belum_diambil} hari belum diambil`}</span>
              </Badge>
            )}
            <Badge variant="bayar" statusBayar={tiket.status_bayar} />
            {peran === "owner" && <Badge variant="default">Hanya lihat</Badge>}
          </div>
        }
      />

      {tiket.notifikasi && (
        <div className="rounded-2xl border border-border-card bg-surface-canvas p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 font-jakarta text-sm">
          <div className="flex items-center gap-2.5">
            <Ikon
              name="message_circle"
              size={18}
              className={`h-5 w-5 shrink-0 ${
                tiket.notifikasi.status === "terkirim"
                  ? "text-status-lunas-text"
                  : tiket.notifikasi.status === "gagal"
                    ? "text-danger"
                    : "text-text-muted"
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="font-outfit text-xs font-semibold uppercase tracking-wider text-text-muted">
                Notifikasi WhatsApp (Siap Diambil)
              </p>
              <p className="text-text-main font-medium mt-0.5">
                {formatStatusNotifikasi(tiket.notifikasi).teks}
              </p>
            </div>
          </div>
          {bolehKirimUlangNotif && (
            <Button
              size="sm"
              variant="secondary"
              loading={sedangKirimUlangNotif}
              onClick={() => void kirimUlangNotifikasi()}
            >
              <Ikon name="refresh" size={14} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Kirim Ulang Notifikasi
            </Button>
          )}
        </div>
      )}

      {infoMutasi && (
        <div
          role={infoMutasi.tipe === "galat" ? "alert" : "status"}
          className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 font-jakarta text-sm ${
            infoMutasi.tipe === "galat"
              ? "border-danger bg-danger-light text-danger"
              : "border-status-lunas-border bg-status-lunas-bg text-status-lunas-text"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Ikon
              name={infoMutasi.tipe === "galat" ? "alert_triangle" : "check_circle"}
              size={18}
              className="h-4 w-4 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>{infoMutasi.pesan}</span>
          </div>
          <div className="flex items-center gap-2">
            {infoMutasi.sesiBerakhir && (
              <Link
                href="/login"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 py-2 font-outfit text-xs font-semibold text-white hover:bg-primary-hover transition-all"
              >
                Masuk Kembali
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => setInfoMutasi(null)}>
              Tutup
            </Button>
          </div>
        </div>
      )}

      {tiket.status_pesanan === "Dibatalkan" && tiket.alasan_batal && (
        <div
          role="note"
          className="rounded-3xl border border-status-dibatalkan-border bg-status-dibatalkan-bg p-5 text-status-dibatalkan-text font-jakarta text-sm"
        >
          <p className="font-outfit font-bold">Alasan Pembatalan</p>
          <p className="mt-1 break-words">{tiket.alasan_batal}</p>
        </div>
      )}

      {/* Panel Aksi Kasir (Hanya muncul untuk Kasir) */}
      {bolehUbahTiket && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Kelola Status & Pembayaran</CardTitle>
            <CardDescription>
              Setiap perubahan status, pembayaran, maupun pembatalan tercatat permanen di log audit.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end">
            <div>
              <Select
                label="Status Pesanan"
                disabled={sedangProses || tiket.status_pesanan === "Dibatalkan"}
                value={tiket.status_pesanan}
                onChange={(e) => ubahStatusLangsung(e.target.value as StatusPesanan)}
                options={opsiStatusValid.map((op) => ({
                  label: op.labelPilihan,
                  value: op.status,
                }))}
                helperText={
                  tiket.status_pesanan === "Dibatalkan"
                    ? "Tiket Dibatalkan bersifat final."
                    : "Boleh maju 1 langkah atau mundur 1 langkah sebagai koreksi."
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider">
                Pembayaran
              </span>
              {tiket.status_pesanan === "Dibatalkan" ? (
                <div className="min-h-[44px] flex items-center">
                  <Badge variant="bayar" statusBayar={tiket.status_bayar} />
                </div>
              ) : tiket.status_bayar === "Belum bayar" ? (
                <Button
                  variant="secondary"
                  disabled={sedangProses}
                  onClick={() =>
                    setDialogAktif({
                      jenis: "tandai_lunas",
                      tiket: keTargetDialogDetail(tiket),
                    })
                  }
                >
                  Tandai Lunas
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={sedangProses}
                  onClick={() =>
                    setDialogAktif({
                      jenis: "balik_belum_bayar",
                      tiket: keTargetDialogDetail(tiket),
                    })
                  }
                >
                  Ubah ke Belum Bayar
                </Button>
              )}
              <span className="font-jakarta text-xs text-text-muted">
                Saat ini: {tiket.status_bayar}
                {tiket.metode_bayar ? ` (${tiket.metode_bayar})` : ""}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider">
                Pembatalan Tiket
              </span>
              {bisaBatal ? (
                <Button
                  variant="danger"
                  disabled={sedangProses}
                  onClick={() =>
                    setDialogAktif({
                      jenis: "batalkan",
                      tiket: keTargetDialogDetail(tiket),
                    })
                  }
                >
                  <Ikon name="block" size={16} className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Batalkan Tiket
                </Button>
              ) : (
                <p className="min-h-[44px] flex items-center font-jakarta text-xs text-text-muted">
                  {tiket.status_pesanan === "Sudah diambil"
                    ? "Tiket yang sudah diambil tidak dapat dibatalkan."
                    : "Tiket sudah berstatus Dibatalkan."}
                </p>
              )}
              <span className="font-jakarta text-xs text-text-muted">
                Tiket tidak pernah dihapus dari sistem.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Pelanggan + Jadwal & Pembayaran */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Informasi Pelanggan</CardTitle>
            <CardDescription>Data kontak pelanggan pemilik cucian sepatu.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 font-jakarta text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Nama Pelanggan
                </dt>
                <dd className="mt-0.5 font-semibold text-text-main break-words">
                  {tiket.pelanggan.nama}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Nomor WhatsApp
                </dt>
                <dd className="mt-0.5 font-medium text-text-body flex items-center gap-2 flex-wrap">
                  <span>{tiket.pelanggan.nomor_wa}</span>
                  {tiket.nomor_terverifikasi === false && (
                    <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 border border-amber-500/20">
                      Nomor belum diverifikasi
                    </span>
                  )}
                </dd>
              </div>
              {tiket.sumber === "wa" && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-text-muted">
                    Metode Serah Terima
                  </dt>
                  <dd className="mt-0.5 font-medium text-text-body">
                    {tiket.serah_terima === "jemput" ? "Jemput" : "Antar sendiri"}
                  </dd>
                </div>
              )}
            </dl>

            {tiket.nomor_terverifikasi === false && (
              <div
                role="note"
                className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 font-jakarta flex items-start gap-2.5"
              >
                <Ikon
                  name="alert_triangle"
                  size={16}
                  className="h-4 w-4 shrink-0 text-amber-600 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <span className="font-semibold block font-outfit text-sm text-amber-900 dark:text-amber-200">
                    Peringatan Kasir
                  </span>
                  <span>
                    Nomor ini dimasukkan manual oleh pelanggan via bot privasi WA. Pastikan kebenaran nomor sebelum menghubungi.
                  </span>
                </div>
              </div>
            )}

            {bolehKontakWa && urlWa && (
              <div className="pt-1">
                <a
                  href={urlWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-2.5 font-outfit text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <Ikon
                    name="message_circle"
                    size={18}
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  Hubungi via WhatsApp
                </a>
              </div>
            )}

            <div className="pt-3 border-t border-border-warm flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-text-main">
                    Notifikasi WhatsApp Otomatis
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {tiket.pelanggan.notifikasi_wa_aktif === false
                      ? "Pelanggan memilih berhenti menerima notifikasi (opt-out)."
                      : "Pelanggan aktif menerima notifikasi pesanan."}
                  </p>
                </div>
                {bolehUbahTiket && (
                  <Button
                    size="sm"
                    variant={tiket.pelanggan.notifikasi_wa_aktif === false ? "primary" : "secondary"}
                    loading={sedangUbahNotif}
                    onClick={() => void toggleNotifikasiPelanggan(!tiket.pelanggan.notifikasi_wa_aktif)}
                  >
                    {tiket.pelanggan.notifikasi_wa_aktif === false
                      ? "Aktifkan Notifikasi"
                      : "Jangan Kirim Notifikasi"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Jadwal & Pembayaran</CardTitle>
            <CardDescription>Seluruh waktu ditampilkan dalam zona Asia/Jakarta (WIB).</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-jakarta text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Tanggal Masuk
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {formatTanggal(tiket.tanggal_masuk, { denganWaktu: true })}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Estimasi Selesai
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.estimasi_selesai
                    ? formatTanggal(tiket.estimasi_selesai, { denganWaktu: true })
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Status Pembayaran
                </dt>
                <dd className="mt-1">
                  <Badge variant="bayar" statusBayar={tiket.status_bayar} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Metode Pembayaran
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.metode_bayar ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Tanggal Pembayaran
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.tanggal_bayar
                    ? formatTanggal(tiket.tanggal_bayar, { denganWaktu: true })
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Siap Diambil Sejak
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.siap_diambil_pada
                    ? formatTanggal(tiket.siap_diambil_pada, { denganWaktu: true })
                    : "-"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Daftar Barang & Layanan */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Daftar Barang & Layanan</CardTitle>
          <CardDescription>
            Harga saat transaksi disalin dari katalog ketika tiket dibuat dan tidak berubah walau harga katalog diperbarui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Rincian barang dan layanan pada tiket"
            columns={kolomBarang}
            data={tiket.items}
            rowKey={(it) => it.id}
            renderMobileCard={(it) => (
              <div className="rounded-2xl border border-border-warm bg-surface-canvas p-4 flex flex-col gap-1.5 font-jakarta text-sm">
                <p className="font-semibold text-text-main break-words">
                  {it.deskripsi_barang}
                </p>
                <p className="text-xs text-text-muted">
                  {it.nama_layanan} · {it.jumlah} pasang ×{" "}
                  {formatRupiah(it.harga_saat_transaksi)}
                </p>
                <p className="font-outfit font-bold text-text-main pt-1">
                  Subtotal: {formatRupiah(it.subtotal)}
                </p>
              </div>
            )}
          />
        </CardContent>
        <CardFooter className="flex-wrap">
          <span className="font-jakarta text-sm text-text-muted">
            Total {tiket.jumlah_pasang} pasang sepatu ({tiket.jumlah_item} baris barang)
          </span>
          <div className="flex items-baseline gap-3">
            <span className="font-outfit text-sm font-semibold uppercase tracking-wider text-text-muted">
              Total Tiket
            </span>
            <span className="font-outfit text-2xl font-extrabold text-text-main">
              {formatRupiah(tiket.total)}
            </span>
          </div>
        </CardFooter>
      </Card>

      {/* Riwayat Perubahan (Log Audit Hanya Baca) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Ikon name="history" size={20} className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle as="h2">Riwayat Perubahan (Log Audit)</CardTitle>
            </div>
            <Badge variant="default">Hanya baca</Badge>
          </div>
          <CardDescription>
            Catatan kronologis permanen dari tabel audit_logs yang tidak dapat diubah maupun dihapus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tiket.riwayat_audit.length === 0 ? (
            <p className="font-jakarta text-sm text-text-muted">
              Belum ada catatan audit untuk tiket ini.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {tiket.riwayat_audit.map((audit) => (
                <KartuBarisAudit key={audit.id} audit={audit} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <DialogMutasiTiket
        dialog={dialogAktif}
        sedangMemproses={sedangProses}
        onTutup={() => setDialogAktif(null)}
        onBerhasil={tanganiSukses}
        onKonflikAtauGalat={tanganiGalat}
        onMulaiProses={() => {
          setInfoMutasi(null);
          setSedangProses(true);
        }}
        onSelesaiProses={() => setSedangProses(false)}
      />
    </div>
  );
}
