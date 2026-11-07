// Migrasi 0007:
// 1. Tabel penghitung kode tiket harian (ticket_counters) yang aman terhadap request serentak,
//    beserta GRANT eksplisit minimum untuk solemate_app (pasca migrasi 0006).
// 2. Trigger blokir DELETE dan TRUNCATE pada order_items agar sejajar dengan orders (FR-16, NFR-01).
// 3. Indeks tambahan pada order_items(order_id) dan orders(customer_id) untuk daftar & detail tiket.

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  // ---------- 1. ticket_counters ----------
  // Satu baris per tanggal terbit (zona Asia/Jakarta). Tanpa kolom serial agar tidak membuat sequence baru.
  pgm.createTable(
    "ticket_counters",
    {
      tanggal: { type: "date", primaryKey: true },
      terakhir: { type: "integer", notNull: true },
    },
    {
      constraints: {
        check: "terakhir >= 1",
      },
    }
  );

  // Hak minimum eksplisit untuk user aplikasi: baca, tambah hari baru, dan naikkan nomor urut.
  // Tanpa DELETE dan tanpa TRUNCATE.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON TABLE ticket_counters TO ${roleIdent};`);
  pgm.sql(`REVOKE TRUNCATE ON TABLE ticket_counters FROM ${roleIdent};`);

  // ---------- 2. trigger blokir hapus pada order_items ----------
  pgm.createFunction(
    "blokir_hapus_order_items",
    [],
    { language: "plpgsql", returns: "trigger" },
    `BEGIN
       RAISE EXCEPTION 'Item tiket tidak boleh dihapus. Gunakan status Dibatalkan pada tiket.';
       RETURN NULL;
     END;`
  );
  pgm.createTrigger("order_items", "order_items_blokir_hapus", {
    when: "BEFORE",
    operation: "DELETE",
    function: "blokir_hapus_order_items",
    level: "row",
  });
  pgm.createTrigger("order_items", "order_items_blokir_truncate", {
    when: "BEFORE",
    operation: "TRUNCATE",
    function: "blokir_hapus_order_items",
    level: "statement",
  });
  pgm.sql(`REVOKE TRUNCATE ON TABLE order_items FROM ${roleIdent};`);

  // ---------- 3. indeks relasi tiket ----------
  pgm.createIndex("order_items", "order_id");
  pgm.createIndex("orders", "customer_id");
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.dropIndex("orders", "customer_id");
  pgm.dropIndex("order_items", "order_id");

  pgm.dropTrigger("order_items", "order_items_blokir_truncate");
  pgm.dropTrigger("order_items", "order_items_blokir_hapus");
  pgm.dropFunction("blokir_hapus_order_items", []);

  pgm.sql(`REVOKE ALL ON TABLE ticket_counters FROM ${roleIdent};`);
  pgm.dropTable("ticket_counters");
};
