// Migrasi awal: semua tabel inti Solemate.
// Aturan bisnis ditegakkan di level database (trigger + CHECK), bukan hanya di kode.

exports.up = (pgm) => {
  // ---------- users ----------
  // Akun login web. PIN hanya boleh disimpan sebagai hash (bcrypt/argon2).
  pgm.createTable(
    "users",
    {
      id: { type: "serial", primaryKey: true },
      nama: { type: "varchar(100)", notNull: true },
      peran: { type: "varchar(10)", notNull: true },
      pin_hash: { type: "text", notNull: true },
      aktif: { type: "boolean", notNull: true, default: true },
    },
    {
      constraints: {
        unique: ["nama"],
        check: "peran IN ('owner','kasir') AND pin_hash ~ '^(\\$2[aby]\\$|\\$argon2(id|i|d)\\$)'",
      },
    }
  );

  // ---------- employees ----------
  // Data karyawan untuk absensi. pin_hash boleh NULL sampai owner mengatur PIN.
  pgm.createTable(
    "employees",
    {
      id: { type: "serial", primaryKey: true },
      nama: { type: "varchar(100)", notNull: true },
      pin_hash: { type: "text" }, // nullable: PIN diatur belakangan
      aktif: { type: "boolean", notNull: true, default: true },
      user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
    },
    {
      constraints: {
        unique: ["nama"],
        // Kalau pin_hash terisi, wajib berformat hash.
        check: "pin_hash IS NULL OR pin_hash ~ '^(\\$2[aby]\\$|\\$argon2(id|i|d)\\$)'",
      },
    }
  );

  // ---------- customers ----------
  // nomor_wa disimpan baku: hanya angka, diawali 62 (contoh 6281234567890).
  pgm.createTable(
    "customers",
    {
      id: { type: "serial", primaryKey: true },
      nama: { type: "varchar(100)", notNull: true },
      nomor_wa: { type: "varchar(15)", notNull: true },
    },
    {
      constraints: {
        unique: ["nomor_wa"],
        check: "nomor_wa ~ '^62[0-9]{8,13}$'",
      },
    }
  );

  // ---------- services ----------
  // Sumber tunggal pricelist untuk web kasir dan bot WhatsApp.
  pgm.createTable(
    "services",
    {
      id: { type: "serial", primaryKey: true },
      nama: { type: "varchar(100)", notNull: true },
      harga: { type: "integer", notNull: true },
      estimasi_hari: { type: "integer", notNull: true },
      aktif: { type: "boolean", notNull: true, default: true },
    },
    {
      constraints: {
        unique: ["nama"],
        check: "harga >= 0 AND estimasi_hari >= 0",
      },
    }
  );

  // ---------- orders ----------
  // Tiket pesanan. Tidak boleh dihapus (trigger), hanya dibatalkan dengan alasan.
  pgm.createTable(
    "orders",
    {
      id: { type: "serial", primaryKey: true },
      kode_tiket: { type: "varchar(30)", notNull: true },
      customer_id: {
        type: "integer",
        notNull: true,
        references: "customers",
        onDelete: "RESTRICT",
      },
      sumber: { type: "varchar(4)", notNull: true },
      dibuat_oleh: {
        type: "integer",
        references: "users",
        onDelete: "SET NULL",
      },
      tanggal_masuk: { type: "timestamptz", notNull: true },
      estimasi_selesai: { type: "timestamptz" },
      status_pesanan: { type: "varchar(20)", notNull: true },
      status_bayar: { type: "varchar(15)", notNull: true },
      metode_bayar: { type: "varchar(10)" },
      tanggal_bayar: { type: "timestamptz" },
      total: { type: "integer", notNull: true },
      alasan_batal: { type: "text" },
    },
    {
      constraints: {
        unique: ["kode_tiket"],
        check: `sumber IN ('wa','toko')
          AND status_pesanan IN ('Belum dicuci','Diproses','Siap diambil','Sudah diambil','Dibatalkan')
          AND status_bayar IN ('Belum bayar','Lunas')
          AND (metode_bayar IS NULL OR metode_bayar IN ('Cash','Non-cash'))
          AND total >= 0
          AND (status_pesanan <> 'Dibatalkan' OR alasan_batal IS NOT NULL AND length(trim(alasan_batal)) > 0)
          AND (status_bayar = 'Lunas' OR tanggal_bayar IS NULL)`,
      },
    }
  );

  // ---------- order_items ----------
  // Harga disalin dari katalog saat tiket dibuat (FR-61), wajib per baris.
  pgm.createTable(
    "order_items",
    {
      id: { type: "serial", primaryKey: true },
      order_id: {
        type: "integer",
        notNull: true,
        references: "orders",
        onDelete: "RESTRICT",
      },
      service_id: {
        type: "integer",
        notNull: true,
        references: "services",
        onDelete: "RESTRICT",
      },
      deskripsi_barang: { type: "varchar(200)", notNull: true },
      jumlah: { type: "integer", notNull: true },
      harga_saat_transaksi: { type: "integer", notNull: true },
    },
    {
      constraints: {
        check: "jumlah > 0 AND harga_saat_transaksi >= 0",
      },
    }
  );

  // ---------- audit_logs ----------
  // Append-only: hanya bisa ditambah (trigger blokir UPDATE/DELETE/TRUNCATE).
  pgm.createTable(
    "audit_logs",
    {
      id: { type: "serial", primaryKey: true },
      entitas: { type: "varchar(50)", notNull: true },
      entitas_id: { type: "integer", notNull: true },
      aksi: { type: "varchar(30)", notNull: true },
      nilai_lama: { type: "jsonb" },
      nilai_baru: { type: "jsonb" },
      user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
      waktu: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    }
  );

  // ---------- attendance ----------
  // Satu baris per karyawan per hari; clock_in/clock_out di baris yang sama.
  pgm.createTable(
    "attendance",
    {
      id: { type: "serial", primaryKey: true },
      employee_id: {
        type: "integer",
        notNull: true,
        references: "employees",
        onDelete: "RESTRICT",
      },
      tanggal: { type: "date", notNull: true },
      clock_in: { type: "timestamptz", notNull: true },
      clock_out: { type: "timestamptz" },
    },
    {
      constraints: {
        unique: ["employee_id", "tanggal"],
        check: "clock_out IS NULL OR clock_out >= clock_in",
      },
    }
  );

  // ---------- wa_messages ----------
  // Pelacak pesan WhatsApp; provider_message_id unik untuk cegah duplikat webhook.
  pgm.createTable(
    "wa_messages",
    {
      id: { type: "serial", primaryKey: true },
      customer_id: {
        type: "integer",
        notNull: true,
        references: "customers",
        onDelete: "RESTRICT",
      },
      arah: { type: "varchar(6)", notNull: true },
      isi: { type: "text", notNull: true },
      waktu: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      provider_message_id: { type: "text" },
    },
    {
      constraints: {
        check: "arah IN ('masuk','keluar')",
      },
    }
  );
  pgm.addConstraint("wa_messages", "wa_messages_provider_message_id_unique", {
    unique: ["provider_message_id"],
  });

  // ---------- trigger: orders tidak bisa dihapus ----------
  pgm.createFunction(
    "blokir_hapus_orders",
    [],
    { language: "plpgsql", returns: "trigger" },
    `BEGIN
       RAISE EXCEPTION 'Tiket tidak boleh dihapus. Gunakan status Dibatalkan dengan alasan.';
       RETURN NULL;
     END;`
  );
  pgm.createTrigger("orders", "orders_blokir_hapus", {
    when: "BEFORE",
    operation: "DELETE",
    function: "blokir_hapus_orders",
    level: "row",
  });
  pgm.createTrigger("orders", "orders_blokir_truncate", {
    when: "BEFORE",
    operation: "TRUNCATE",
    function: "blokir_hapus_orders",
    level: "statement",
  });

  // ---------- trigger: audit_logs append-only ----------
  pgm.createFunction(
    "blokir_ubah_audit",
    [],
    { language: "plpgsql", returns: "trigger" },
    `BEGIN
       RAISE EXCEPTION 'audit_logs hanya bisa ditambah, tidak bisa diubah atau dihapus.';
       RETURN NULL;
     END;`
  );
  pgm.createTrigger("audit_logs", "audit_blokir_update", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "blokir_ubah_audit",
    level: "row",
  });
  pgm.createTrigger("audit_logs", "audit_blokir_delete", {
    when: "BEFORE",
    operation: "DELETE",
    function: "blokir_ubah_audit",
    level: "row",
  });
  pgm.createTrigger("audit_logs", "audit_blokir_truncate", {
    when: "BEFORE",
    operation: "TRUNCATE",
    function: "blokir_ubah_audit",
    level: "statement",
  });

  // Index untuk filter daftar tiket (tanggal, status bayar).
  pgm.createIndex("orders", "tanggal_masuk");
  pgm.createIndex("orders", "status_bayar");
};

exports.down = (pgm) => {
  pgm.dropTrigger("audit_logs", "audit_blokir_truncate");
  pgm.dropTrigger("audit_logs", "audit_blokir_delete");
  pgm.dropTrigger("audit_logs", "audit_blokir_update");
  pgm.dropTrigger("orders", "orders_blokir_truncate");
  pgm.dropTrigger("orders", "orders_blokir_hapus");
  pgm.dropFunction("blokir_ubah_audit", []);
  pgm.dropFunction("blokir_hapus_orders", []);

  pgm.dropTable("wa_messages");
  pgm.dropTable("attendance");
  pgm.dropTable("audit_logs");
  pgm.dropTable("order_items");
  pgm.dropTable("orders");
  pgm.dropTable("services");
  pgm.dropTable("customers");
  pgm.dropTable("employees");
  pgm.dropTable("users");
};
