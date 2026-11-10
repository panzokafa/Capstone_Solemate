// Endpoint kirim ulang notifikasi WhatsApp tiket (Phase 6B, FR-24).
// - POST /api/tiket/[id]/notifikasi : Kasir saja. Mengirim ulang notifikasi 'siap_diambil' yang gagal.
// Menolak (409) alasan opt-out pelanggan, nomor tidak terverifikasi, dan nomor tidak terdaftar WA.

import { NextRequest, NextResponse } from "next/server";
import { requireKasir, AksesDitolakError } from "@/lib/auth";
import { periksaPermintaanUbah } from "@/lib/request-guard";
import { validasiIdTiket } from "@/lib/tiket-validasi";
import { ambilDetailTiket } from "@/lib/tiket";
import { getPool } from "@/lib/db";
import {
  periksaKelayakanKirimUlang,
  prosesNotifikasiSiapDiambil,
  cekSaklarNotifikasiAktif,
  type StatusNotifikasi,
} from "@/lib/wa-notifikasi";

const DITOLAK = () => NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
const GALAT_SERVER = () =>
  NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });

type Konteks = { params: Promise<{ id: string }> };

function apakahRedirectNext(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e;
}

function logGalatAman(label: string, e: unknown): void {
  const kode =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : e instanceof Error
        ? e.name
        : "GALAT";
  console.error(`${label}:`, kode);
}

export async function POST(req: NextRequest, ctx: Konteks) {
  try {
    const sesi = await requireKasir();

    const tolak = periksaPermintaanUbah(req);
    if (tolak) return tolak;

    const { id: teksId } = await ctx.params;
    const id = validasiIdTiket(teksId);
    if (id === null) {
      return NextResponse.json(
        { error: "ID tiket harus berupa bilangan bulat positif.", field: "id" },
        { status: 400 }
      );
    }

    const pool = getPool();
    const cekRes = await pool.query(
      `SELECT status, alasan_dilewati, kode_galat, percobaan
       FROM wa_notifikasi
       WHERE order_id = $1 AND jenis = 'siap_diambil'`,
      [id]
    );

    if ((cekRes.rowCount ?? 0) === 0) {
      return NextResponse.json(
        { error: "Antrean notifikasi belum dibuat untuk tiket ini." },
        { status: 404 }
      );
    }

    const row = cekRes.rows[0];
    const saklarAktif = cekSaklarNotifikasiAktif();

    const kelayakan = periksaKelayakanKirimUlang(
      row.status as StatusNotifikasi,
      row.alasan_dilewati,
      row.kode_galat,
      saklarAktif
    );

    if (!kelayakan.boleh) {
      return NextResponse.json(
        {
          error: kelayakan.pesan,
          pesan: kelayakan.pesan,
          kode_konflik: kelayakan.kodeKonflik,
        },
        { status: 409 }
      );
    }

    // Catat aksi kirim ulang di audit_logs tanpa mencantumkan nomor WA
    await pool.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id)
       VALUES ('orders', $1, 'KIRIM_ULANG_NOTIFIKASI', $2::jsonb, $3::jsonb, $4)`,
      [
        id,
        JSON.stringify({ status_notifikasi_lama: row.status, percobaan_lama: row.percobaan }),
        JSON.stringify({ dipicu_oleh: "kasir", saklar_aktif: saklarAktif }),
        sesi.userId,
      ]
    );

    // Proses pengiriman ulang
    const hasil = await prosesNotifikasiSiapDiambil(id, {
      lewatiJeda: true,
      paksaKirimUlang: true,
      userId: sesi.userId,
    });

    const tiketTerbaru = await ambilDetailTiket(id);

    return NextResponse.json(
      {
        ok: hasil.ok,
        status: hasil.status,
        alasan_dilewati: hasil.alasan_dilewati ?? null,
        kode_galat: hasil.kode_galat ?? null,
        data: tiketTerbaru,
      },
      { status: 200 }
    );
  } catch (e) {
    if (e instanceof AksesDitolakError) return DITOLAK();
    if (apakahRedirectNext(e)) throw e;
    logGalatAman("POST /api/tiket/[id]/notifikasi gagal", e);
    return GALAT_SERVER();
  }
}
