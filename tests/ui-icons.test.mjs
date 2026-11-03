// Tes integritas UI & Ikon:
// 1. Tidak ada sisa referensi material-symbols di src dan layout
// 2. menu.ts hanya memakai nama ikon yang terdaftar di PEMETAAN_IKON
// 3. Semua entri PEMETAAN_IKON memetakan ke komponen SVG valid
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MENU_OWNER, MENU_KASIR } from "../src/config/menu.ts";
import { PEMETAAN_IKON } from "../src/config/icons.ts";

test("tidak ada sisa referensi material-symbols di folder src dan layout", () => {
  const rootSrc = path.resolve(process.cwd(), "src");

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(tsx?|jsx?|css|html|json)$/.test(ent.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.doesNotMatch(
          content,
          /material-symbols/i,
          `File ${fullPath} masih memuat referensi material-symbols`
        );
        assert.doesNotMatch(
          content,
          /Material Symbols/i,
          `File ${fullPath} masih memuat referensi Material Symbols`
        );
        assert.doesNotMatch(
          content,
          /fonts\.googleapis\.com.*Material/i,
          `File ${fullPath} masih memuat link font Material Symbols`
        );
      }
    }
  }

  scanDir(rootSrc);
});

test("menu.ts hanya memakai nama ikon yang terdaftar di pemetaan ikon", () => {
  const ikonValid = new Set(Object.keys(PEMETAAN_IKON));
  assert.ok(ikonValid.size > 0, "Pemetaan ikon tidak boleh kosong");

  for (const m of MENU_OWNER) {
    assert.ok(
      ikonValid.has(m.ikon),
      `Ikon '${m.ikon}' pada menu owner (${m.label}) tidak ditemukan di PEMETAAN_IKON`
    );
  }

  for (const m of MENU_KASIR) {
    assert.ok(
      ikonValid.has(m.ikon),
      `Ikon '${m.ikon}' pada menu kasir (${m.label}) tidak ditemukan di PEMETAAN_IKON`
    );
  }
});

test("semua nama ikon di pemetaan terdefinisi dengan komponen SVG yang valid", () => {
  for (const [nama, komponen] of Object.entries(PEMETAAN_IKON)) {
    assert.ok(
      komponen && (typeof komponen === "function" || typeof komponen === "object"),
      `Komponen untuk ikon '${nama}' tidak valid`
    );
  }
});

