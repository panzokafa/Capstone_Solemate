// Migrasi 0003: user database khusus aplikasi dengan hak terbatas.
// Password TIDAK ditulis di file ini — dibaca dari env APP_DB_PASSWORD saat migrasi dijalankan.
//
// Jalankan dengan user admin (DATABASE_URL), bukan dengan solemate_app.

const USER = "solemate_app";

exports.up = async (pgm) => {
  const password = process.env.APP_DB_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "APP_DB_PASSWORD belum diisi di .env (minimal 8 karakter). " +
        "Isi dulu sebelum menjalankan migrasi 0003."
    );
  }

  // Nama role = identifier (pakai tanda kutip ganda).
  // Password dikirim sebagai parameter ($1) ke session config lewat pgm.db.query
  // supaya tidak pernah tercetak sebagai literal di log SQL node-pg-migrate.
  const roleIdent = `"${USER}"`;
  await pgm.db.query(
    "SELECT set_config('solemate.app_db_password', $1, false)",
    [String(password)]
  );

  pgm.sql(`
    DO $$
    DECLARE
      pw text := current_setting('solemate.app_db_password', true);
    BEGIN
      IF pw IS NULL OR length(pw) < 8 THEN
        RAISE EXCEPTION 'solemate.app_db_password belum diset pada sesi migrasi.';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${USER}') THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${USER}', pw);
      ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${USER}', pw);
      END IF;
    END $$;
  `);
  pgm.sql("SELECT set_config('solemate.app_db_password', '', false);");

  // Hak eksplisit per tabel. Tidak ada GRANT menyeluruh yang lalu dicabut.
  const grant = (table, privs) =>
    pgm.sql(`GRANT ${privs} ON TABLE ${table} TO ${roleIdent};`);

  grant("users", "SELECT, INSERT, UPDATE"); // tanpa DELETE
  grant("employees", "SELECT, INSERT, UPDATE");
  grant("customers", "SELECT, INSERT, UPDATE");
  grant("services", "SELECT, INSERT, UPDATE");
  grant("orders", "SELECT, INSERT, UPDATE"); // tanpa DELETE & TRUNCATE
  grant("order_items", "SELECT, INSERT, UPDATE");
  // audit_logs: hanya SELECT dan INSERT (append-only)
  grant("audit_logs", "SELECT, INSERT");
  grant("attendance", "SELECT, INSERT, UPDATE");
  grant("wa_messages", "SELECT, INSERT, UPDATE");
  // sessions: DELETE diperlukan untuk logout
  grant("sessions", "SELECT, INSERT, UPDATE, DELETE");
  // login_attempts: DELETE untuk membersihkan catatan lama
  grant("login_attempts", "SELECT, INSERT, DELETE");

  // Sequence (kolom serial) supaya aplikasi bisa mengisi id.
  pgm.sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent};`);

  // Default untuk tabel yang dibuat di kemudian hari.
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ${roleIdent};`
  );
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${roleIdent};`
  );

  // Pastikan TRUNCATE tidak punya hak (eksplisit, supaya teruji).
  pgm.sql(`REVOKE TRUNCATE ON TABLE orders, audit_logs FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${roleIdent};`);
  pgm.sql(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${roleIdent};`);
  pgm.sql(`DROP ROLE IF EXISTS ${roleIdent};`);
};
