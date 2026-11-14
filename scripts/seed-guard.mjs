// Penjaga izin eksekusi `scripts/seed.js` (Phase 9A).
// Di NODE_ENV=production menolak eksekusi (kodeKeluar 1) kecuali diberi flag eksplisit.

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} argv
 */
export function periksaIzinSeed(env = process.env, argv = []) {
  const flagIzinkan =
    argv.includes("--izinkan-produksi") ||
    env.SEED_IZINKAN_PRODUKSI === "true";

  if (env.NODE_ENV === "production") {
    if (flagIzinkan) {
      return { diizinkan: true, kodeKeluar: 0 };
    }
    return {
      diizinkan: false,
      kodeKeluar: 1,
      levelLog: "error",
      pesan:
        "Seed ditolak: NODE_ENV='production'. Skrip seed hanya untuk lingkungan development (gunakan --izinkan-produksi atau SEED_IZINKAN_PRODUKSI=true bila benar-benar disengaja).",
    };
  }

  if (env.NODE_ENV !== "development") {
    return {
      diizinkan: false,
      kodeKeluar: 0,
      levelLog: "info",
      pesan: "Seed dilewati: NODE_ENV bukan 'development'.",
    };
  }

  return { diizinkan: true, kodeKeluar: 0 };
}
