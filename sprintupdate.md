# Sprint Update

<!-- Sprint update adalah list fitur yang akan diimplementasikan dalam project. -->

1. salah satu fitur unggulan lainnya dari project kita ini adalah, setiap user dapat mengetahui sudah biaya pemakaiannya berapa, mulai dari token, dll. jadi detail
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Halaman **Pemakaian** (`/usage`): token masuk/keluar/cache, biaya Rp, per hari, per proyek, per model.
2. fitur skill, instruksi, plugin .user dapa create new skill, edit skill yang ada, hapus skill yang ada
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Kustomisasi → Instruksi / Skill / Plugin: buat, ubah (versi naik otomatis), hapus. Manifest plugin divalidasi.
3. di kustomisasi itu, di fitur skill, instruksi, plugin, user juga dapa melakukan configurasi / set skill, instruksi, plugin tersebut untuk project tertentu, atau global.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Tiap item bisa diset **Global** atau **khusus satu proyek**, pribadi atau seluruh ruang kerja.
4. admin / role admin bisa melakukan set berapa maksimal token / berapa rupiah (IDR) yang bisa digunakan oleh user dalam 1 bulan / 1 project.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Tab **Batas & kurs**: batas bulanan token/IDR per anggota atau default, global atau per proyek. Permintaan baru ditolak saat batas habis.
5. admin / role admin bisa mengetahui, jumlah token yang digunakan oleh user per project, atau global.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Tab **Tim**: pemakaian per anggota, global atau filter per proyek.
6. admin / role admin bisa mengetahui, berapa sisa token / rupiah (IDR) yang bisa digunakan oleh user dalam 1 bulan / 1 project.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Sisa kuota tampil per anggota (dan di halaman Pemakaian milik user).
7. admin / role admin bisa melakukan reset token / rupiah (IDR) user.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Tombol reset di tab Tim. Non-destruktif: riwayat tetap ada, reset tercatat di log audit.
8. admin / role admin bisa mengetahui user siapa yang paling banyak menghabiskan token / rupiah (IDR) untuk project tertentu, atau global.
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Tabel Tim diurutkan dari pemakai terbesar (biaya), lengkap dengan porsi %.
9. admin / role admin bisa tahu user pakai prompt / token itu untuk project apa atau untuk apa saja
   - ✅ **Selesai** — 2026-11-05 23:11 WIB. Klik nama anggota → rincian per proyek, percakapan, dan model. **Hanya metadata**; isi prompt sengaja tidak ditampilkan (privasi).

---

## Catatan status (diperbarui 2026-11-05 23:11 WIB)

- ✅ = fitur (database, API, UI) sudah jadi dan sudah dicoba di Postgres lokal + browser. Tes unit: `pnpm test` hijau.
- ⏳ **Data pemakaian nyata baru muncul setelah agent loop ada.** Agent harus memanggil `recordUsage()` ([apps/server/src/usage.ts](apps/server/src/usage.ts)) di setiap respons model. Agent loop belum dibuat (runner masih skeleton), jadi halaman Pemakaian kosong sampai saat itu.
- ⏳ Agent juga belum membaca instruksi/skill/plugin (poin 2–3): CRUD dan scope sudah siap, penerapannya ke prompt agent ikut fase agent.
- Keputusan desain yang dipakai: "admin" = **admin sistem Orbs** dan **owner/admin tiap perusahaan** (admin sistem tidak perlu jadi owner; Admin Sistem → Organisasi juga menampilkan token & biaya bulan ini tiap perusahaan); periode bulan memakai WIB; kurs USD→IDR diatur admin (default 16.000) dan dibekukan per transaksi; pengecekan batas dilakukan sebelum permintaan dimulai, jadi permintaan yang sedang berjalan bisa melewati batas sedikit.
- Belum ada: notifikasi saat 80%/100% batas, ekspor CSV, uji UI untuk ubah/hapus item kustomisasi dan tampilan anggota biasa.

## Keputusan role & privasi — Paket Ketat (2026-11-05 23:50 WIB)

Tiga role: **System Admin** (kelola instalasi), **Admin perusahaan** (owner/admin), **User** (member).

- ✅ **Percakapan pribadi**: hanya pembuatnya yang bisa melihat, mengirim pesan, mengganti nama, dan membaca event-nya. Admin tidak melihat isi maupun judul (laporan pemakaian hanya menampilkan proyek, model, dan jumlah).
- ✅ **Admin hanya metadata**: tidak ada jalur baca isi percakapan.
- ✅ **owner dilebur** ke Admin di UI, dan perusahaan selalu punya minimal satu admin (berlaku untuk turunkan peran, hapus anggota, dan keluar).
- ✅ **Perusahaan hanya dibuat System Admin**; user lain melihat layar "Belum bergabung ke ruang kerja" dan masuk lewat undangan.
- ✅ **Dinonaktifkan di HTTP**: impersonasi, ubah password, ubah/hapus akun, hapus perusahaan. Akun diblokir, bukan dihapus.
- ✅ **Riwayat biaya aman**: `usage_ledger` tidak lagi terhapus ikut akun.
- ✅ Keputusan: proyek (nama dan file) **tetap dibagikan** ke seluruh anggota perusahaan. Hanya percakapan yang pribadi. Berbagi percakapan lewat proyek bisa dibahas nanti.
- ⏳ Percakapan milik anggota yang sudah keluar tidak bisa diakses siapa pun (pembuat satu-satunya yang berhak). Perlu kebijakan offboarding.
- ⏳ System Admin belum bisa mengatur batas/reset perusahaan lain tanpa jadi anggotanya (butuh pemilih perusahaan).

### Nama role di sistem (2026-11-05 23:48 WIB)

| Role             | Nilai tersimpan | Kolom         |
| ---------------- | --------------- | ------------- |
| System Admin     | `system.admin`  | `user.role`   |
| Admin perusahaan | `org.admin`     | `member.role` |
| User perusahaan  | `org.member`    | `member.role` |

- ✅ Data lama dimigrasikan (`0006_role_names.sql`): `admin` → `system.admin`; `owner`/`admin` → `org.admin`; `member` → `org.member`.
- ✅ Hanya `org.admin` dan `org.member` yang bisa disimpan sebagai peran perusahaan (undangan dengan nama lain ditolak).
- ✅ Akun tanpa peran sistem tetap bernilai `user` (bukan peran Orbs, hanya "bukan admin sistem").

### System Admin = god mode, kecuali isi percakapan (2026-11-05 23:56 WIB)

- ✅ Hapus perusahaan (wajib ketik nama; audit tetap tersimpan), ganti nama perusahaan.
- ✅ Masuk ke perusahaan mana pun tanpa jadi anggota (bertindak sebagai admin perusahaan di sana).
- ✅ Undang anggota, ubah peran, keluarkan anggota di perusahaan mana pun; boleh mencabut admin terakhir.
- ✅ Ubah password dan email akun orang lain (sesi akun itu dikeluarkan), hapus akun (riwayat biaya tetap).
- ✅ Buat instruksi/skill/plugin untuk seluruh perusahaan, hapus proyek, atur batas dan reset kuota.
- ❌ Tetap tertutup untuk semua role: isi dan judul percakapan. Impersonasi tetap dimatikan karena akan membuka isi percakapan.
- ⚠️ Ubah password/email secara teknis memungkinkan masuk sebagai orang itu dan membaca percakapannya. Pengamannya: sesi korban dikeluarkan (jadi terlihat) dan tercatat di audit. Pengaman yang lebih kuat bisa berupa tautan reset yang dikirim ke pemilik akun.
