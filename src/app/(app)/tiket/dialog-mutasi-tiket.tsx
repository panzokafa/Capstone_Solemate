"use client";

// Dialog & pemanggil PATCH /api/tiket/[id] bersama untuk Daftar Tiket dan Detail Tiket (Phase 5B).
// Seluruh perubahan status selalu mengambil kebenaran akhir dari respons server (bukan tebakan klien).

import * as React from "react";
import type { DetailTiket, RingkasanTiket } from "@/lib/tiket";
import {
  METODE_BAYAR,
  type MetodeBayar,
  type StatusBayar,
  type StatusPesanan,
} from "@/config/order-status";
import { MAKS_ALASAN_TIKET } from "@/config/tiket";
import {
  apakahSesiDialihkanKeLogin,
  mengandungKarakterTerlarang,
} from "@/lib/tiket-validasi";
import { formatRupiah } from "@/lib/format";
import { Button, Dialog, Input, Select } from "@/components/ui";

export type TargetTiketRingkas = {
  id: number;
  kode_tiket: string;
  nama_pelanggan: string;
  total: number;
  status_pesanan: StatusPesanan;
  status_bayar: StatusBayar;
  metode_bayar: MetodeBayar | null;
};

export type ModeDialogMutasi =
  | { jenis: "tandai_lunas"; tiket: TargetTiketRingkas }
  | { jenis: "balik_belum_bayar"; tiket: TargetTiketRingkas }
  | { jenis: "batalkan"; tiket: TargetTiketRingkas }
  | { jenis: "konfirmasi_ambil_belum_bayar"; tiket: TargetTiketRingkas };

export type HasilPatchKlien =
  | { ok: true; data: DetailTiket }
  | {
      ok: false;
      status: number;
      kodeKonflik?: string;
      pesan: string;
      sesiBerakhir?: boolean;
      dataTerbaru?: DetailTiket | null;
    };

export function detailKeRingkasan(d: DetailTiket): RingkasanTiket {
  return {
    id: d.id,
    kode_tiket: d.kode_tiket,
    sumber: d.sumber,
    tanggal_masuk: d.tanggal_masuk,
    estimasi_selesai: d.estimasi_selesai,
    status_pesanan: d.status_pesanan,
    siap_diambil_pada: d.siap_diambil_pada,
    hari_belum_diambil: d.hari_belum_diambil,
    terlambat_ambil: d.terlambat_ambil,
    status_bayar: d.status_bayar,
    metode_bayar: d.metode_bayar,
    tanggal_bayar: d.tanggal_bayar,
    total: d.total,
    jumlah_item: d.jumlah_item,
    jumlah_pasang: d.jumlah_pasang,
    ringkasan_layanan: d.ringkasan_layanan,
    pelanggan: d.pelanggan,
  };
}

export async function kirimPatchTiket(
  id: number,
  body: Record<string, unknown>
): Promise<HasilPatchKlien> {
  try {
    const res = await fetch(`/api/tiket/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (apakahSesiDialihkanKeLogin(res)) {
      return {
        ok: false,
        status: 401,
        pesan: "Sesi berakhir, silakan masuk lagi.",
        sesiBerakhir: true,
      };
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok || !json?.data) {
      return {
        ok: false,
        status: res.status,
        kodeKonflik: json?.kode_konflik,
        pesan: json?.error ?? "Gagal memperbarui tiket. Silakan coba lagi.",
        dataTerbaru: (json?.data as DetailTiket | null) ?? null,
      };
    }

    return { ok: true, data: json.data as DetailTiket };
  } catch {
    return {
      ok: false,
      status: 0,
      pesan: "Gagal terhubung ke server. Periksa jaringan lalu coba lagi.",
    };
  }
}

export interface DialogMutasiTiketProps {
  dialog: ModeDialogMutasi | null;
  sedangMemproses: boolean;
  onTutup: () => void;
  onBerhasil: (detail: DetailTiket, pesanSukses: string) => void;
  onKonflikAtauGalat: (hasil: Extract<HasilPatchKlien, { ok: false }>) => void;
  onMulaiProses: (idTiket: number) => void;
  onSelesaiProses: () => void;
}

export function DialogMutasiTiket(props: DialogMutasiTiketProps) {
  const { dialog } = props;
  if (!dialog) return null;
  const kunciDialog = `${dialog.jenis}:${dialog.tiket.id}:${dialog.tiket.status_pesanan}:${dialog.tiket.status_bayar}`;
  return <IsiDialogMutasiTiket key={kunciDialog} {...props} dialog={dialog} />;
}

function IsiDialogMutasiTiket({
  dialog,
  sedangMemproses,
  onTutup,
  onBerhasil,
  onKonflikAtauGalat,
  onMulaiProses,
  onSelesaiProses,
}: Omit<DialogMutasiTiketProps, "dialog"> & { dialog: ModeDialogMutasi }) {
  const [metodeBayar, setMetodeBayar] = React.useState<MetodeBayar>("Cash");
  const [alasanTeks, setAlasanTeks] = React.useState("");
  const [konfirmasiSudahLunas, setKonfirmasiSudahLunas] = React.useState(false);
  const [galatLokal, setGalatLokal] = React.useState<string | null>(null);

  const { tiket } = dialog;

  function tutupAman() {
    if (sedangMemproses) return;
    onTutup();
  }

  async function kirimTandaiLunas(e: React.FormEvent) {
    e.preventDefault();
    setGalatLokal(null);
    onMulaiProses(tiket.id);
    try {
      const hasil = await kirimPatchTiket(tiket.id, {
        jenis: "pembayaran",
        status_bayar: "Lunas",
        metode_bayar: metodeBayar,
        status_sebelumnya: tiket.status_bayar,
      });
      if (hasil.ok) {
        onBerhasil(
          hasil.data,
          `Pembayaran tiket ${tiket.kode_tiket} tercatat Lunas (${metodeBayar}).`
        );
        onTutup();
      } else {
        setGalatLokal(hasil.pesan);
        onKonflikAtauGalat(hasil);
        if (hasil.status === 409) onTutup();
      }
    } finally {
      onSelesaiProses();
    }
  }

  async function kirimBalikBelumBayar(e: React.FormEvent) {
    e.preventDefault();
    if (mengandungKarakterTerlarang(alasanTeks)) {
      setGalatLokal(
        "Alasan tidak boleh mengandung karakter kontrol, tab, baris baru, atau karakter tersembunyi."
      );
      return;
    }
    const bersih = alasanTeks.trim();
    if (bersih.length === 0) {
      setGalatLokal("Alasan pembalikan pembayaran wajib diisi.");
      return;
    }
    if (bersih.length > MAKS_ALASAN_TIKET) {
      setGalatLokal(`Alasan maksimal ${MAKS_ALASAN_TIKET} karakter.`);
      return;
    }

    setGalatLokal(null);
    onMulaiProses(tiket.id);
    try {
      const hasil = await kirimPatchTiket(tiket.id, {
        jenis: "pembayaran",
        status_bayar: "Belum bayar",
        alasan: bersih,
        status_sebelumnya: tiket.status_bayar,
      });
      if (hasil.ok) {
        onBerhasil(
          hasil.data,
          `Status pembayaran tiket ${tiket.kode_tiket} dikembalikan ke Belum bayar.`
        );
        onTutup();
      } else {
        setGalatLokal(hasil.pesan);
        onKonflikAtauGalat(hasil);
        if (hasil.status === 409) onTutup();
      }
    } finally {
      onSelesaiProses();
    }
  }

  async function kirimBatalkanTiket(e: React.FormEvent) {
    e.preventDefault();
    if (mengandungKarakterTerlarang(alasanTeks)) {
      setGalatLokal(
        "Alasan pembatalan tidak boleh mengandung karakter kontrol, tab, baris baru, atau karakter tersembunyi."
      );
      return;
    }
    const bersih = alasanTeks.trim();
    if (bersih.length === 0) {
      setGalatLokal("Alasan pembatalan wajib diisi.");
      return;
    }
    if (bersih.length > MAKS_ALASAN_TIKET) {
      setGalatLokal(`Alasan pembatalan maksimal ${MAKS_ALASAN_TIKET} karakter.`);
      return;
    }
    if (tiket.status_bayar === "Lunas" && !konfirmasiSudahLunas) {
      setGalatLokal(
        "Centang konfirmasi pengembalian dana di luar sistem terlebih dahulu."
      );
      return;
    }

    setGalatLokal(null);
    onMulaiProses(tiket.id);
    try {
      const hasil = await kirimPatchTiket(tiket.id, {
        jenis: "batalkan",
        alasan_batal: bersih,
        ...(tiket.status_bayar === "Lunas"
          ? { konfirmasi_sudah_lunas: konfirmasiSudahLunas }
          : {}),
        status_sebelumnya: tiket.status_pesanan,
      });
      if (hasil.ok) {
        onBerhasil(hasil.data, `Tiket ${tiket.kode_tiket} telah dibatalkan.`);
        onTutup();
      } else {
        setGalatLokal(hasil.pesan);
        onKonflikAtauGalat(hasil);
        if (hasil.status === 409) onTutup();
      }
    } finally {
      onSelesaiProses();
    }
  }

  async function kirimKonfirmasiAmbilBelumBayar(e: React.FormEvent) {
    e.preventDefault();
    setGalatLokal(null);
    onMulaiProses(tiket.id);
    try {
      const hasil = await kirimPatchTiket(tiket.id, {
        jenis: "status_pesanan",
        status_pesanan: "Sudah diambil",
        status_sebelumnya: tiket.status_pesanan,
        konfirmasi_belum_bayar: true,
      });
      if (hasil.ok) {
        onBerhasil(
          hasil.data,
          `Tiket ${tiket.kode_tiket} ditandai Sudah diambil (catatan belum bayar direkam di audit).`
        );
        onTutup();
      } else {
        setGalatLokal(hasil.pesan);
        onKonflikAtauGalat(hasil);
        if (hasil.status === 409) onTutup();
      }
    } finally {
      onSelesaiProses();
    }
  }

  if (dialog.jenis === "tandai_lunas") {
    return (
      <Dialog
        open
        onClose={tutupAman}
        title={`Tandai Lunas — ${tiket.kode_tiket}`}
        description={`Pelanggan: ${tiket.nama_pelanggan} · Total tagihan: ${formatRupiah(tiket.total)}`}
      >
        <form onSubmit={kirimTandaiLunas} className="flex flex-col gap-4" noValidate>
          <Select
            label="Metode Pembayaran"
            required
            disabled={sedangMemproses}
            value={metodeBayar}
            onChange={(e) => setMetodeBayar(e.target.value as MetodeBayar)}
            options={METODE_BAYAR.map((m) => ({ label: m, value: m }))}
            helperText="Waktu pembayaran dicatat otomatis oleh server dalam zona Asia/Jakarta."
          />

          {galatLokal && (
            <p role="alert" className="font-jakarta text-xs font-medium text-danger">
              {galatLokal}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={sedangMemproses}
              onClick={tutupAman}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" loading={sedangMemproses}>
              Simpan Lunas
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  if (dialog.jenis === "balik_belum_bayar") {
    return (
      <Dialog
        open
        onClose={tutupAman}
        title={`Kembalikan ke Belum Bayar — ${tiket.kode_tiket}`}
        description="Metode pembayaran dan waktu bayar akan dikosongkan, serta alasan perubahan dicatat permanen di log audit."
      >
        <form onSubmit={kirimBalikBelumBayar} className="flex flex-col gap-4" noValidate>
          <Input
            label="Alasan Pembalikan Pembayaran"
            required
            disabled={sedangMemproses}
            maxLength={MAKS_ALASAN_TIKET}
            placeholder="Contoh: Salah pilih metode bayar, perlu diinput ulang"
            value={alasanTeks}
            onChange={(e) => setAlasanTeks(e.target.value)}
            error={galatLokal ?? undefined}
            helperText={`Maksimal ${MAKS_ALASAN_TIKET} karakter.`}
          />

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={sedangMemproses}
              onClick={tutupAman}
            >
              Batal
            </Button>
            <Button type="submit" variant="danger" loading={sedangMemproses}>
              Kembalikan ke Belum Bayar
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  if (dialog.jenis === "konfirmasi_ambil_belum_bayar") {
    return (
      <Dialog
        open
        onClose={tutupAman}
        title={`Konfirmasi Pengambilan — ${tiket.kode_tiket}`}
        description="Tiket ini masih tercatat Belum bayar."
      >
        <form
          onSubmit={kirimKonfirmasiAmbilBelumBayar}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="rounded-2xl border border-status-belum-bayar-border bg-status-belum-bayar-bg p-4 font-jakarta text-sm text-status-belum-bayar-text">
            Tagihan sebesar <strong>{formatRupiah(tiket.total)}</strong> atas nama{" "}
            <strong>{tiket.nama_pelanggan}</strong> masih berstatus{" "}
            <strong>Belum bayar</strong>. Bila dilanjutkan, log audit akan mencatat bahwa
            sepatu diambil sebelum pembayaran lunas.
          </div>

          {galatLokal && (
            <p role="alert" className="font-jakarta text-xs font-medium text-danger">
              {galatLokal}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={sedangMemproses}
              onClick={tutupAman}
            >
              Kembali
            </Button>
            <Button type="submit" variant="primary" loading={sedangMemproses}>
              Ya, Tandai Sudah Diambil
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  // dialog.jenis === "batalkan"
  return (
    <Dialog
      open
      onClose={tutupAman}
      title={`Batalkan Tiket — ${tiket.kode_tiket}`}
      description="Pembatalan bersifat permanen (final). Tiket tetap tersimpan di riwayat namun tidak dapat diubah lagi."
    >
      <form onSubmit={kirimBatalkanTiket} className="flex flex-col gap-4" noValidate>
        {tiket.status_bayar === "Lunas" && (
          <div className="rounded-2xl border border-status-dibatalkan-border bg-status-dibatalkan-bg p-4 font-jakarta text-sm text-status-dibatalkan-text flex flex-col gap-3">
            <p>
              Tiket ini sudah tercatat <strong>Lunas</strong> (
              {tiket.metode_bayar ?? "-"}, {formatRupiah(tiket.total)}). Sistem tidak
              memproses pengembalian uang otomatis; pengembalian dana wajib diselesaikan
              di luar sistem.
            </p>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl bg-surface-card px-3 py-2 text-text-main border border-border-card">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-primary"
                checked={konfirmasiSudahLunas}
                disabled={sedangMemproses}
                onChange={(e) => setKonfirmasiSudahLunas(e.target.checked)}
              />
              <span className="text-xs font-semibold">
                Saya mengonfirmasi pengembalian dana pelanggan ditangani di luar sistem.
              </span>
            </label>
          </div>
        )}

        <Input
          label="Alasan Pembatalan"
          required
          disabled={sedangMemproses}
          maxLength={MAKS_ALASAN_TIKET}
          placeholder="Contoh: Pelanggan membatalkan pesanan karena buru-buru"
          value={alasanTeks}
          onChange={(e) => setAlasanTeks(e.target.value)}
          error={galatLokal ?? undefined}
          helperText={`Maksimal ${MAKS_ALASAN_TIKET} karakter.`}
        />

        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <Button
            type="button"
            variant="secondary"
            disabled={sedangMemproses}
            onClick={tutupAman}
          >
            Kembali
          </Button>
          <Button type="submit" variant="danger" loading={sedangMemproses}>
            Batalkan Tiket
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
