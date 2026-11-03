// Migrasi 0003: user database khusus aplikasi dengan hak terbatas.
// Password TIDAK ditulis di file ini — dibaca dari env APP_DB_PASSWORD saat migrasi dijalankan.
//
// Jalankan dengan user admin (DATABASE_URL), bukan dengan solemate_app.

const USER = "solemate_app";

exports.up = (pgm) => {
  const password = process.env.APP_DB_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "APP_DB_PASSWORD belum diisi di .env (minimal 8 karakter). " +
        "Isi dulu sebelum menjalankan migrasi 0003."
    );
  }

  // Nama role = identifier (pakai tanda kutip ganda). Password = string literal.
  const roleIdent = `"${USER}"`;
  const passLiteral = "'".concat(String(password).replace(/'/g, "''"), "'");

  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${USER}') THEN
        CREATE ROLE ${roleIdent} LOGIN PASSWORD ${passLiteral};
      ELSE
        ALTER ROLE ${roleIdent} WITH LOGIN PASSWORD ${passLiteral};
      END IF;
    END $$;
  `);

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
