// Migrasi 0011 (Phase 6A.1):
// 1. Tambah kolom chat_hash (varchar(64), nullable) dan nomor_terverifikasi (boolean, not null, default true) pada orders.
// 2. Tambah indeks parsial orders_chat_hash_idx pada orders (chat_hash) WHERE chat_hash IS NOT NULL.
// 3. Perbarui trigger blokir_update_ilegal_orders agar chat_hash dan nomor_terverifikasi tidak dapat diubah setelah dibuat.

// 4. Berikan izin DELETE pada wa_messages untuk solemate_app (pembersihan data lama)
const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;
  // 1. Kolom baru pada orders
  pgm.addColumn("orders", {
    chat_hash: { type: "varchar(64)", notNull: false },
    nomor_terverifikasi: { type: "boolean", notNull: true, default: true },
  });

  // 2. Indeks parsial chat_hash
  pgm.createIndex("orders", ["chat_hash"], {
    name: "orders_chat_hash_idx",
    where: "chat_hash IS NOT NULL",
  });

  // 3. Perbarui fungsi trigger blokir_update_ilegal_orders
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

       IF NEW.chat_hash IS DISTINCT FROM OLD.chat_hash THEN
         RAISE EXCEPTION 'Kolom chat_hash pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       IF NEW.nomor_terverifikasi IS DISTINCT FROM OLD.nomor_terverifikasi THEN
         RAISE EXCEPTION 'Kolom nomor_terverifikasi pada orders tidak boleh diubah setelah tiket dibuat.';
       END IF;

       RETURN NEW;
     END;`
  );

  // 4. Izin DELETE wa_messages untuk pembersihan riwayat pesan usang
  pgm.sql(`GRANT DELETE ON TABLE wa_messages TO ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;
  pgm.sql(`REVOKE DELETE ON TABLE wa_messages FROM ${roleIdent};`);
  // Revert fungsi trigger ke versi 0010 (tanpa cek chat_hash dan nomor_terverifikasi)
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

  pgm.dropIndex("orders", ["chat_hash"], {
    name: "orders_chat_hash_idx",
  });

  pgm.dropColumn("orders", "nomor_terverifikasi");
  pgm.dropColumn("orders", "chat_hash");
};
