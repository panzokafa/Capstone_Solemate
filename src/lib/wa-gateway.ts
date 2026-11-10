// Adapter antarmuka pengiriman pesan WhatsApp (NFR-05).
// Memisahkan pengirim pesan di balik interface agar WAHA dapat diganti ke gateway resmi di masa depan.

export type KirimTeksParams = {
  chatId: string;
  teks: string;
};

export type HasilKirimTeks =
  | { ok: true; providerMessageId?: string }
  | { ok: false; galat: string };

export type HasilCekNomor =
  | { ok: true; terdaftar: boolean; chatId?: string | null }
  | { ok: false; galat: string };

export interface WaGatewayAdapter {
  kirimTeks(params: KirimTeksParams): Promise<HasilKirimTeks>;
  petakanLidKeNomor(lid: string): Promise<string | null>;
  cekNomorTerdaftar(nomorWa: string): Promise<HasilCekNomor>;
}

export const TTL_CACHE_LID_SUKSES_MS = 24 * 60 * 60 * 1000; // 24 jam
export const TTL_CACHE_LID_GAGAL_MS = 5 * 60 * 1000; // 5 menit

export class MockWaGatewayAdapter implements WaGatewayAdapter {
  public pesanTerkirim: KirimTeksParams[] = [];
  public simulasikanGagal: boolean = false;
  public pesanGagal: string = "Simulasi kegagalan gateway WhatsApp";
  public mockLidResponses: Map<
    string,
    { status: number; body?: { lid?: string; pn?: string | null } }
  > = new Map();
  public lidCache: Map<string, { nomor: string | null; expiredAt: number }> =
    new Map();
  public hitunganPanggilanLid: number = 0;
  public mockCheckExists: Map<
    string,
    { terdaftar: boolean; chatId?: string | null } | { galat: string }
  > = new Map();
  public simulasikanGagalCheckExists: boolean = false;
  public pesanGagalCheckExists: string = "Simulasi kegagalan cek nomor WhatsApp";

  async kirimTeks(params: KirimTeksParams): Promise<HasilKirimTeks> {
    if (this.simulasikanGagal) {
      return { ok: false, galat: this.pesanGagal };
    }
    this.pesanTerkirim.push({ ...params });
    return {
      ok: true,
      providerMessageId: `mock-msg-${Date.now()}-${this.pesanTerkirim.length}`,
    };
  }

  async petakanLidKeNomor(lid: string): Promise<string | null> {
    const sekarang = Date.now();
    const cached = this.lidCache.get(lid);
    if (cached && sekarang < cached.expiredAt) {
      return cached.nomor;
    }

    this.hitunganPanggilanLid++;
    const resp = this.mockLidResponses.get(lid);
    if (!resp || resp.status !== 200) {
      this.lidCache.set(lid, {
        nomor: null,
        expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
      });
      return null;
    }

    const body = resp.body;
    if (!body || body.lid !== lid) {
      this.lidCache.set(lid, {
        nomor: null,
        expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
      });
      return null;
    }

    if (typeof body.pn === "string" && /^[0-9]{8,15}@c.us$/.test(body.pn)) {
      const nomor = body.pn.split("@")[0];
      this.lidCache.set(lid, {
        nomor,
        expiredAt: sekarang + TTL_CACHE_LID_SUKSES_MS,
      });
      return nomor;
    }

    this.lidCache.set(lid, {
      nomor: null,
      expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
    });
    return null;
  }

  async cekNomorTerdaftar(nomorWa: string): Promise<HasilCekNomor> {
    if (this.simulasikanGagalCheckExists) {
      return { ok: false, galat: this.pesanGagalCheckExists };
    }
    const mocked = this.mockCheckExists.get(nomorWa);
    if (mocked) {
      if ("galat" in mocked) {
        return { ok: false, galat: mocked.galat };
      }
      return {
        ok: true,
        terdaftar: mocked.terdaftar,
        chatId: mocked.chatId !== undefined ? mocked.chatId : `${nomorWa}@c.us`,
      };
    }
    return { ok: true, terdaftar: true, chatId: `${nomorWa}@c.us` };
  }

  setMockLid(
    lid: string,
    pn: string | null,
    status: number = 200,
    returnLid?: string
  ): void {
    this.mockLidResponses.set(lid, {
      status,
      body: {
        lid: returnLid ?? lid,
        pn,
      },
    });
  }

  setMockCheckExists(
    nomorWa: string,
    terdaftar: boolean,
    chatId?: string | null
  ): void {
    this.mockCheckExists.set(nomorWa, { terdaftar, chatId });
  }

  setMockCheckExistsError(nomorWa: string, galat: string): void {
    this.mockCheckExists.set(nomorWa, { galat });
  }

  reset(): void {
    this.pesanTerkirim = [];
    this.simulasikanGagal = false;
    this.mockLidResponses.clear();
    this.lidCache.clear();
    this.mockCheckExists.clear();
    this.simulasikanGagalCheckExists = false;
    this.hitunganPanggilanLid = 0;
  }
}

export class WahaGatewayAdapter implements WaGatewayAdapter {
  private baseUrl: string;
  private apiKey: string;
  private session: string;
  private lidCache = new Map<string, { nomor: string | null; expiredAt: number }>();

  constructor(opts?: { baseUrl?: string; apiKey?: string; session?: string }) {
    const rawUrl =
      opts?.baseUrl !== undefined ? opts.baseUrl : process.env.WAHA_BASE_URL;
    if (!rawUrl || rawUrl.trim().length === 0) {
      throw new Error(
        "Konfigurasi WAHA_BASE_URL belum diatur di lingkungan server."
      );
    }
    this.baseUrl = rawUrl.trim();
    this.apiKey = opts?.apiKey ?? process.env.WAHA_API_KEY ?? "";
    this.session = opts?.session ?? process.env.WAHA_SESSION ?? "default";
  }

  async kirimTeks(params: KirimTeksParams): Promise<HasilKirimTeks> {
    try {
      const url = `${this.baseUrl.replace(/\/+$/, "")}/api/sendText`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
        },
        body: JSON.stringify({
          session: this.session,
          chatId: params.chatId,
          text: params.teks,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          galat: `WAHA HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return {
        ok: true,
        providerMessageId: data.id,
      };
    } catch (err) {
      return {
        ok: false,
        galat: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async petakanLidKeNomor(lid: string): Promise<string | null> {
    const sekarang = Date.now();
    const cached = this.lidCache.get(lid);
    if (cached && sekarang < cached.expiredAt) {
      return cached.nomor;
    }

    try {
      const url = `${this.baseUrl.replace(/\/+$/, "")}/api/${this.session}/lids/${encodeURIComponent(lid)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
        },
      });

      if (res.status !== 200) {
        this.lidCache.set(lid, {
          nomor: null,
          expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
        });
        return null;
      }

      const data = (await res.json().catch(() => null)) as {
        lid?: string;
        pn?: string | null;
      } | null;

      if (!data || data.lid !== lid) {
        this.lidCache.set(lid, {
          nomor: null,
          expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
        });
        return null;
      }

      if (typeof data.pn === "string" && /^[0-9]{8,15}@c.us$/.test(data.pn)) {
        const nomor = data.pn.split("@")[0];
        this.lidCache.set(lid, {
          nomor,
          expiredAt: sekarang + TTL_CACHE_LID_SUKSES_MS,
        });
        return nomor;
      }

      this.lidCache.set(lid, {
        nomor: null,
        expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
      });
      return null;
    } catch {
      this.lidCache.set(lid, {
        nomor: null,
        expiredAt: sekarang + TTL_CACHE_LID_GAGAL_MS,
      });
      return null;
    }
  }

  /**
   * Mengecek apakah nomor telepon terdaftar di WhatsApp melalui WAHA (Phase 6B, FR-24).
   * Endpoint WAHA: GET /api/contacts/check-exists?phone={phone}&session={session}
   * Dokumentasi: https://waha.devlike.pro/docs/how-to/contacts/
   * Respons JSON: { numberExists: boolean, chatId?: string | null }
   * Catatan keamanan: WAHA hanya menyediakan metode GET untuk endpoint ini sehingga nomor telepon berada di URL query string.
   */
  async cekNomorTerdaftar(nomorWa: string): Promise<HasilCekNomor> {
    try {
      const cleanNomor = nomorWa.replace(/[^0-9]/g, "");
      const params = new URLSearchParams({
        phone: cleanNomor,
        session: this.session,
      });
      const url = `${this.baseUrl.replace(/\/+$/, "")}/api/contacts/check-exists?${params.toString()}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status !== 200) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          galat: `WAHA HTTP ${res.status}: ${text.slice(0, 100)}`,
        };
      }

      const data = (await res.json().catch(() => null)) as {
        numberExists?: boolean;
        chatId?: string | null;
      } | null;

      if (!data || typeof data.numberExists !== "boolean") {
        return {
          ok: false,
          galat: "Format respons WAHA check-exists tidak dikenali.",
        };
      }

      return {
        ok: true,
        terdaftar: data.numberExists,
        chatId: data.chatId ?? (data.numberExists ? `${cleanNomor}@c.us` : null),
      };
    } catch (err) {
      return {
        ok: false,
        galat: err instanceof Error ? err.message : String(err),
      };
    }
  }

  bersihkanLidCache(): void {
    this.lidCache.clear();
  }
}

let instanceGatewayAktif: WaGatewayAdapter | null = null;

export function ambilWaGateway(): WaGatewayAdapter {
  if (instanceGatewayAktif) return instanceGatewayAktif;
  if (
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_DIST_DIR === ".next-test" ||
    process.env.START_TEST_SERVER === "1" ||
    process.env.WA_GATEWAY_MODE === "mock"
  ) {
    instanceGatewayAktif = new MockWaGatewayAdapter();
  } else {
    instanceGatewayAktif = new WahaGatewayAdapter();
  }
  return instanceGatewayAktif;
}

export function aturWaGatewayInstance(inst: WaGatewayAdapter | null): void {
  instanceGatewayAktif = inst;
}
