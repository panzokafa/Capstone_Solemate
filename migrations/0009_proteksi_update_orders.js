// Migrasi 0009 (Phase 5B):
// 1. Kolom siap_diambil_pada (timestamptz, nullable) pada orders + indeks parsial status 'Siap diambil'
//    untuk perhitungan penanda & filter tiket lama belum diambil (FR-17) di zona Asia/Jakarta.
// 2. Constraint CHECK orders_pembayaran_konsisten_check (NOT VALID -> cek pelanggaran -> VALIDATE CONSTRAINT):
//    - status_bayar = 'Lunas' mensyaratkan metode_bayar IS NOT NULL dan tanggal_bayar IS NOT NULL.
//    - status_bayar = 'Belum bayar' mensyaratkan metode_bayar IS NULL dan tanggal_bayar IS NULL.
// 3. Trigger BEFORE UPDATE pada orders yang:
//    - Menolak perubahan apa pun bila OLD.status_pesanan = 'Dibatalkan' (bersifat final).
//    - Menolak perubahan kolom permanen (id, kode_tiket, customer_id, sumber, dibuat_oleh,
//      tanggal_masuk, total, estimasi_selesai).
//    - Menolak pengosongan atau pengubahan siap_diambil_pada setelah terisi (tidak boleh di-reset).
// 4. Mencabut hak UPDATE pada tabel order_items dari solemate_app.

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  // ---------- 1. Kolom & indeks siap_diambil_pada ----------
  pgm.addColumn("orders", {
    siap_diambil_pada: { type: "timestamptz" },
  });

  pgm.createIndex("orders", "siap_diambil_pada", {
    name: "orders_siap_diambil_idx",
    where: "status_pesanan = 'Siap diambil'",
  });

  // ---------- 2. CHECK konsistensi pembayaran (NOT VALID -> cek baris -> VALIDATE) ----------
  pgm.sql(`
    ALTER TABLE orders
      ADD CONSTRAINT orders_pembayaran_konsisten_check
      CHECK (
        (status_bayar = 'Lunas' AND metode_bayar IS NOT NULL AND tanggal_bayar IS NOT NULL)
        OR
        (status_bayar = 'Belum bayar' AND metode_bayar IS NULL AND tanggal_bayar IS NULL)
      ) NOT VALID;
  `);

  pgm.sql(`
    DO $$
    DECLARE
      jml integer;
      daftar text;
    BEGIN
      SELECT
        COUNT(*)::int,
        STRING_AGG(kode_tiket || ' (id=' || id || ', status_bayar=' || status_bayar || ')', ', ' ORDER BY id)
      INTO jml, daftar
      FROM orders
      WHERE NOT (
        (status_bayar = 'Lunas' AND metode_bayar IS NOT NULL AND tanggal_bayar IS NOT NULL)
        OR
        (status_bayar = 'Belum bayar' AND metode_bayar IS NULL AND tanggal_bayar IS NULL)
      );

      IF jml > 0 THEN
        RAISE EXCEPTION 'Ditemukan % baris orders yang melanggar konsistensi pembayaran sebelum VALIDATE CONSTRAINT: %', jml, daftar;
      END IF;
    END $$;
  `);

  pgm.sql(`
    ALTER TABLE orders
      VALIDATE CONSTRAINT orders_pembayaran_konsisten_check;
  `);

  // ---------- 3. Trigger BEFORE UPDATE pada orders ----------
  pgm.createFunction(
    "blokir_update_ilegal_orders",
    [],
    { language: "plpgsql", returns: "trigger" },
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

  pgm.createTrigger("orders", "orders_proteksi_update", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "blokir_update_ilegal_orders",
    level: "row",
  });

  // ---------- 4. Cabut hak UPDATE pada order_items dari solemate_app ----------
  pgm.sql(`REVOKE UPDATE ON TABLE order_items FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.sql(`GRANT UPDATE ON TABLE order_items TO ${roleIdent};`);

  pgm.dropTrigger("orders", "orders_proteksi_update");
  pgm.dropFunction("blokir_update_ilegal_orders", []);

  pgm.sql(`ALTER TABLE orders DROP CONSTRAINT orders_pembayaran_konsisten_check;`);

  pgm.dropIndex("orders", "siap_diambil_pada", {
    name: "orders_siap_diambil_idx",
  });
  pgm.dropColumn("orders", "siap_diambil_pada");
};
