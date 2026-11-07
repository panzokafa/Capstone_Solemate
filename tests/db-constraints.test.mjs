// Tes aturan database. Setiap tes berjalan dalam transaksi lalu ROLLBACK,
// jadi tidak meninggalkan data di orders/audit_logs.
//
// Jalankan: npm run test:db

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { STATUS_PESANAN, STATUS_BAYAR, METODE_BAYAR } from "../src/config/order-status.ts";

const { Pool } = pg;
let pool;
let appPool;

before(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  appPool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
});

after(async () => {
  await pool.end();
  await appPool.end();
});

// Jalankan fn di dalam transaksi lalu selalu ROLLBACK.
// Satu transaksi = satu skenario, supaya kegagalan satu query tidak
// membuat query berikutnya ikut gagal ("transaction aborted").
async function inRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

// Jalankan satu query yang diharapkan gagal, di transaksinya sendiri.
// Kembalikan pesan error supaya bisa diperiksa.
async function expectTolak(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql, params);
    await client.query("ROLLBACK");
    return null; // tidak gagal = tidak ditolak
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return err.message;
  } finally {
    client.release();
  }
}

async function buatCustomer(client, nama = "Pelanggan Uji", nomor_wa = "6280000000001") {
  const r = await client.query(
    `INSERT INTO customers (nama, nomor_wa) VALUES ($1,$2) RETURNING id`,
    [nama, nomor_wa]
  );
  return r.rows[0].id;
}

async function buatOrder(client, overrides = {}) {
  const customerId = await buatCustomer(
    client,
    "Pelanggan Uji",
    overrides.nomor_wa ?? "6280000000001"
  );
  const r = await client.query(
    `INSERT INTO orders
       (kode_tiket, customer_id, sumber, tanggal_masuk, status_pesanan, status_bayar, total, alasan_batal)
     VALUES ($1,$2,$3,now(),$4,$5,$6,$7) RETURNING id`,
    [
      overrides.kode_tiket ?? "TEST-001",
      customerId,
      overrides.sumber ?? "toko",
      overrides.status_pesanan ?? "Belum dicuci",
      overrides.status_bayar ?? "Belum bayar",
      overrides.total ?? 0,
      overrides.alasan_batal ?? null,
    ]
  );
  return r.rows[0].id;
}

test("DELETE pada orders ditolak", async () => {
  await inRollback(async (c) => {
    const id = await buatOrder(c);
    await assert.rejects(
      () => c.query("DELETE FROM orders WHERE id = $1", [id]),
      /Tiket tidak boleh dihapus/
    );
  });
});

test("TRUNCATE pada orders ditolak (trigger)", async () => {
  const msg = await expectTolak("TRUNCATE orders CASCADE");
  assert.ok(msg && /Tiket tidak boleh dihapus/.test(msg), `pesan: ${msg}`);
});

test("UPDATE pada audit_logs ditolak", async () => {
  await inRollback(async (c) => {
    const r = await c.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi) VALUES ('orders',1,'uji') RETURNING id`
    );
    await assert.rejects(
      () => c.query("UPDATE audit_logs SET aksi='ubah' WHERE id=$1", [r.rows[0].id]),
      /hanya bisa ditambah/
    );
  });
});

test("DELETE pada audit_logs ditolak", async () => {
  await inRollback(async (c) => {
    const r = await c.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi) VALUES ('orders',1,'uji') RETURNING id`
    );
    await assert.rejects(
      () => c.query("DELETE FROM audit_logs WHERE id=$1", [r.rows[0].id]),
      /hanya bisa ditambah/
    );
  });
});

test("TRUNCATE pada audit_logs ditolak", async () => {
  const msg = await expectTolak("TRUNCATE audit_logs CASCADE");
  assert.ok(msg && /hanya bisa ditambah/.test(msg), `pesan: ${msg}`);
});

test("INSERT audit_logs tetap berhasil (append-only)", async () => {
  await inRollback(async (c) => {
    const r = await c.query(
      `INSERT INTO audit_logs (entitas, entitas_id, aksi) VALUES ('orders',1,'uji') RETURNING id`
    );
    assert.ok(r.rows[0].id);
  });
});

test("nomor_wa ganda ditolak", async () => {
  await inRollback(async (c) => {
    await buatCustomer(c, "A", "6281111111111");
    await assert.rejects(
      () => buatCustomer(c, "B", "6281111111111"),
      /duplicate key|unique/i
    );
  });
});

test("nomor_wa format salah ditolak", async () => {
  for (const salah of ["0812345678", "62812", "abc", "+6281234567890", "62"]) {
    const msg = await expectTolak(
      `INSERT INTO customers (nama, nomor_wa) VALUES ('X', $1)`,
      [salah]
    );
    assert.ok(msg && /check constraint|nomor_wa/i.test(msg), `seharusnya ditolak: ${salah} (${msg})`);
  }
});

test("status_pesanan di luar daftar ditolak", async () => {
  await inRollback(async (c) => {
    await assert.rejects(
      () => buatOrder(c, { status_pesanan: "Selesai", kode_tiket: "TEST-BAD" }),
      /check constraint/i
    );
  });
});

test("status_bayar di luar daftar ditolak", async () => {
  await inRollback(async (c) => {
    await assert.rejects(
      () => buatOrder(c, { status_bayar: "DP", kode_tiket: "TEST-BAD2" }),
      /check constraint/i
    );
  });
});

test("status Dibatalkan tanpa alasan_batal ditolak", async () => {
  await inRollback(async (c) => {
    const customerId = await buatCustomer(c, "P-Cancel", "6280000000099");
    await assert.rejects(
      () =>
        c.query(
          `INSERT INTO orders
             (kode_tiket, customer_id, sumber, tanggal_masuk, status_pesanan, status_bayar, total, alasan_batal)
           VALUES ('TEST-C', $1, 'toko', now(), 'Dibatalkan', 'Belum bayar', 0, NULL)`,
          [customerId]
        ),
      /check constraint/i
    );
  });
});

test("status Dibatalkan dengan alasan_batal diterima", async () => {
  await inRollback(async (c) => {
    const id = await buatOrder(c, {
      status_pesanan: "Dibatalkan",
      alasan_batal: "Pelanggan membatalkan",
      kode_tiket: "TEST-CANCEL-OK",
    });
    assert.ok(id);
  });
});

test("harga_saat_transaksi NULL ditolak", async () => {
  await inRollback(async (c) => {
    const orderId = await buatOrder(c);
    const svc = await c.query(
      `INSERT INTO services (nama, harga, estimasi_hari) VALUES ('Layanan Uji',0,0) RETURNING id`
    );
    await assert.rejects(
      () =>
        c.query(
          `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
           VALUES ($1,$2,'Sepatu',1,NULL)`,
          [orderId, svc.rows[0].id]
        ),
      /null value|not-null/i
    );
  });
});

test("clock-in ganda di hari yang sama ditolak", async () => {
  await inRollback(async (c) => {
    const emp = await c.query(`INSERT INTO employees (nama) VALUES ('Karyawan Uji') RETURNING id`);
    const id = emp.rows[0].id;
    await c.query(
      `INSERT INTO attendance (employee_id, tanggal, clock_in) VALUES ($1, CURRENT_DATE, now())`,
      [id]
    );
    await assert.rejects(
      () =>
        c.query(
          `INSERT INTO attendance (employee_id, tanggal, clock_in) VALUES ($1, CURRENT_DATE, now())`,
          [id]
        ),
      /duplicate key|unique/i
    );
  });
});

test("pin_hash bukan hash ditolak", async () => {
  for (const salah of ["123456", "pin-rahasia", ""]) {
    const msg = await expectTolak(
      `INSERT INTO users (nama, peran, pin_hash) VALUES ('Uji', 'kasir', $1)`,
      [salah]
    );
    assert.ok(msg && /check constraint|pin_hash/i.test(msg), `seharusnya ditolak: "${salah}" (${msg})`);
  }
});

test("pin_hash berformat hash diterima", async () => {
  await inRollback(async (c) => {
    const r = await c.query(
      `INSERT INTO users (nama, peran, pin_hash) VALUES ('Uji', 'kasir', '$2b$10$abcdefghijklmnopqrstuv') RETURNING id`
    );
    assert.ok(r.rows[0].id);
  });
});

test("daftar status di CHECK sama dengan src/config/order-status.ts", async () => {
  const c = await pool.connect();
  try {
    const res = await c.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'orders_chck'`
    );
    const def = res.rows[0].def;

    // Semua nilai konfigurasi harus ada di CHECK.
    for (const s of [...STATUS_PESANAN, ...STATUS_BAYAR, ...METODE_BAYAR]) {
      assert.ok(def.includes(`'${s}'`), `nilai '${s}' harus ada di CHECK orders`);
    }
    // Tidak boleh ada string IN (...) lain di luar daftar yang dikenal.
    const dikenal = new Set([...STATUS_PESANAN, ...STATUS_BAYAR, ...METODE_BAYAR, "wa", "toko"]);
    const allQuoted = [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const asing = allQuoted.filter((v) => !dikenal.has(v));
    assert.deepEqual(asing, [], `ada nilai di CHECK yang tidak dikenal konfigurasi: ${asing}`);
  } finally {
    c.release();
  }
});

test("order_items harga_saat_transaksi disalin dari katalog (bukan referensi)", async () => {
  await inRollback(async (c) => {
    const svc = await c.query(
      `INSERT INTO services (nama, harga, estimasi_hari) VALUES ('Clean',50000,2) RETURNING id`
    );
    const orderId = await buatOrder(c, { kode_tiket: "TEST-PRICE" });
    await c.query(
      `INSERT INTO order_items (order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi)
       VALUES ($1,$2,'Sepatu A',1,50000)`,
      [orderId, svc.rows[0].id]
    );
    await c.query(`UPDATE services SET harga=99999 WHERE id=$1`, [svc.rows[0].id]);
    const item = await c.query(
      `SELECT harga_saat_transaksi FROM order_items WHERE order_id=$1`,
      [orderId]
    );
    assert.equal(item.rows[0].harga_saat_transaksi, 50000);
  });
});

test("migrasi 0006: tabel baru dengan kolom serial buatan admin tidak memberi hak apa pun pada tabel dan sequence barunya ke solemate_app; izin lama tetap utuh", async () => {
  await pool.query(`DROP TABLE IF EXISTS public._uji_hak_default_0006`);
  await pool.query(
    `CREATE TABLE public._uji_hak_default_0006 (id serial PRIMARY KEY, ket text)`
  );
  try {
    // 1. Cek katalog hak PostgreSQL untuk seluruh jenis hak tabel pada tabel baru.
    const hakBaru = await pool.query(
      `SELECT priv, has_table_privilege('solemate_app', 'public._uji_hak_default_0006', priv) AS punya
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv`
    );
    for (const baris of hakBaru.rows) {
      assert.equal(
        baris.punya,
        false,
        `solemate_app tidak boleh punya hak ${baris.priv} pada tabel baru`
      );
    }

    // 2. Cek katalog hak PostgreSQL untuk seluruh jenis hak sequence pada sequence kolom serial baru.
    const hakSeqBaru = await pool.query(
      `SELECT priv, has_sequence_privilege('solemate_app', 'public._uji_hak_default_0006_id_seq', priv) AS punya
         FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) AS priv`
    );
    for (const baris of hakSeqBaru.rows) {
      assert.equal(
        baris.punya,
        false,
        `solemate_app tidak boleh punya hak ${baris.priv} pada sequence baru`
      );
    }

    // 3. Buktikan langsung sebagai solemate_app: setiap operasi tabel & sequence ditolak permission denied.
    await assert.rejects(
      appPool.query(`SELECT * FROM public._uji_hak_default_0006`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`INSERT INTO public._uji_hak_default_0006 (ket) VALUES ('uji')`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`UPDATE public._uji_hak_default_0006 SET ket = 'ubah'`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`DELETE FROM public._uji_hak_default_0006`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`TRUNCATE public._uji_hak_default_0006`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`SELECT nextval('public._uji_hak_default_0006_id_seq')`),
      /permission denied/i
    );
    await assert.rejects(
      appPool.query(`SELECT last_value FROM public._uji_hak_default_0006_id_seq`),
      /permission denied/i
    );
  } finally {
    await pool.query(`DROP TABLE IF EXISTS public._uji_hak_default_0006`);
  }

  // 4. Pastikan izin ke seluruh tabel yang sudah ada tetap persis seperti semula.
  const ekspektasi = [
    ["users", ["SELECT", "INSERT", "UPDATE"]],
    ["employees", ["SELECT", "INSERT", "UPDATE"]],
    ["customers", ["SELECT", "INSERT", "UPDATE"]],
    ["services", ["SELECT", "INSERT", "UPDATE"]],
    ["orders", ["SELECT", "INSERT", "UPDATE"]],
    ["order_items", ["SELECT", "INSERT", "UPDATE"]],
    ["audit_logs", ["SELECT", "INSERT"]],
    ["attendance", ["SELECT", "INSERT", "UPDATE"]],
    ["wa_messages", ["SELECT", "INSERT", "UPDATE"]],
    ["sessions", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["login_attempts", ["SELECT", "INSERT", "DELETE"]],
    ["login_rate_limit", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ];

  for (const [tabel, diizinkan] of ekspektasi) {
    const r = await pool.query(
      `SELECT priv, has_table_privilege('solemate_app', $1, priv) AS punya
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv`,
      [`public.${tabel}`]
    );
    for (const baris of r.rows) {
      const harus = diizinkan.includes(baris.priv);
      assert.equal(
        baris.punya,
        harus,
        `hak ${baris.priv} pada ${tabel} seharusnya ${harus}, dapat ${baris.punya}`
      );
    }
  }

  // 5. Pastikan izin USAGE dan SELECT pada seluruh sequence yang sudah ada tetap utuh.
  const sequenceLama = [
    "users_id_seq",
    "employees_id_seq",
    "customers_id_seq",
    "services_id_seq",
    "orders_id_seq",
    "order_items_id_seq",
    "audit_logs_id_seq",
    "attendance_id_seq",
    "wa_messages_id_seq",
    "login_attempts_id_seq",
    "login_rate_limit_id_seq",
  ];

  for (const seq of sequenceLama) {
    const r = await pool.query(
      `SELECT priv, has_sequence_privilege('solemate_app', $1, priv) AS punya
         FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) AS priv`,
      [`public.${seq}`]
    );
    for (const baris of r.rows) {
      const harus = baris.priv === "USAGE" || baris.priv === "SELECT";
      assert.equal(
        baris.punya,
        harus,
        `hak ${baris.priv} pada sequence ${seq} seharusnya ${harus}, dapat ${baris.punya}`
      );
    }
  }
});

test("migrasi 0003 tidak menyertakan password literal di teks SQL yang dicetak node-pg-migrate", async () => {
  const { createRequire } = await import("node:module");
  const requireCjs = createRequire(import.meta.url);
  const migrasi0003 = requireCjs("../migrations/0003_app_user.js");

  const pw = process.env.APP_DB_PASSWORD;
  assert.ok(pw && pw.length >= 8, "APP_DB_PASSWORD harus terisi saat tes");

  const sqlSteps = [];
  const dbQueries = [];
  const pgmTiruan = {
    sql(teks) {
      sqlSteps.push(String(teks));
    },
    db: {
      async query(teks) {
        dbQueries.push(String(teks));
      },
    },
  };

  await migrasi0003.up(pgmTiruan);

  const gabunganSql = sqlSteps.join("\n");
  assert.ok(
    !gabunganSql.includes(pw),
    "teks SQL migrasi 0003 tidak boleh mengandung nilai APP_DB_PASSWORD"
  );
  for (const q of dbQueries) {
    assert.ok(
      !q.includes(pw),
      "teks query pgm.db.query tidak boleh mengandung nilai APP_DB_PASSWORD secara literal"
    );
  }
});
