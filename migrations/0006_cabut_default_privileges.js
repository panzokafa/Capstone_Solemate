// Migrasi 0006: cabut ALTER DEFAULT PRIVILEGES pada schema public yang sebelumnya
// memberi SELECT, INSERT, UPDATE pada tabel baru serta USAGE, SELECT pada sequence baru
// secara otomatis ke solemate_app untuk role yang menjalankan migrasi.
//
// Izin pada tabel dan sequence yang sudah ada TIDAK berubah. Objek baru berikutnya
// wajib diberi GRANT eksplisit sesuai prinsip hak minimum.

const USER = "solemate_app";

exports.up = (pgm) => {
  const roleIdent = `"${USER}"`;
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE ON TABLES FROM ${roleIdent};`
  );
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${roleIdent};`
  );
};

exports.down = (pgm) => {
  const roleIdent = `"${USER}"`;
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ${roleIdent};`
  );
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${roleIdent};`
  );
};
