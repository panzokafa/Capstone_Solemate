// Migrasi 0004: pembatasan percobaan login atomik (login_rate_limit).
// Menggantikan login_attempts (dihapus — hanya dipakai lama untuk hitung baca-tulis).
// Satu baris per akun dan per IP; counter dinaikkan dengan satu UPDATE atomik.

exports.up = (pgm) => {
  // login_attempts TIDAK dihapus: berisi data lama (bisa tidak kosong).
  // Tabel lama dibiarkan; hanya tabel baru yang dibuat.

  pgm.createTable(
    "login_rate_limit",
    {
      id: { type: "serial", primaryKey: true },
      // 'akun' → kunci = nama akun; 'ip' → kunci = alamat IP.
      tipe: { type: "varchar(6)", notNull: true },
      kunci: { type: "varchar(100)", notNull: true },
      gagal: { type: "integer", notNull: true, default: 0 },
      // Awal jendela waktu; direset saat jendela habis atau login berhasil.
      window_mulai: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: {
        unique: ["tipe", "kunci"],
        check: "tipe IN ('akun','ip') AND gagal >= 0",
      },
    }
  );

  // Hak user aplikasi (user solemate_app dibuat di migrasi 0003).
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON login_rate_limit TO "solemate_app";`);
  pgm.sql(`GRANT USAGE, SELECT ON SEQUENCE login_rate_limit_id_seq TO "solemate_app";`);
};

exports.down = (pgm) => {
  // login_attempts tidak pernah dihapus di up, jadi tidak dibuat ulang di down.
  pgm.dropTable("login_rate_limit");
};
