// Migrasi 0002: tabel sesi dan percobaan login.
// Sesi disimpan di server (bukan di cookie). Cookie hanya berisi ID sesi.

exports.up = (pgm) => {
  pgm.createTable(
    "sessions",
    {
      id: { type: "uuid", primaryKey: true },
      user_id: {
        type: "integer",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      // Salinan peran saat login; peran terbaru tetap dibaca dari users.
      peran: { type: "varchar(10)", notNull: true },
      ip: { type: "varchar(45)" },
      dibuat_pada: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      kedaluwarsa_pada: { type: "timestamptz", notNull: true },
    },
    {
      constraints: {
        check: "peran IN ('owner','kasir')",
      },
    }
  );
  pgm.createIndex("sessions", "user_id");
  pgm.createIndex("sessions", "kedaluwarsa_pada");

  // Percobaan login untuk pembatasan per akun dan per IP.
  // Disimpan di database supaya bertahan lintas proses/restart.
  pgm.createTable(
    "login_attempts",
    {
      id: { type: "serial", primaryKey: true },
      // Nama akun yang dicoba (bisa tidak cocok dengan user mana pun),
      // atau NULL kalau tidak ada nama yang dikirim.
      username: { type: "varchar(100)" },
      ip: { type: "varchar(45)" },
      berhasil: { type: "boolean", notNull: false, default: false },
      waktu: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    }
  );
  pgm.createIndex("login_attempts", ["username", "waktu"]);
  pgm.createIndex("login_attempts", ["ip", "waktu"]);
};

exports.down = (pgm) => {
  pgm.dropTable("login_attempts");
  pgm.dropTable("sessions");
};
