// Migrasi 0015 (Phase 9D):
// Pastikan role runtime `solemate_app` memiliki hak USAGE pada schema `public`
// (kompatibel dengan Postgres/Neon yang mencabut USAGE `public` dari PUBLIC).
// Kondisional agar idempoten saat dijalankan ulang maupun di DB yang sudah punya izin.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT has_schema_privilege('solemate_app', 'public', 'USAGE') THEN
        GRANT USAGE ON SCHEMA public TO "solemate_app";
      END IF;
    END $$;
  `);
};

exports.down = () => {
  // No-op disengaja: hak USAGE pada schema `public` bisa berasal dari default PUBLIC
  // atau hibah awal penyedia DB, sehingga mencabut USAGE saat rollback berisiko memutus
  // runtime `solemate_app` (dan REVOKE atas role tunggal tidak mencabut hibah dari PUBLIC).
};
