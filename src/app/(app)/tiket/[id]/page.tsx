// Detail Tiket Pesanan — Kasir dan Owner (PRD 7.5, FR-16, NFR-01, NFR-02).
// Riwayat perubahan diambil dari audit_logs dan selalu bersifat hanya-baca.
// ID yang bukan bilangan bulat positif atau tidak ada menghasilkan 404 yang rapi.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, AksesDitolakError } from "@/lib/auth";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket, type ItemTiket, type RiwayatAuditTiket } from "@/lib/tiket";
import { buatPesanWaTiket, buatUrlWaMe } from "@/lib/nomor-wa";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { Ikon } from "@/components/ikon";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  PageHeader,
} from "@/components/ui";
import { AksesDitolak } from "../../akses-ditolak";

type ParamsProp = Promise<{ id: string }>;

const LABEL_AKSI_AUDIT: Record<string, string> = {
  TAMBAH_TIKET: "Tiket dibuat",
  UBAH_STATUS_PESANAN: "Status pesanan diubah",
  UBAH_STATUS_BAYAR: "Status pembayaran diubah",
  BATALKAN_TIKET: "Tiket dibatalkan",
};

const LABEL_KUNCI_AUDIT: Record<string, string> = {
  kode_tiket: "Kode tiket",
  sumber: "Sumber",
  status_pesanan: "Status pesanan",
  status_bayar: "Status pembayaran",
  metode_bayar: "Metode pembayaran",
  total: "Total",
  jumlah_item: "Jumlah baris barang",
  jumlah_pasang: "Jumlah pasang",
  alasan_batal: "Alasan pembatalan",
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
  if (typeof nilai === "string" || typeof nilai === "number" || typeof nilai === "boolean") {
    return String(nilai);
  }
  return JSON.stringify(nilai);
}

function ringkasObjekAudit(obj: Record<string, unknown> | null): { label: string; isi: string }[] {
  if (!obj) return [];
  const hasil: { label: string; isi: string }[] = [];
  for (const [kunci, nilai] of Object.entries(obj)) {
    if (kunci === "customer_id" || kunci === "items") continue;
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

export default async function DetailTiketByIdPage({
  params,
}: {
  params: ParamsProp;
}) {
  let sesi;
  try {
    sesi = await requireAuth();
  } catch (e) {
    if (e instanceof AksesDitolakError) return <AksesDitolak />;
    throw e;
  }

  const { id: idRaw } = await params;
  const idValid = validasiIdTiket(idRaw);
  if (idValid === null) {
    notFound();
  }

  const tiket = await ambilDetailTiket(idValid);
  if (!tiket) {
    notFound();
  }

  const bolehKontakWa = sesi.peran === "kasir";
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
        description={`Sumber pesanan: ${tiket.sumber === "wa" ? "WhatsApp" : "Toko"} · Dicatat oleh ${tiket.nama_pembuat ?? "Sistem"}`}
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="pesanan" statusPesanan={tiket.status_pesanan} />
            <Badge variant="bayar" statusBayar={tiket.status_bayar} />
            {sesi.peran === "owner" && <Badge variant="default">Hanya lihat</Badge>}
          </div>
        }
      />

      {tiket.status_pesanan === "Dibatalkan" && tiket.alasan_batal && (
        <div
          role="note"
          className="rounded-3xl border border-status-dibatalkan-border bg-status-dibatalkan-bg p-5 text-status-dibatalkan-text font-jakarta text-sm"
        >
          <p className="font-outfit font-bold">Alasan Pembatalan</p>
          <p className="mt-1 break-words">{tiket.alasan_batal}</p>
        </div>
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
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.pelanggan.nomor_wa}
                </dd>
              </div>
            </dl>

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
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  Tanggal Pembayaran
                </dt>
                <dd className="mt-0.5 font-medium text-text-body">
                  {tiket.tanggal_bayar
                    ? formatTanggal(tiket.tanggal_bayar, { denganWaktu: true })
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
    </div>
  );
}
