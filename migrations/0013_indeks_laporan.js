// Migrasi 0013:
// Indeks performa untuk query agregasi Laporan Harian Operasional dan Dashboard (Phase 7A).
// 1. orders(tanggal_bayar) untuk filter laporan pembayaran diterima pada periode.
// 2. audit_logs(aksi, waktu) untuk filter ringkasan pembatalan tiket dan pembalikan pembayaran.
// Catatan: Hanya dijalankan di solemate_test selama pengujian. Jangan jalankan di database utama tanpa izin dan backup.

exports.up = (pgm) => {
  pgm.createIndex("orders", "tanggal_bayar", {
    name: "orders_tanggal_bayar_idx",
  });
  pgm.createIndex("audit_logs", ["aksi", "waktu"], {
    name: "audit_logs_aksi_waktu_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("audit_logs", ["aksi", "waktu"], {
    name: "audit_logs_aksi_waktu_idx",
  });
  pgm.dropIndex("orders", "tanggal_bayar", {
    name: "orders_tanggal_bayar_idx",
  });
};
