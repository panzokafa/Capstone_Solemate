// Komponen form login: pilih pengguna + keypad PIN.
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
    if (pin.length < 6 && /\d/.test(k)) {
      setPin(pin + k);
    }
  }

  // Keyboard support: Enter untuk submit (hanya saat PIN sudah 6 digit)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && terpilih && pin.length === 6) void kirim();
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
        <p className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
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
              className={`flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all min-h-[44px] cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none ${
                terpilih?.id === u.id
                  ? "bg-primary text-white shadow-sm"
                  : "bg-surface-card text-text-body border border-border-card hover:bg-surface-hover"
              }`}
            >
              <span
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold font-outfit text-sm ${
                  terpilih?.id === u.id ? "bg-white/20 text-white" : "bg-surface-subtle text-primary"
                }`}
              >
                {u.nama.charAt(0)}
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-sm font-jakarta">{u.nama}</span>
                <span
                  className={`block text-xs font-jakarta ${
                    terpilih?.id === u.id ? "text-primary-light" : "text-text-muted"
                  }`}
                >
                  {u.peran === "owner" ? "Owner" : "Kasir"}
                </span>
              </span>
              {terpilih?.id === u.id && <span className="font-bold">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* PIN display */}
      <div className="w-full flex flex-col items-center gap-2">
        <div className="flex items-center justify-between w-full">
          <span className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider">
            PIN
          </span>
          <button
            type="button"
            onClick={() => setShowPin((s) => !s)}
            className="text-xs text-primary hover:underline font-jakarta font-medium cursor-pointer"
          >
            {showPin ? "Sembunyikan" : "Tampilkan"}
          </button>
        </div>
        <div className="w-full flex items-center justify-center gap-2 bg-surface-subtle rounded-2xl py-3 px-6 border border-border-card min-h-[48px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i < pin.length
                  ? "bg-primary"
                  : "bg-border-card"
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
        className={`text-sm text-danger text-center min-h-[20px] font-jakarta font-medium ${
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
            className={`min-h-[44px] h-12 rounded-xl font-bold font-outfit text-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              k === "C" || k === "⌫"
                ? "bg-surface-subtle text-text-muted hover:bg-surface-hover"
                : "bg-surface-card text-primary border border-border-card hover:bg-surface-hover"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Submit */}
      <Button
        type="button"
        onClick={() => void kirim()}
        disabled={!terpilih || pin.length !== 6 || loading}
        loading={loading}
        size="lg"
        className="w-full"
      >
        Masuk Sekarang
      </Button>
    </div>
  );
}
