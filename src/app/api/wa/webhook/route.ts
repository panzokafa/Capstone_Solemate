// Endpoint Webhook Pesan Masuk WhatsApp (Phase 6A).
// Dipanggil langsung oleh WAHA (atau gateway alternatif di masa depan) tanpa n8n.
// Melakukan verifikasi HMAC-SHA512, pembatasan ukuran payload, dan perlindungan usia pesan.

import { after, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { apakahWaGatewayNonaktif } from "@/lib/env-produksi";
import {
  verifikasiTandaTanganWebhookWa,
  periksaUsiaPayload,
  prosesWebhookMasukWa,
  bersihkanCatatanWaUsang,
} from "@/lib/wa-bot";
import { MAKS_BYTES_WEBHOOK_WA } from "@/config/wa-bot";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // 0. Mode WA_GATEWAY_MODE=nonaktif: balas 503 tanpa memproses
    if (apakahWaGatewayNonaktif()) {
      return NextResponse.json(
        {
          ok: false,
          galat: "Layanan WhatsApp sedang dinonaktifkan.",
        },
        { status: 503 }
      );
    }

    const rawBody = await req.text();

    // 1. Batas ukuran payload masuk (Zero Trust)
    if (rawBody.length > MAKS_BYTES_WEBHOOK_WA) {
      return NextResponse.json(
        {
          ok: false,
          galat: `Ukuran payload melebihi batas maksimal ${MAKS_BYTES_WEBHOOK_WA} bytes.`,
        },
        { status: 413 }
      );
    }

    // 2. Verifikasi tanda tangan HMAC-SHA512
    const hmacHeader =
      req.headers.get("x-webhook-hmac") ||
      req.headers.get("X-Webhook-Hmac");

    const verif = verifikasiTandaTanganWebhookWa(rawBody, hmacHeader);
    if (!verif.ok) {
      return NextResponse.json(
        { ok: false, galat: verif.galat },
        { status: verif.kode }
      );
    }

    // 3. Parsing JSON payload & Validasi Objek
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { ok: false, galat: "Format body JSON tidak valid." },
        { status: 400 }
      );
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      console.warn(
        "[WA_BOT] Payload webhook bukan object yang valid, diabaikan."
      );
      return NextResponse.json(
        { ok: true, diabaikan: true, alasan: "Payload JSON bukan object." },
        { status: 200 }
      );
    }

    const payloadObj = payload as Record<string, unknown>;

    // 4. Verifikasi usia timestamp payload (Refinement 3 & 7)
    const subPayloadRaw = payloadObj.payload;
    const subPayload =
      typeof subPayloadRaw === "object" &&
      subPayloadRaw !== null &&
      !Array.isArray(subPayloadRaw)
        ? (subPayloadRaw as Record<string, unknown>)
        : payloadObj;

    const timestamp = subPayload.timestamp ?? payloadObj.timestamp;

    const cekUsia = periksaUsiaPayload(timestamp);
    if (!cekUsia.valid) {
      console.warn(
        `[WA_BOT] Timestamp payload webhook tidak valid atau kedaluwarsa: ${cekUsia.galat}`
      );
      return NextResponse.json(
        { ok: true, diabaikan: true, alasan: cekUsia.galat },
        { status: 200 }
      );
    }

    // 5. Proses pesan masuk secara reaktif
    const hasil = await prosesWebhookMasukWa(payloadObj);
    if (!hasil.ok && hasil.kode === 503) {
      return NextResponse.json(
        { ok: false, galat: hasil.galat },
        { status: 503 }
      );
    }

    // 6. Pembersihan oportunistik catatan usang dijadwalkan di dalam after() (next/server)
    if (hasil.ok && hasil.kodeTiket) {
      after(async () => {
        await bersihkanCatatanWaUsang(getPool());
      });
    }

    return NextResponse.json(
      {
        ok: true,
        duplikat: hasil.duplikat ?? false,
        diabaikan: hasil.diabaikan ?? false,
        kodeTiket: hasil.kodeTiket,
      },
      { status: 200 }
    );
  } catch {
    console.error(
      "[WA_WEBHOOK_ERROR] Kesalahan internal server saat memproses webhook."
    );
    return NextResponse.json(
      {
        ok: false,
        galat: "Terjadi kesalahan internal saat memproses webhook WhatsApp.",
      },
      { status: 500 }
    );
  }
}
