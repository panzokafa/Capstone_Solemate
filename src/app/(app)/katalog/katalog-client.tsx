"use client";

// Tampilan katalog layanan (owner). Semua teks ditampilkan sebagai teks biasa (React meng-escape).
// Server tetap memeriksa peran dan memvalidasi semua input; tampilan ini hanya antarmuka.
import * as React from "react";
import type { Layanan } from "@/lib/katalog";
import { formatRupiah } from "@/lib/format";
import { Button, Badge, Card, CardContent, Dialog, Input, PageHeader } from "@/components/ui";

type FormState = { nama: string; harga: string; hari: string; aktif: boolean };
const FORM_KOSONG: FormState = { nama: "", harga: "", hari: "", aktif: true };

type Mode = { jenis: "tambah" } | { jenis: "ubah"; layanan: Layanan };

async function kirim(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

function StatusBadge({ aktif }: { aktif: boolean }) {
  return <Badge variant={aktif ? "success" : "default"}>{aktif ? "Aktif" : "Nonaktif"}</Badge>;
}

export function KatalogClient({ awal }: { awal: Layanan[] }) {
  const [daftar, setDaftar] = React.useState<Layanan[]>(awal);
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [form, setForm] = React.useState<FormState>(FORM_KOSONG);
  const [galatForm, setGalatForm] = React.useState<string | null>(null);
  const [menyimpan, setMenyimpan] = React.useState(false);
  const [targetNonaktif, setTargetNonaktif] = React.useState<Layanan | null>(null);
  const [galatHalaman, setGalatHalaman] = React.useState<string | null>(null);
  const [sibukId, setSibukId] = React.useState<number | null>(null);

  async function muatUlang() {
    const { res, data } = await kirim("/api/katalog", "GET");
    if (res.ok && data?.data) setDaftar(data.data as Layanan[]);
  }

  function bukaTambah() {
    setForm(FORM_KOSONG);
    setGalatForm(null);
    setMode({ jenis: "tambah" });
  }

  function bukaUbah(l: Layanan) {
    setForm({ nama: l.nama, harga: String(l.harga), hari: String(l.estimasi_hari), aktif: l.aktif });
    setGalatForm(null);
    setMode({ jenis: "ubah", layanan: l });
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;
    // Angka dikirim sebagai number (server menolak angka berbentuk teks).
    if (!/^\d+$/.test(form.harga.trim()) || !/^\d+$/.test(form.hari.trim())) {
      setGalatForm("Harga dan estimasi hari harus berupa angka bulat tanpa titik atau koma.");
      return;
    }
    const isi = {
      nama: form.nama,
      harga: Number(form.harga.trim()),
      estimasi_hari: Number(form.hari.trim()),
    };
    setMenyimpan(true);
    setGalatForm(null);
    try {
      const { res, data } =
        mode.jenis === "tambah"
          ? await kirim("/api/katalog", "POST", { ...isi, aktif: form.aktif })
          : await kirim(`/api/katalog/${mode.layanan.id}`, "PUT", isi);
      if (!res.ok) {
        setGalatForm(data?.error ?? "Gagal menyimpan layanan.");
        return;
      }
      setMode(null);
      await muatUlang();
    } catch {
      setGalatForm("Tidak dapat terhubung ke server. Coba lagi.");
    } finally {
      setMenyimpan(false);
    }
  }

  async function aturStatus(l: Layanan, aktif: boolean) {
    setSibukId(l.id);
    setGalatHalaman(null);
    try {
      const { res, data } = await kirim(`/api/katalog/${l.id}`, "PATCH", { aktif });
      if (!res.ok) {
        setGalatHalaman(data?.error ?? "Gagal mengubah status layanan.");
        return;
      }
      setTargetNonaktif(null);
      await muatUlang();
    } catch {
      setGalatHalaman("Tidak dapat terhubung ke server. Coba lagi.");
    } finally {
      setSibukId(null);
    }
  }

  const aksi = (l: Layanan) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => bukaUbah(l)}>
        Ubah
      </Button>
      {l.aktif ? (
        <Button
          size="sm"
          variant="danger"
          disabled={sibukId === l.id}
          onClick={() => {
            setGalatHalaman(null);
            setTargetNonaktif(l);
          }}
        >
          Nonaktifkan
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          loading={sibukId === l.id}
          onClick={() => aturStatus(l, true)}
        >
          Aktifkan
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Katalog Layanan & Harga"
        description="Daftar layanan dan harga yang dipakai kasir saat membuat tiket. Layanan tidak dihapus, hanya dinonaktifkan."
        actions={<Button onClick={bukaTambah}>Tambah layanan</Button>}
      />

      <p className="font-jakarta text-sm text-text-muted">
        Perubahan harga tidak mengubah tiket yang sudah dibuat.
      </p>

      {galatHalaman && (
        <div
          role="alert"
          className="rounded-xl border border-danger bg-danger-light px-4 py-3 font-jakarta text-sm font-medium text-danger"
        >
          {galatHalaman}
        </div>
      )}

      {daftar.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <p className="font-jakarta text-sm text-text-muted">
              Belum ada layanan. Tambahkan layanan pertama agar kasir bisa membuat tiket.
            </p>
            <Button onClick={bukaTambah}>Tambah layanan</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tablet dan desktop: tabel */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border-card bg-surface-card md:block">
            <table className="w-full text-left font-jakarta text-sm">
              <thead className="border-b border-border-card bg-surface-subtle font-outfit text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">Nama layanan</th>
                  <th scope="col" className="px-4 py-3">Harga</th>
                  <th scope="col" className="px-4 py-3">Estimasi durasi</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {daftar.map((l) => (
                  <tr key={l.id} className="border-b border-border-warm last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-main">{l.nama}</td>
                    <td className="px-4 py-3">{formatRupiah(l.harga)}</td>
                    <td className="px-4 py-3">{l.estimasi_hari} hari</td>
                    <td className="px-4 py-3"><StatusBadge aktif={l.aktif} /></td>
                    <td className="px-4 py-3">{aksi(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ponsel: kartu */}
          <ul className="flex flex-col gap-3 md:hidden">
            {daftar.map((l) => (
              <li key={l.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-outfit text-base font-bold text-text-main break-words min-w-0">
                        {l.nama}
                      </span>
                      <StatusBadge aktif={l.aktif} />
                    </div>
                    <p className="font-jakarta text-sm text-text-body">
                      {formatRupiah(l.harga)} · {l.estimasi_hari} hari
                    </p>
                    {aksi(l)}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Dialog tambah / ubah */}
      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode?.jenis === "ubah" ? "Ubah layanan" : "Tambah layanan"}
        description="Perubahan harga tidak mengubah tiket yang sudah dibuat."
      >
        <form onSubmit={simpan} className="flex flex-col gap-4" noValidate>
          <Input
            label="Nama layanan"
            required
            maxLength={100}
            value={form.nama}
            onChange={(e) => setForm({ ...form, nama: e.target.value })}
          />
          <Input
            label="Harga (Rp)"
            required
            inputMode="numeric"
            helperText="Bilangan bulat rupiah, maksimal 100.000.000"
            value={form.harga}
            onChange={(e) => setForm({ ...form, harga: e.target.value })}
          />
          <Input
            label="Estimasi durasi (hari)"
            required
            inputMode="numeric"
            helperText="Bilangan bulat, maksimal 365"
            value={form.hari}
            onChange={(e) => setForm({ ...form, hari: e.target.value })}
          />
          {mode?.jenis === "tambah" && (
            <label className="flex min-h-[44px] items-center gap-3 font-jakarta text-sm text-text-body">
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary"
                checked={form.aktif}
                onChange={(e) => setForm({ ...form, aktif: e.target.checked })}
              />
              Langsung aktif
            </label>
          )}
          {galatForm && (
            <p role="alert" className="font-jakarta text-sm font-medium text-danger">
              {galatForm}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setMode(null)}>
              Batal
            </Button>
            <Button type="submit" loading={menyimpan}>
              Simpan
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog konfirmasi nonaktifkan */}
      <Dialog
        open={targetNonaktif !== null}
        onClose={() => setTargetNonaktif(null)}
        title="Nonaktifkan layanan?"
        description="Layanan tidak dihapus. Kasir tidak bisa memilihnya lagi untuk tiket baru, dan tiket lama tidak berubah. Anda bisa mengaktifkannya kembali."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTargetNonaktif(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              loading={targetNonaktif !== null && sibukId === targetNonaktif.id}
              onClick={() => targetNonaktif && aturStatus(targetNonaktif, false)}
            >
              Nonaktifkan
            </Button>
          </>
        }
      >
        <p className="font-jakarta text-sm font-semibold text-text-main break-words">
          {targetNonaktif?.nama}
        </p>
      </Dialog>
    </div>
  );
}
