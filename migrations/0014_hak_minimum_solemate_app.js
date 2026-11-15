// Migrasi 0014 (Phase 9C-1):
// Penegakan prinsip hak akses minimum (least privilege) untuk role runtime `solemate_app`.
// Hanya mencabut hak yang terbukti tidak pernah digunakan di runtime (`src/`):
// 1. `users`: hanya SELECT di runtime (`login.ts`, `session.ts`); INSERT/UPDATE hanya oleh admin CLI (`create-user.mjs`, `reset-pin.mjs`).
// 2. `employees` dan `attendance`: fitur karyawan & absensi sedang nonaktif (`KARYAWAN_ABSENSI_AKTIF = false`).
//    Catatan reaktivasi: bila fitur karyawan & absensi diaktifkan kembali di masa depan, buat migrasi baru
//    untuk mengembalikan `GRANT INSERT, UPDATE ON TABLE employees, attendance` serta sequence terkait.
// 3. `login_attempts`: tabel usang sisa Phase 2-3 (digantikan oleh `login_rate_limit` sejak migrasi 0004).
// 4. `wa_messages`: hak SELECT, INSERT, UPDATE, dan DELETE TETAP DIPERTAHANKAN karena runtime bot WhatsApp
//    menjalankan `UPDATE wa_messages SET customer_id = $1, order_id = $2 WHERE id = $3` (`src/lib/wa-bot.ts`).

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.sql(`REVOKE INSERT, UPDATE ON TABLE users, employees, attendance FROM ${roleIdent};`);
  pgm.sql(
    `REVOKE USAGE, SELECT ON SEQUENCE users_id_seq, employees_id_seq, attendance_id_seq FROM ${roleIdent};`
  );

  pgm.sql(`REVOKE SELECT, INSERT, DELETE ON TABLE login_attempts FROM ${roleIdent};`);
  pgm.sql(`REVOKE USAGE, SELECT ON SEQUENCE login_attempts_id_seq FROM ${roleIdent};`);
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON TABLE users, employees, attendance TO ${roleIdent};`);
  pgm.sql(
    `GRANT USAGE, SELECT ON SEQUENCE users_id_seq, employees_id_seq, attendance_id_seq TO ${roleIdent};`
  );

  pgm.sql(`GRANT SELECT, INSERT, DELETE ON TABLE login_attempts TO ${roleIdent};`);
  pgm.sql(`GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO ${roleIdent};`);
};
