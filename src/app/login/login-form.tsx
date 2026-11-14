// Komponen form login: input nama pengguna manual (+ ingat di perangkat) + keypad PIN 6 digit.
"use client";

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { MAKS_PANJANG_USERNAME } from "@/config/keamanan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KUNCI_USERNAME_TERAKHIR = "solemate_username_terakhir";

function bacaUsernameTersimpan(): string {
  try {
    const tersimpan = window.localStorage.getItem(KUNCI_USERNAME_TERAKHIR);
    if (typeof tersimpan === "string" && tersimpan.trim().length > 0) {
      return tersimpan.slice(0, MAKS_PANJANG_USERNAME);
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia atau diblokir browser.
  }
  return "";
}

function langgananStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function LoginForm() {
  const router = useRouter();
  const usernameTersimpan = useSyncExternalStore(
    langgananStorage,
    bacaUsernameTersimpan,
    () => ""
  );
  const [usernameEdit, setUsernameEdit] = useState<string | null>(null);
  const username = usernameEdit ?? usernameTersimpan;

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const usernameBersih = username.trim();
  const dapatKirim = usernameBersih.length > 0 && pin.length === 6 && !loading;

  const kirim = useCallback(async () => {
    const nama = username.trim();
    if (!nama || pin.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nama, pin }),
      });
      if (res.ok) {
        try {
          window.localStorage.setItem(KUNCI_USERNAME_TERAKHIR, nama);
        } catch {
          // Abaikan jika localStorage tidak tersedia atau diblokir browser.
        }
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
  }, [username, pin, router]);

  function ubahUsername(nilai: string) {
    setUsernameEdit(nilai);
    setError(null);
    if (nilai.trim().length === 0) {
      try {
        window.localStorage.removeItem(KUNCI_USERNAME_TERAKHIR);
      } catch {
        // Abaikan jika localStorage tidak tersedia atau diblokir browser.
      }
    }
  }

  function kosongkanUsername() {
    if (loading) return;
    setUsernameEdit("");
    setError(null);
    try {
      window.localStorage.removeItem(KUNCI_USERNAME_TERAKHIR);
    } catch {
      // Abaikan jika localStorage tidak tersedia atau diblokir browser.
    }
    usernameInputRef.current?.focus();
  }

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

  // Keyboard support: Enter untuk submit (hanya saat PIN sudah 6 digit),
  // jangan bajak tombol ketik saat fokus berada di dalam kolom input teks.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const fokusDiInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        Boolean(target?.isContentEditable);
      if (fokusDiInput) return;

      if (e.key === "Enter" && username.trim().length > 0 && pin.length === 6) {
        e.preventDefault();
        void kirim();
      }
      if (/^[0-9]$/.test(e.key)) tekan(e.key);
      if (e.key === "Backspace") tekan("⌫");
      if (e.key === "Escape") tekan("C");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dapatKirim) void kirim();
      }}
      noValidate
      className="flex flex-col items-center gap-6 w-full max-w-sm"
    >
      {/* Input nama pengguna manual */}
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex items-center justify-between w-full">
          <label
            htmlFor="login-username"
            className="font-outfit text-xs font-semibold text-text-muted uppercase tracking-wider"
          >
            Nama Pengguna
          </label>
          {username.length > 0 && (
            <button
              type="button"
              onClick={kosongkanUsername}
              disabled={loading}
              className="text-xs text-primary hover:underline font-jakarta font-medium cursor-pointer disabled:opacity-50"
            >
              Kosongkan
            </button>
          )}
        </div>
        <Input
          ref={usernameInputRef}
          id="login-username"
          name="username"
          type="text"
          value={username}
          onChange={(e) => ubahUsername(e.target.value)}
          placeholder="Masukkan nama pengguna"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={MAKS_PANJANG_USERNAME}
          disabled={loading}
        />
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
        type="submit"
        disabled={usernameBersih.length === 0 || pin.length !== 6 || loading}
        loading={loading}
        size="lg"
        className="w-full"
      >
        Masuk Sekarang
      </Button>
    </form>
  );
}
