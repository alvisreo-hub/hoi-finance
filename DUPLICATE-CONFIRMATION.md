# Konfirmasi kemungkinan transaksi duplikat

Saat menambah transaksi, HOI Finance mencari transaksi aktif dengan tanggal dan nominal yang sama persis di seluruh data Sheet, termasuk milik pengguna kedua. Jenis, kategori, nama, dan pencatat boleh berbeda.

- OK: simpan setelah konfirmasi.
- Batal: tidak ditambahkan; draft tetap di form.
- Edit transaksi tidak memicu konfirmasi tambah ini. Catatan terhapus tidak dihitung.
- Server memeriksa state terbaru di bawah ScriptLock. Bukti konfirmasi terikat akun, isi draft, event ID, dan ID/versi catatan yang cocok. Jika kumpulan catatan berubah sebelum penyimpanan, pengguna diminta konfirmasi lagi. Retry dari event yang berhasil tidak menggandakan transaksi.

## Memperbarui aplikasi Apps Script

1. Ganti isi Code.gs dan Client.html pada project Apps Script dengan kedua file versi branch ini.
2. Simpan. Tidak perlu mengubah file lain atau menjalankan setup ulang.
3. Deploy → Manage deployments → Edit deployment aktif → New version → Deploy.
4. URL /exec tetap sama. Refresh aplikasi di kedua HP.
5. Uji transaksi dengan tanggal/nominal sama; periksa Batal dan OK serta transaksi dari akun kedua.

Commit GitHub tidak otomatis memperbarui Apps Script.

## Pengujian

```sh
node tests/duplicate-confirmation.cjs
```

Lulus simulasi tanggal/nominal sama dan berbeda, lintas jenis, tambah vs edit, cancel/confirm, race pengguna kedua, retry idempotent, bukti konfirmasi basi/diubah, tombstone, sesi invalid, dan pelepasan lock. Pengujian memakai mock dan data buatan, tanpa mengakses Google Sheet asli. Deployment dan HP nyata belum diuji.
