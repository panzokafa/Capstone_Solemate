// Komponen form login: pilih pengguna + keypad PIN.
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

type Pengguna = { id: number; nama: string; peran: "owner" | "kasir" };

export function LoginForm({ pengguna }: { pengguna: Pengguna[] }) {
  const router = useRouter();
  const [terpilih, setTerpilih] = useState<Pengguna | null>(
    pengguna.length === 1 ? pengguna[0] : null
  );
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errRef = useRef<HTMLParagraphElement>(null);

  const kirim = useCallback(async () => {
    if (!terpilih || !pin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: terpilih.nama, pin }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Gagal masuk. Coba lagi.");
    } catch {
      setError("Gagal terhubung ke server.");
    } finally {
      setLoading(false);
    }
  }, [terpilih, pin, router]);

  function tekan(k: string) {
    if (loading) return;
    if (k === "C") {
      setPin("");
      return;
    }
    if (k === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length < 8 && /\d/.test(k)) {
      const next = pin + k;
      setPin(next);
      if (next.length >= 4 && terpilih) void kirim();
    }
  }

  // Keyboard support: enter untuk submit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && terpilih && pin) void kirim();
      if (/^[0-9]$/.test(e.key)) tekan(e.key);
      if (e.key === "Backspace") tekan("⌫");
      if (e.key === "Escape") tekan("C");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm">
      {/* Pilih pengguna */}
      <div className="w-full">
        <p className="font-[Outfit] text-sm text-[#635E54] uppercase tracking-wider mb-2">
          Pilih Pengguna
        </p>
        <div className="flex flex-col gap-2">
          {pengguna.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                setTerpilih(u);
                setPin("");
              }}
              className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all ${
                terpilih?.id === u.id
                  ? "bg-[#133B63] text-white shadow-md"
                  : "bg-white text-[#1d1b16] border border-[#e5ded3] hover:bg-[#f9f3ea]"
              }`}
            >
              <span
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  terpilih?.id === u.id ? "bg-white/20 text-white" : "bg-[#e7dfd2] text-[#133B63]"
                }`}
              >
                {u.nama.charAt(0)}
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-sm">{u.nama}</span>
                <span
                  className={`block text-xs ${
                    terpilih?.id === u.id ? "text-[#d3e4ff]" : "text-[#635E54]"
                  }`}
                >
                  {u.peran === "owner" ? "Owner" : "Kasir"}
                </span>
              </span>
              {terpilih?.id === u.id && <span>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* PIN display */}
      <div className="w-full flex flex-col items-center gap-2">
        <div className="flex items-center justify-between w-full">
          <span className="font-[Outfit] text-sm text-[#635E54] uppercase tracking-wider">
            PIN
          </span>
          <button
            type="button"
            onClick={() => setShowPin((s) => !s)}
            className="text-xs text-[#133B63] hover:underline"
          >
            {showPin ? "Sembunyikan" : "Tampilkan"}
          </button>
        </div>
        <div className="w-full flex items-center justify-center gap-2 bg-white rounded-2xl py-3 px-6 border border-[#e5ded3] min-h-[48px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i < pin.length
                  ? showPin
                    ? "bg-[#133B63]"
                    : "bg-[#133B63]"
                  : "bg-[#e5ded3]"
              }`}
            >
              {showPin && i < pin.length && pin[i] && (
                <span className="sr-only">{pin[i]}</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Error */}
      <p
        ref={errRef}
        className={`text-sm text-[#ba1a1a] text-center min-h-[20px] ${
          error ? "" : "invisible"
        }`}
      >
        {error ?? "."}
      </p>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2 w-full max-w-[240px]">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => tekan(k)}
            disabled={loading}
            className={`h-12 rounded-xl font-bold text-lg transition-all active:scale-95 disabled:opacity-50 ${
              k === "C" || k === "⌫"
                ? "bg-[#f3ede4] text-[#635E54] hover:bg-[#ede5d8]"
                : "bg-white text-[#133B63] border border-[#e5ded3] hover:bg-[#f9f3ea]"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={() => void kirim()}
        disabled={!terpilih || !pin || loading}
        className="w-full py-3 rounded-full bg-[#133B63] text-white font-bold text-sm hover:bg-[#0c3b64] transition-all disabled:opacity-50 active:scale-[0.99]"
      >
        {loading ? "Memverifikasi..." : "Masuk Sekarang"}
      </button>

      {/* Link absen */}
      <a
        href="/absensi"
        className="text-xs text-[#635E54] hover:text-[#133B63] hover:underline"
      >
        Absen Karyawan (Clock-in / Clock-out)
      </a>
    </div>
  );
}
