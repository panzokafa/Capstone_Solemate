// Validasi kesiapan produksi (Phase 9A):
// - Validasi variabel lingkungan saat runtime (bukan saat `next build`) dengan pola gagal tertutup
//   tanpa pernah membocorkan nilai rahasia ke pesan error atau log.
// - Fungsi murni berparameter `env` untuk penjaga rute dev (/dev/*, /detail-tiket),
//   header sinkron notifikasi (x-sync-notifikasi), dan mode gateway WhatsApp.

export const DAFTAR_PLACEHOLDER_RAHASIA = new Set([
  "ganti_dengan_string_acak_panjang",
  "ganti_dengan_string_acak_minimal_32_karakter",
  "ganti_dengan_kunci_rahasia_minimal_32_karakter",
  "ganti_kunci_hmac_ini",
  "ganti_password_ini",
  "ganti_app_password_ini",
  "ganti_api_key_ini",
  "placeholder",
  "changeme",
  "change-me",
  "secret",
  "your-secret-key",
  "your_secret_key",
  "example",
  "contoh",
  "test",
  "12345678901234567890123456789012",
  "00000000000000000000000000000000",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
]);

export type ModeWaGateway = "waha" | "nonaktif" | "mock";

export type HasilValidasiEnvProduksi =
  | { ok: true; dilewatiBuild?: boolean }
  | { ok: false; daftarGalat: string[]; pesan: string };

/**
 * Mengecek apakah proses sedang berada pada tahap `next build` (static generation / page data collection).
 * Saat `next build`, validasi rahasia runtime dilewati agar build di CI tanpa rahasia tidak gagal.
 */
export function apakahFaseBuildNext(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NEXT_PHASE === "phase-production-build";
}

export function adalahNilaiPlaceholder(nilai: string): boolean {
  const bersih = nilai.trim().toLowerCase();
  if (bersih.length === 0) return true;
  if (DAFTAR_PLACEHOLDER_RAHASIA.has(bersih)) return true;
  if (
    bersih.startsWith("ganti_") ||
    bersih.startsWith("<") ||
    bersih.includes("ganti_password_ini") ||
    bersih.includes("ganti_app_password_ini")
  ) {
    return true;
  }
  return false;
}

/**
 * Mengekstrak kode galat yang aman untuk dicatat ke log (hanya kode SQLSTATE/Node atau nama kelas Error,
 * TIDAK PERNAH memuat `err.message`, objek error mentah, nomor WA, nama pelanggan, atau rahasia).
 */
export function ekstrakKodeGalatAman(err: unknown, cadangan = "GALAT"): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const kode = (err as { code?: unknown }).code;
    if (typeof kode === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(kode)) {
      return kode;
    }
  }
  if (err instanceof Error && typeof err.name === "string" && err.name.length > 0) {
    return err.name;
  }
  return cadangan;
}

/**
 * Penjaga rute khusus pengembangan (/dev/* dan stub /detail-tiket).
 * Di produksi (`NODE_ENV === "production"`), seluruh pengunjung (termasuk anonim) mendapat 404.
 */
export function apakahRuteDevTerblokir(
  pathname: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV !== "production") return false;
  const p = pathname.trim();
  return (
    p === "/dev" ||
    p.startsWith("/dev/") ||
    p === "/detail-tiket" ||
    p.startsWith("/detail-tiket/")
  );
}

/**
 * Header `x-sync-notifikasi: 1` hanya dihormati di luar produksi (`NODE_ENV !== "production"`).
 * Di produksi, header ini selalu diabaikan agar pengiriman selalu melalui `after()`.
 */
export function apakahSinkronNotifikasiDiizinkan(
  headerSync: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV === "production") return false;
  return headerSync === "1";
}

/**
 * Menentukan mode gateway WhatsApp dengan aturan gagal tertutup di produksi:
 * - Di produksi: wajib eksplisit `'waha'` atau `'nonaktif'`. Kosong, `'mock'`, atau nilai lain ditolak.
 * - Di non-produksi: mendukung `'nonaktif'`, `'mock'` (default saat tes), atau `'waha'`.
 */
export function tentukanModeWaGateway(
  env: Record<string, string | undefined> = process.env
): ModeWaGateway {
  const mentah = env.WA_GATEWAY_MODE?.trim() ?? "";

  if (env.NODE_ENV === "production") {
    if (mentah === "waha" || mentah === "nonaktif") {
      return mentah;
    }
    if (mentah === "mock") {
      throw new Error(
        "Konfigurasi produksi tidak valid: WA_GATEWAY_MODE='mock' ditolak di produksi (hanya untuk pengujian)."
      );
    }
    throw new Error(
      "Konfigurasi produksi tidak valid: WA_GATEWAY_MODE wajib diatur secara eksplisit ke 'waha' atau 'nonaktif'."
    );
  }

  if (mentah === "nonaktif") return "nonaktif";
  if (mentah === "mock") return "mock";
  if (mentah === "waha") {
    const adalahModeTes =
      env.NODE_ENV === "test" ||
      env.NEXT_DIST_DIR === ".next-test" ||
      env.START_TEST_SERVER === "1";
    if (adalahModeTes) return "mock";
    return "waha";
  }

  const adalahModeTes =
    env.NODE_ENV === "test" ||
    env.NEXT_DIST_DIR === ".next-test" ||
    env.START_TEST_SERVER === "1";
  return adalahModeTes ? "mock" : "waha";
}

export function apakahWaGatewayNonaktif(
  env: Record<string, string | undefined> = process.env
): boolean {
  const mentah = env.WA_GATEWAY_MODE?.trim() ?? "";
  if (mentah === "nonaktif") return true;
  if (env.NODE_ENV === "production" && mentah !== "waha") return true;
  return false;
}

/**
 * Memvalidasi daftar origin pada `APP_ORIGIN`.
 * Di produksi, `APP_ORIGIN` wajib ada dan setiap entri wajib memakai skema `https://`.
 */
export function validasiDaftarAppOrigin(
  appOriginRaw: string | undefined,
  wajibHttps: boolean
): { ok: true; hosts: Set<string>; origins: Set<string> } | { ok: false; galat: string } {
  const bagian = (appOriginRaw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (wajibHttps && bagian.length === 0) {
    return {
      ok: false,
      galat: "APP_ORIGIN wajib diisi di produksi dengan alamat https:// aplikasi.",
    };
  }

  const hosts = new Set<string>();
  const origins = new Set<string>();

  for (const item of bagian) {
    if (adalahNilaiPlaceholder(item)) {
      return {
        ok: false,
        galat: "APP_ORIGIN masih mengandung nilai contoh/placeholder.",
      };
    }
    let parsed: URL;
    try {
      parsed = new URL(item);
    } catch {
      return {
        ok: false,
        galat: "APP_ORIGIN mengandung URL yang tidak valid.",
      };
    }
    if (wajibHttps && parsed.protocol !== "https:") {
      return {
        ok: false,
        galat: "APP_ORIGIN di produksi wajib menggunakan protokol https://.",
      };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        ok: false,
        galat: "APP_ORIGIN harus menggunakan protokol http:// atau https://.",
      };
    }
    hosts.add(parsed.host.toLowerCase());
    origins.add(parsed.origin.toLowerCase());
  }

  return { ok: true, hosts, origins };
}

/**
 * Memeriksa apakah header `Origin` diizinkan untuk permintaan mutasi (POST/PUT/PATCH/DELETE).
 * - TIDAK PERNAH mempercayai `x-forwarded-host` karena dapat dipalsukan klien.
 * - Di produksi (`NODE_ENV === "production"`), wajib `https:` dan cocok dengan `APP_ORIGIN`.
 * - Di non-produksi, menerima `Host` permintaan atau `APP_ORIGIN`.
 */
export function apakahOriginDiizinkan(
  originHeader: string | null | undefined,
  hostHeader: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!originHeader) return false;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return false;
  }

  const originNorm = parsedOrigin.origin.toLowerCase();
  const hostOrigin = parsedOrigin.host.toLowerCase();
  const adalahProduksi = env.NODE_ENV === "production";

  if (adalahProduksi) {
    if (parsedOrigin.protocol !== "https:") return false;
    const hasilAppOrigin = validasiDaftarAppOrigin(env.APP_ORIGIN, true);
    if (!hasilAppOrigin.ok) return false;
    return hasilAppOrigin.origins.has(originNorm);
  }

  const hostDiizinkan = new Set<string>();
  if (hostHeader && hostHeader.trim().length > 0) {
    hostDiizinkan.add(hostHeader.trim().toLowerCase());
  }

  for (const o of (env.APP_ORIGIN ?? "").split(",")) {
    const t = o.trim();
    if (!t) continue;
    try {
      hostDiizinkan.add(new URL(t).host.toLowerCase());
    } catch {
      // abaikan nilai APP_ORIGIN yang salah format di non-produksi
    }
  }

  return hostDiizinkan.has(hostOrigin);
}

export function evaluasiPermintaanUbah(
  req: { headers: { get(name: string): string | null } },
  env: Record<string, string | undefined> = process.env
): { ok: true } | { ok: false; status: 415 | 403; error: string } {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(ct)) {
    return {
      ok: false,
      status: 415,
      error: "Content-Type harus application/json.",
    };
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!apakahOriginDiizinkan(origin, host, env)) {
    return {
      ok: false,
      status: 403,
      error: "Asal permintaan tidak valid.",
    };
  }

  return { ok: true };
}

/**
 * Validasi seluruh variabel lingkungan wajib saat `NODE_ENV === "production"` (runtime).
 * Tidak pernah menyertakan nilai variabel/rahasia di dalam pesan galat.
 */
export function validasiEnvProduksi(
  env: Record<string, string | undefined> = process.env
): HasilValidasiEnvProduksi {
  if (env.NODE_ENV !== "production") {
    return { ok: true };
  }
  if (apakahFaseBuildNext(env)) {
    return { ok: true, dilewatiBuild: true };
  }

  const daftarGalat: string[] = [];

  // 1. DATABASE_URL_APP (wajib; TIDAK jatuh kembali ke DATABASE_URL admin)
  const dbUrlApp = env.DATABASE_URL_APP?.trim() ?? "";
  if (dbUrlApp.length === 0) {
    if ((env.DATABASE_URL?.trim() ?? "").length > 0) {
      daftarGalat.push(
        "DATABASE_URL_APP wajib diisi di produksi (fallback ke DATABASE_URL admin ditolak)."
      );
    } else {
      daftarGalat.push("DATABASE_URL_APP belum dikonfigurasi.");
    }
  } else {
    let parsedDb: URL | null = null;
    try {
      parsedDb = new URL(dbUrlApp);
    } catch {
      daftarGalat.push("DATABASE_URL_APP bukan URL koneksi PostgreSQL yang valid.");
    }
    if (parsedDb) {
      if (parsedDb.protocol !== "postgresql:" && parsedDb.protocol !== "postgres:") {
        daftarGalat.push(
          "DATABASE_URL_APP harus berskema postgres:// atau postgresql://."
        );
      }
      if (!parsedDb.hostname) {
        daftarGalat.push("DATABASE_URL_APP tidak memiliki hostname database.");
      }
      const pwd = decodeURIComponent(parsedDb.password || "");
      const usr = decodeURIComponent(parsedDb.username || "");
      if (!usr || !pwd || adalahNilaiPlaceholder(pwd)) {
        daftarGalat.push(
          "DATABASE_URL_APP belum memiliki kredensial valid atau masih memakai password contoh/placeholder."
        );
      }
      const sslmode = parsedDb.searchParams.get("sslmode")?.toLowerCase();
      const sslParam = parsedDb.searchParams.get("ssl")?.toLowerCase();
      if (
        sslmode === "disable" ||
        sslmode === "allow" ||
        sslmode === "prefer" ||
        sslmode === "no-verify" ||
        sslParam === "0" ||
        sslParam === "false"
      ) {
        daftarGalat.push(
          "DATABASE_URL_APP di produksi tidak boleh mematikan verifikasi SSL."
        );
      }
    }
  }

  // 2. Pengaturan SSL database di produksi (tolak pelemahan SSL)
  const rejectUnauth = env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (rejectUnauth === "false" || rejectUnauth === "0") {
    daftarGalat.push(
      "DB_SSL_REJECT_UNAUTHORIZED=false ditolak di produksi (verifikasi sertifikat SSL wajib aktif)."
    );
  }
  const dbSsl = env.DB_SSL?.trim().toLowerCase();
  if (dbSsl === "false" || dbSsl === "0") {
    daftarGalat.push("DB_SSL=false ditolak di produksi (koneksi database wajib SSL).");
  }

  // 3. SESSION_SECRET
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  if (sessionSecret.length === 0) {
    daftarGalat.push("SESSION_SECRET belum dikonfigurasi.");
  } else if (sessionSecret.length < 32) {
    daftarGalat.push("SESSION_SECRET kurang dari 32 karakter.");
  } else if (adalahNilaiPlaceholder(sessionSecret)) {
    daftarGalat.push("SESSION_SECRET masih menggunakan teks contoh/placeholder.");
  }

  // 4. APP_ORIGIN (wajib https di produksi)
  const hasilOrigin = validasiDaftarAppOrigin(env.APP_ORIGIN, true);
  if (!hasilOrigin.ok) {
    daftarGalat.push(hasilOrigin.galat);
  }

  // 5. WA_GATEWAY_MODE & kredensial WAHA
  const modeWa = env.WA_GATEWAY_MODE?.trim() ?? "";
  if (modeWa.length === 0) {
    daftarGalat.push(
      "WA_GATEWAY_MODE wajib diisi secara eksplisit di produksi ('waha' atau 'nonaktif')."
    );
  } else if (modeWa === "mock") {
    daftarGalat.push(
      "WA_GATEWAY_MODE='mock' ditolak di produksi (hanya diizinkan di lingkungan tes)."
    );
  } else if (modeWa !== "waha" && modeWa !== "nonaktif") {
    daftarGalat.push(
      "WA_GATEWAY_MODE tidak dikenal; nilai yang diizinkan di produksi hanya 'waha' atau 'nonaktif'."
    );
  } else if (modeWa === "waha") {
    const wahaUrl = env.WAHA_BASE_URL?.trim() ?? "";
    if (wahaUrl.length === 0) {
      daftarGalat.push("WAHA_BASE_URL wajib diisi saat WA_GATEWAY_MODE='waha'.");
    } else {
      try {
        const u = new URL(wahaUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          daftarGalat.push("WAHA_BASE_URL harus berskema http:// atau https://.");
        }
      } catch {
        daftarGalat.push("WAHA_BASE_URL bukan URL yang valid.");
      }
    }

    const wahaKey = env.WAHA_API_KEY?.trim() ?? "";
    if (wahaKey.length === 0) {
      daftarGalat.push("WAHA_API_KEY wajib diisi saat WA_GATEWAY_MODE='waha'.");
    } else if (adalahNilaiPlaceholder(wahaKey)) {
      daftarGalat.push("WAHA_API_KEY masih menggunakan teks contoh/placeholder.");
    }

    const wahaHmac = env.WAHA_WEBHOOK_HMAC_KEY?.trim() ?? "";
    if (wahaHmac.length === 0) {
      daftarGalat.push("WAHA_WEBHOOK_HMAC_KEY wajib diisi saat WA_GATEWAY_MODE='waha'.");
    } else if (wahaHmac.length < 32) {
      daftarGalat.push("WAHA_WEBHOOK_HMAC_KEY minimal 32 karakter.");
    } else if (adalahNilaiPlaceholder(wahaHmac)) {
      daftarGalat.push("WAHA_WEBHOOK_HMAC_KEY masih menggunakan teks contoh/placeholder.");
    }
  }

  if (daftarGalat.length > 0) {
    return {
      ok: false,
      daftarGalat,
      pesan: `[ENV_PRODUKSI_TIDAK_VALID] ${daftarGalat.join(" ")}`,
    };
  }

  return { ok: true };
}

export function tegakkanEnvProduksi(
  env: Record<string, string | undefined> = process.env
): void {
  const hasil = validasiEnvProduksi(env);
  if (!hasil.ok) {
    throw new Error(hasil.pesan);
  }
}
