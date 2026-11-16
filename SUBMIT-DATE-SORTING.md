# Tanggal submit dan pengurutan tabel

## Perilaku

- **Tanggal transaksi** adalah tanggal kejadian yang diisi pengguna. Filter laporan mingguan/bulanan tetap berdasarkan tanggal transaksi.
- **Tanggal submit** adalah waktu server saat transaksi pertama kali ditambahkan. Ditampilkan lengkap dengan jam/detik dalam WIB (Asia/Jakarta), tidak diinput pengguna, tidak berubah ketika transaksi diedit atau tanggal transaksi diganti.
- Sumber waktu adalah timestamp event pertama di log HOI_Events; histori lama otomatis mendapatkan tanggal submit dari event penambahannya, tanpa migrasi atau kolom baru di Sheet. Jika timestamp histori tidak tersedia/rusak, UI menampilkan Tidak tersedia dan tidak mengarang tanggal.
- Tabel memiliki dua kolom terpisah. Di HP, geser tabel ke samping untuk melihat semua kolom.
- Pilih urutan dari dropdown atau ketuk judul kolom Tanggal transaksi, Tanggal submit, atau Jumlah untuk membalik arah urutan. Keenam pilihan naik/turun tersedia. Tanda panah dan aria-sort mengikuti pilihan aktif.
- Pengurutan jumlah menggunakan nilai angka, bukan teks Rupiah. Tanggal submit diurutkan berdasarkan waktu sebenarnya; nilai yang tidak tersedia selalu diletakkan terakhir.
- Sorting mengikuti hasil pencarian/filter dan tetap dipertahankan ketika data disinkronkan atau halaman menu diganti selama halaman belum dimuat ulang. Default: tanggal transaksi terbaru; urutan seri dibuat deterministik.
- Ekspor CSV mengikuti urutan yang dipilih dan memiliki kolom Tanggal transaksi serta Tanggal submit (WIB).
- Konfirmasi kemungkinan duplikasi tetap berdasarkan nominal dan tanggal transaksi; tanggal submit tidak mengubah aturannya.

## Pemasangan pada Apps Script yang sudah berjalan

Ganti isi tiga file berikut pada project yang sama:

1. Storage.gs
2. Client.html
3. Index.html

File tema, Code.gs, manifest, akun, dan kunci akses tidak perlu diubah. Tidak perlu menjalankan setup ulang atau mengubah data Sheet. Simpan lalu Deploy → Manage deployments → Edit deployment aktif → New version → Deploy. URL /exec tetap sama. Refresh kedua HP setelah deployment. Commit GitHub sendiri tidak otomatis melakukan deployment.

## Validasi

```sh
node tests/submit-date-sorting.cjs
node tests/duplicate-confirmation.cjs
```

Pengujian meliputi histori lama, timestamp pertama yang tetap saat edit/backdating, penolakan timestamp palsu dari payload, event duplikat/konflik/hapus, keenam urutan, angka vs teks, nilai kosong, dan konversi UTC ke WIB.

UI diuji dengan Chromium headless pada desktop 1365×900 dan viewport mobile 390×844 menggunakan backend simulasi: sorting dropdown/header, aria-sort, kolom submit otomatis tanpa input manual, saldo tetap, ekspor CSV sesuai urutan, dan tabel mobile dapat digeser tanpa overflow halaman. Tidak ada error JavaScript. Uji ini bukan pengujian deployment Google atau HP fisik.
