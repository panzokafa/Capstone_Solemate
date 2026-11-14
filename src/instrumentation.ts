// Hook instrumentasi server Next.js (dijalankan sekali saat instance server dimulai).
// Memvalidasi variabel lingkungan produksi saat runtime (dilewati saat `next build`).
import { tegakkanEnvProduksi } from "./lib/env-produksi";

export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    tegakkanEnvProduksi(process.env);
  }
}
