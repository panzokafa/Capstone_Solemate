// Migrasi 0012 (Phase 6B):
// 1. Tambah kolom notifikasi_wa_aktif (boolean, not null, default true) pada customers.
// 2. Buat tabel wa_notifikasi untuk antrean notifikasi keluar 'siap_diambil' (FR-24).
// 3. Tambah indeks & konstrain UNIQUE (order_id, jenis).
// 4. Batasi izin solemate_app: hanya SELECT, INSERT, UPDATE (tanpa DELETE / TRUNCATE).
// 5. Tambah trigger pencegahan DELETE dan TRUNCATE pada wa_notifikasi.

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  // 1. Kolom preferensi notifikasi pada customers
  pgm.addColumn("customers", {
    notifikasi_wa_aktif: {
      type: "boolean",
      notNull: true,
      default: true,
    },
  });

  // 2. Tabel wa_notifikasi
  pgm.createTable(
    "wa_notifikasi",
    {
      id: "id", // serial primary key
      order_id: {
        type: "integer",
        notNull: true,
        references: "orders(id)",
        onDelete: "RESTRICT",
      },
      jenis: {
        type: "varchar(32)",
        notNull: true,
      },
      status: {
        type: "varchar(16)",
        notNull: true,
      },
      alasan_dilewati: {
        type: "varchar(64)",
        notNull: false,
      },
      percobaan: {
        type: "integer",
        notNull: true,
        default: 0,
      },
      kode_galat: {
        type: "varchar(64)",
        notNull: false,
      },
      dibuat_pada: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("CURRENT_TIMESTAMP"),
      },
      diperbarui_pada: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("CURRENT_TIMESTAMP"),
      },
      terkirim_pada: {
        type: "timestamptz",
        notNull: false,
      },
    },
    {
      constraints: {
        check: [
          "status IN ('menunggu', 'mengirim', 'terkirim', 'gagal', 'dilewati')",
          "jenis IN ('siap_diambil')",
          "percobaan >= 0",
        ],
      },
    }
  );

  // 3. Konstrain unik (order_id, jenis)
  pgm.addConstraint("wa_notifikasi", "wa_notifikasi_order_jenis_unique", {
    unique: ["order_id", "jenis"],
  });

  // Indeks status dan pembaruan untuk antrean / pemantauan
  pgm.createIndex("wa_notifikasi", ["status", "diperbarui_pada"], {
    name: "wa_notifikasi_status_diperbarui_idx",
  });

  // 4. Trigger pemblokiran DELETE dan TRUNCATE pada wa_notifikasi
  pgm.createFunction(
    "blokir_hapus_wa_notifikasi",
    [],
    { language: "plpgsql", returns: "trigger", replace: true },
    `BEGIN
       RAISE EXCEPTION 'Baris pada wa_notifikasi tidak boleh dihapus atau di-truncate.';
     END;`
  );

  pgm.createTrigger("wa_notifikasi", "trg_blokir_hapus_wa_notifikasi", {
    when: "BEFORE",
    operation: "DELETE",
    level: "ROW",
    function: "blokir_hapus_wa_notifikasi",
  });

  pgm.createTrigger("wa_notifikasi", "trg_blokir_truncate_wa_notifikasi", {
    when: "BEFORE",
    operation: "TRUNCATE",
    level: "STATEMENT",
    function: "blokir_hapus_wa_notifikasi",
  });

  // 5. Izin akses solemate_app: SELECT, INSERT, UPDATE saja (tanpa DELETE / TRUNCATE)
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON TABLE wa_notifikasi TO ${roleIdent};`);
  pgm.sql(`GRANT USAGE, SELECT ON SEQUENCE wa_notifikasi_id_seq TO ${roleIdent};`);
  pgm.sql(`REVOKE DELETE, TRUNCATE ON TABLE wa_notifikasi FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.dropTrigger("wa_notifikasi", "trg_blokir_truncate_wa_notifikasi", { ifExists: true });
  pgm.dropTrigger("wa_notifikasi", "trg_blokir_hapus_wa_notifikasi", { ifExists: true });
  pgm.dropFunction("blokir_hapus_wa_notifikasi", [], { ifExists: true });

  pgm.sql(`REVOKE ALL ON TABLE wa_notifikasi FROM ${roleIdent};`);
  pgm.sql(`REVOKE ALL ON SEQUENCE wa_notifikasi_id_seq FROM ${roleIdent};`);

  pgm.dropTable("wa_notifikasi", { ifExists: true });
  pgm.dropColumn("customers", "notifikasi_wa_aktif", { ifExists: true });
};
