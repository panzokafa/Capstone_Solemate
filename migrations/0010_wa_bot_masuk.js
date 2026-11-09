// Migrasi 0010 (Phase 6A):
// 1. Kolom serah_terima pada orders (nullable, CHECK: 'antar_sendiri' | 'jemput', hanya untuk sumber = 'wa')
//    beserta pembaruan trigger blokir_update_ilegal_orders agar serah_terima permanen.
// 2. wa_messages: customer_id nullable (DROP NOT NULL), tambah order_id (FK ke orders), dan indeks waktu.
// 3. wa_rate_limit: tabel pembatasan laju atomik pesan masuk bot WhatsApp per kunci (HMAC) & per kategori.
//    Hak eksplisit SELECT, INSERT, UPDATE, DELETE untuk solemate_app (tanpa TRUNCATE).

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  // ---------- 1. Kolom serah_terima pada orders & proteksi update ----------
  pgm.addColumn("orders", {
    serah_terima: { type: "varchar(20)" },
  });

  pgm.addConstraint("orders", "orders_serah_terima_check", {
    check: `(sumber = 'wa' AND (serah_terima IS NULL OR serah_terima IN ('antar_sendiri', 'jemput')))
            OR
            (sumber <> 'wa' AND serah_terima IS NULL)`,
  });

  pgm.createFunction(
    "blokir_update_ilegal_orders",
    [],
    { language: "plpgsql", returns: "trigger", replace: true },
    `BEGIN
       IF OLD.status_pesanan = 'Dibatalkan' THEN
         RAISE EXCEPTION 'Tiket yang sudah berstatus Dibatalkan bersifat final dan tidak boleh diubah lagi.';
       END IF;

       IF NEW.id IS DISTINCT FROM OLD.id THEN
         RAISE EXCEPTION 'Kolom id pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.kode_tiket IS DISTINCT FROM OLD.kode_tiket THEN
         RAISE EXCEPTION 'Kolom kode_tiket pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
         RAISE EXCEPTION 'Kolom customer_id pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.sumber IS DISTINCT FROM OLD.sumber THEN
         RAISE EXCEPTION 'Kolom sumber pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.serah_terima IS DISTINCT FROM OLD.serah_terima THEN
         RAISE EXCEPTION 'Kolom serah_terima pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.dibuat_oleh IS DISTINCT FROM OLD.dibuat_oleh THEN
         RAISE EXCEPTION 'Kolom dibuat_oleh pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.tanggal_masuk IS DISTINCT FROM OLD.tanggal_masuk THEN
         RAISE EXCEPTION 'Kolom tanggal_masuk pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.total IS DISTINCT FROM OLD.total THEN
         RAISE EXCEPTION 'Kolom total pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.estimasi_selesai IS DISTINCT FROM OLD.estimasi_selesai THEN
         RAISE EXCEPTION 'Kolom estimasi_selesai pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF OLD.siap_diambil_pada IS NOT NULL AND NEW.siap_diambil_pada IS DISTINCT FROM OLD.siap_diambil_pada THEN
         RAISE EXCEPTION 'Waktu siap_diambil_pada tidak boleh dikosongkan atau di-reset setelah terisi.';
       END IF;

       RETURN NEW;
     END;`
  );

  // ---------- 2. Penyesuaian wa_messages ----------
  pgm.alterColumn("wa_messages", "customer_id", {
    notNull: false,
  });

  pgm.addColumn("wa_messages", {
    order_id: {
      type: "integer",
      references: "orders",
      onDelete: "RESTRICT",
    },
  });

  pgm.createIndex("wa_messages", ["customer_id", "waktu"], {
    name: "wa_messages_customer_waktu_idx",
  });

  // ---------- 3. Tabel wa_rate_limit & hak minimum solemate_app ----------
  pgm.createTable(
    "wa_rate_limit",
    {
      kunci: { type: "varchar(100)", notNull: true },
      kategori: { type: "varchar(30)", notNull: true },
      hitungan: { type: "integer", notNull: true, default: 0 },
      window_mulai: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: {
        primaryKey: ["kunci", "kategori"],
        check: "hitungan >= 0",
      },
    }
  );

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wa_rate_limit TO ${roleIdent};`);
  pgm.sql(`REVOKE TRUNCATE ON TABLE wa_rate_limit FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.sql(`REVOKE ALL ON TABLE wa_rate_limit FROM ${roleIdent};`);
  pgm.dropTable("wa_rate_limit");

  pgm.dropIndex("wa_messages", ["customer_id", "waktu"], {
    name: "wa_messages_customer_waktu_idx",
  });
  pgm.dropColumn("wa_messages", "order_id");
  pgm.alterColumn("wa_messages", "customer_id", {
    notNull: true,
  });

  pgm.createFunction(
    "blokir_update_ilegal_orders",
    [],
    { language: "plpgsql", returns: "trigger", replace: true },
    `BEGIN
       IF OLD.status_pesanan = 'Dibatalkan' THEN
         RAISE EXCEPTION 'Tiket yang sudah berstatus Dibatalkan bersifat final dan tidak boleh diubah lagi.';
       END IF;

       IF NEW.id IS DISTINCT FROM OLD.id THEN
         RAISE EXCEPTION 'Kolom id pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.kode_tiket IS DISTINCT FROM OLD.kode_tiket THEN
         RAISE EXCEPTION 'Kolom kode_tiket pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
         RAISE EXCEPTION 'Kolom customer_id pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.sumber IS DISTINCT FROM OLD.sumber THEN
         RAISE EXCEPTION 'Kolom sumber pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.dibuat_oleh IS DISTINCT FROM OLD.dibuat_oleh THEN
         RAISE EXCEPTION 'Kolom dibuat_oleh pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.tanggal_masuk IS DISTINCT FROM OLD.tanggal_masuk THEN
         RAISE EXCEPTION 'Kolom tanggal_masuk pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.total IS DISTINCT FROM OLD.total THEN
         RAISE EXCEPTION 'Kolom total pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.estimasi_selesai IS DISTINCT FROM OLD.estimasi_selesai THEN
         RAISE EXCEPTION 'Kolom estimasi_selesai pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF OLD.siap_diambil_pada IS NOT NULL AND NEW.siap_diambil_pada IS DISTINCT FROM OLD.siap_diambil_pada THEN
         RAISE EXCEPTION 'Waktu siap_diambil_pada tidak boleh dikosongkan atau di-reset setelah terisi.';
       END IF;

       RETURN NEW;
     END;`
  );

  pgm.dropConstraint("orders", "orders_serah_terima_check");
  pgm.dropColumn("orders", "serah_terima");
};
