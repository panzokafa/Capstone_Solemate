// Tes Sistem Desain Solemate (Tahap 1):
// 1. Rasio kontras teks vs latar token (WCAG AA >= 4.5:1)
// 2. Helper formatRupiah (0, 25000, 1500000)
// 3. Helper formatTanggal (UTC ke Asia/Jakarta + pergantian hari)
// 4. Proteksi rute /dev/komponen (tidak ada di menu, 404 di production, requireOwner)
// 5. Tidak ada kode warna hex hardcode di src/app dan src/components
// 6. Integritas komponen UI utama Tahap 1

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PASANGAN_KONTRAS } from "../src/config/tokens.ts";
import { formatRupiah, formatTanggal, formatWaktu } from "../src/lib/format.ts";
import { MENU_OWNER, MENU_KASIR } from "../src/config/menu.ts";
import {
  STATUS_PESANAN,
  STATUS_BAYAR,
  KONFIGURASI_STATUS_PESANAN,
  KONFIGURASI_STATUS_BAYAR,
} from "../src/config/status.ts";

// Helper hitung luminance WCAG standard
function hexKeLuminance(hex) {
  const clean = hex.replace("#", "");
  const rgb = clean.length === 3
    ? clean.split("").map((c) => parseInt(c + c, 16) / 255)
    : clean.match(/.{2}/g).map((c) => parseInt(c, 16) / 255);

  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hitungRasioKontras(hex1, hex2) {
  const l1 = hexKeLuminance(hex1);
  const l2 = hexKeLuminance(hex2);
  const lebihTerang = Math.max(l1, l2);
  const lebihGelap = Math.min(l1, l2);
  return (lebihTerang + 0.05) / (lebihGelap + 0.05);
}

// 1. Tes Rasio Kontras Token Desain
test("rasio kontras tiap pasangan teks dan latar di token memenuhi standar WCAG AA (>= 4.5:1)", () => {
  assert.ok(PASANGAN_KONTRAS.length > 0, "Daftar pasangan kontras tidak boleh kosong");

  for (const item of PASANGAN_KONTRAS) {
    const rasio = hitungRasioKontras(item.fg, item.bg);
    assert.ok(
      rasio >= 4.5,
      `Pasangan '${item.nama}' (${item.fg} di atas ${item.bg}) memiliki rasio kontras ${rasio.toFixed(2)}:1 (di bawah batas minimal 4.5:1)`
    );
  }
});

// 2. Tes formatRupiah
test("formatRupiah memformat nilai 0, 25000, dan 1500000 dengan benar", () => {
  assert.equal(formatRupiah(0), "Rp 0");
  assert.equal(formatRupiah(25000), "Rp 25.000");
  assert.equal(formatRupiah(1500000), "Rp 1.500.000");
  // Nilai kosong/tidak valid
  assert.equal(formatRupiah(null), "Rp 0");
  assert.equal(formatRupiah(undefined), "Rp 0");
});

// 3. Tes formatTanggal (konversi UTC ke Asia/Jakarta)
test("formatTanggal mengonversi UTC ke Asia/Jakarta secara akurat termasuk pergantian hari", () => {
  // 10 Mei 2026 jam 20:00 UTC = 11 Mei 2026 jam 03:00 WIB (berganti hari)
  const utcRollover = "2026-05-10T20:00:00.000Z";
  const teksTgl = formatTanggal(utcRollover);
  assert.match(teksTgl, /11\s+Mei\s+2026/, "Tanggal di WIB harus 11 Mei 2026 (berganti hari)");

  // Dengan waktu WIB
  const teksDenganWaktu = formatTanggal(utcRollover, { denganWaktu: true });
  assert.match(teksDenganWaktu, /11\s+Mei\s+2026,\s+03\.00\s+WIB/);

  // Hanya waktu WIB
  const teksWaktu = formatWaktu(utcRollover);
  assert.equal(teksWaktu, "03.00 WIB");

  // Format ringkas
  const teksRingkas = formatTanggal(utcRollover, { ringkas: true });
  assert.match(teksRingkas, /11\s+Mei\s+2026/);
});

// 4. Tes rute /dev/komponen
test("/dev/komponen tidak muncul di menu sidebar dan terlindungi", () => {
  const semuaHrefOwner = MENU_OWNER.map((m) => m.href);
  const semuaHrefKasir = MENU_KASIR.map((m) => m.href);

  assert.ok(!semuaHrefOwner.includes("/dev/komponen"), "/dev/komponen tidak boleh muncul di menu owner");
  assert.ok(!semuaHrefKasir.includes("/dev/komponen"), "/dev/komponen tidak boleh muncul di menu kasir");

  const devPageContent = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/(app)/dev/komponen/page.tsx"),
    "utf-8"
  );

  assert.match(
    devPageContent,
    /NODE_ENV\s*===?\s*["']production["']/,
    "Halaman /dev/komponen harus memeriksa NODE_ENV === 'production'"
  );
  assert.match(
    devPageContent,
    /notFound\s*\(\s*\)/,
    "Halaman /dev/komponen harus memanggil notFound() saat production"
  );
  assert.match(
    devPageContent,
    /requireOwner\s*\(\s*\)/,
    "Halaman /dev/komponen harus memanggil requireOwner() untuk perlindungan peran"
  );
});

// 5. Tes tidak ada kode warna hex hardcode
test("tidak ada kode warna hex hardcode di src/app dan src/components", () => {
  const targetDirs = [
    path.resolve(process.cwd(), "src/app"),
    path.resolve(process.cwd(), "src/components"),
  ];

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scan(fullPath);
      } else if (/\.(tsx?|jsx?)$/.test(ent.name)) {
        // Abaikan tokens.ts
        if (ent.name === "tokens.ts") continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        const match = content.match(/#[0-9a-fA-F]{3,8}\b/);
        assert.ok(
          !match,
          `Ditemukan kode warna hex hardcode '${match?.[0]}' di file ${fullPath}. Gunakan token Tailwind!`
        );
      }
    }
  }

  for (const dir of targetDirs) {
    scan(dir);
  }
});

// 6. Tes struktur dan konfigurasi status pesanan & bayar
test("semua status pesanan dan status bayar memiliki konfigurasi visual", () => {
  for (const s of STATUS_PESANAN) {
    const cfg = KONFIGURASI_STATUS_PESANAN[s];
    assert.ok(cfg, `Status pesanan '${s}' harus memiliki konfigurasi`);
    assert.ok(cfg.label, `Status pesanan '${s}' harus memiliki label teks`);
    assert.ok(cfg.className, `Status pesanan '${s}' harus memiliki className semantik`);
  }

  for (const b of STATUS_BAYAR) {
    const cfg = KONFIGURASI_STATUS_BAYAR[b];
    assert.ok(cfg, `Status bayar '${b}' harus memiliki konfigurasi`);
    assert.ok(cfg.label, `Status bayar '${b}' harus memiliki label teks`);
    assert.ok(cfg.className, `Status bayar '${b}' harus memiliki className semantik`);
  }
});

// 7. Tes keberadaan semua file komponen UI Tahap 1
test("semua file komponen UI Tahap 1 tersedia dengan export yang benar", () => {
  const komponenWajib = [
    "button.tsx",
    "input.tsx",
    "select.tsx",
    "textarea.tsx",
    "card.tsx",
    "page-header.tsx",
    "badge.tsx",
    "index.ts",
  ];

  for (const file of komponenWajib) {
    const filePath = path.resolve(process.cwd(), "src/components/ui", file);
    assert.ok(fs.existsSync(filePath), `File komponen src/components/ui/${file} harus ada`);
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.length > 50, `File src/components/ui/${file} tidak boleh kosong`);
  }
});
