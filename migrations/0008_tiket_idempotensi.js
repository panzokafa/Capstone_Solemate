// Migrasi 0008:
// Tabel kunci idempotensi pembuatan tiket (ticket_idempotency) untuk mencegah pembuatan order ganda
// akibat pengiriman ulang formulir, jaringan tidak stabil, atau klik ganda kasir (Phase 5A perbaikan keamanan).
// Menyimpan key (PK), order_id (FK), user_id (FK), dan request_hash (SHA-256) untuk verifikasi konsistensi pemanggil.
// Hanya dijalankan pada database uji solemate_test; tidak dijalankan di database utama tanpa persetujuan.

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.createTable(
    "ticket_idempotency",
    {
      key: { type: "varchar(100)", primaryKey: true },
      order_id: {
        type: "integer",
        notNull: true,
        references: "orders(id)",
        onDelete: "CASCADE",
      },
      user_id: {
        type: "integer",
        notNull: true,
        references: "users(id)",
        onDelete: "CASCADE",
      },
      request_hash: {
        type: "varchar(64)",
        notNull: true,
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    }
  );

  pgm.createIndex("ticket_idempotency", "created_at");

  // Izin minimum eksplisit untuk solemate_app (pasca migrasi 0006):
  // SELECT (cek keberadaan kunci), INSERT (simpan kunci baru), DELETE (pembersihan kunci usang).
  // Tanpa UPDATE dan tanpa TRUNCATE.
  pgm.sql(`GRANT SELECT, INSERT, DELETE ON TABLE ticket_idempotency TO ${roleIdent};`);
  pgm.sql(`REVOKE TRUNCATE ON TABLE ticket_idempotency FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;
  pgm.sql(`REVOKE ALL ON TABLE ticket_idempotency FROM ${roleIdent};`);
  pgm.dropTable("ticket_idempotency");
};
