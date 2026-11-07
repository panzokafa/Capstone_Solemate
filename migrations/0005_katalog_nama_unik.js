// Migrasi 0005: nama layanan AKTIF tidak boleh kembar (tanpa membedakan huruf besar/kecil
// dan spasi di pinggir). Ditegakkan di database lewat indeks unik parsial, jadi dua request
// serentak pun tidak bisa menyelipkan nama kembar. Mengaktifkan kembali layanan yang namanya
// sudah dipakai layanan aktif juga ditolak oleh indeks yang sama.
//
// Catatan: constraint lama services_nama_key (unik, membedakan huruf besar/kecil, semua baris)
// sengaja TIDAK diubah. Migrasi ini hanya menambah aturan.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX services_nama_aktif_unik
      ON services (LOWER(TRIM(nama)))
      WHERE aktif;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS services_nama_aktif_unik;`);
};
