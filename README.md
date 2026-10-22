# Store Kompas.com — New Flow

Storefront Store Kompas.com: **Express (TypeScript) + Handlebars SSR + MySQL (Prisma)**.
Tampilan diambil 1:1 dari prototipe **store-v2** (repo `dummy-kompascom-product`, branch `design-task3-store-v2`).
Rencana lengkap dan tahapan ada di [docs/PERENCANAAN.md](docs/PERENCANAAN.md).

## Status

| Tahap | Isi | Status |
|---|---|---|
| 0 | Setup proyek, MySQL lokal | ✅ |
| 1 | Skema database lengkap (katalog, stok, pesanan) + seed dari data prototipe | ✅ |
| 2 | Storefront: semua halaman dirender server dari MySQL | ✅ |
| 3 | Transaksi (keranjang, checkout, pesanan, reservasi stok) lewat API | berikutnya |
| 4 | CMS `/admin` MVP: katalog, tampilan store, stok, promo, pengguna & log | ✅ (branch `cms`) |
| 5 | Stok lanjutan (opname, impor/ekspor CSV), pesanan & laporan di CMS | berikutnya |

Di Tahap 2, keranjang, checkout, pesanan, alamat, promo, dan login masih memakai perilaku prototipe (`localStorage` di browser). Katalog, harga, stok, kurasi beranda, koleksi, pencarian, dan wishlist sudah dari database.

## Menjalankan

Butuh Node 22+ dan MySQL 8+ (dev: `brew install mysql && brew services start mysql`).

```bash
npm install
cp .env.example .env        # isi DATABASE_URL & SHADOW_DATABASE_URL
npm run db:migrate          # buat tabel
npm run db:seed             # isi data dari prototipe (MENGHAPUS data lama)
npm run dev                 # http://localhost:3000 (server + watch SASS)
```

Template desktop/mobile dipilih dari User-Agent. Untuk mencoba di browser desktop: `?device=mobile` / `?device=desktop` (disimpan di cookie), `?device=auto` untuk kembali otomatis.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server dengan auto-reload + kompilasi SASS |
| `npm test` | Tes unit & integrasi (butuh DB yang sudah di-seed) |
| `npm run typecheck` | Cek TypeScript |
| `npm run build` / `npm start` | Build produksi ke `dist/` lalu jalankan |
| `npm run db:studio` | Lihat/ubah isi database di browser (Prisma Studio) |
| `npm run db:seed-admin` | Buat akun CMS (Admin pertama + akun uji dev) tanpa menghapus data lain |
| `npm run db:reset` | Hapus database, migrasi ulang, dan seed |
| `node scripts/purge-legacy-css.mjs ../dummy-kompascom-product` | Bangun ulang CSS chrome kompas.com (footer, popup login) dari prototipe |

## Struktur

```
prisma/              skema, migrasi, seed + data sumber (seed-data/)
src/
  app.ts, server.ts  aplikasi Express
  web/routes.ts      route halaman + redirect URL prototipe (*.html)
  modules/catalog/   query katalog (produk, seksi & koleksi via FeedRules, stok tersedia)
  modules/storefront/ menu, Kategori Pilihan, pohon kategori (cache + invalidateStorefront)
  modules/email/     daftar email pembeli, renderer (Handlebars + juice), data contoh, pratinjau
  admin/             CMS /admin: auth/, permissions.ts, audit.ts, render.ts, modules/<modul>/
  adapters/storage/  penyimpanan file upload (lokal → nanti CDN)
  view/              engine Handlebars per platform + mapper data → bentuk `storev2.*`
  lib/               prisma, format rupiah, deteksi device, settings
views/
  desktop|mobile/    layouts/, partials/ (header store, footer), pages/ (15 halaman)
  shared/partials/   kartu produk, popup login
  admin/             layout, partial, dan halaman CMS (satu template responsif)
  emails/            template email pembeli (layouts/, partials/, satu file per email)
assets/sass/         store-v2.scss (CSS store), admin.scss (CSS CMS), _kds-tokens.scss (token KDS)
public/              css/ (hasil build), js/store-v2.js, cms/ (JS & ikon PWA CMS), images/, uploads/ (gitignore)
scripts/             utilitas (penyaring CSS chrome)
tests/               vitest + supertest
```

## Route

| Route | Halaman prototipe |
|---|---|
| `/` | index |
| `/produk?category=&sub=` | semua-produk |
| `/koleksi/:tab` | koleksi |
| `/cari?q=&category=` | search |
| `/produk/:slug` | detail / detail-apparel / detail-video (dipilih dari data produk) |
| `/wishlist`, `/keranjang`, `/checkout`, `/akun` | wishlist, cart, payment, account |
| `/pembayaran/:invoice`, `/pembayaran/:invoice/berhasil` | payment-instruction, payment-success |
| `/pesanan/:invoice`, `/pesanan/:invoice/diambil` | order-detail, pickup-success |
| `/seksi/:key` | halaman "Lihat semua" otomatis milik seksi produk (tampilan koleksi) |

URL lama prototipe (`koleksi.html?tab=…`, `detail.html?product=…`, dst.) di-redirect 301 ke route baru.

## CMS (/admin)

CMS untuk tim Editor, Marketing, CS / Order, Gudang, Finance, dan Admin. Tampilan responsif dengan sidebar di desktop dan menu bawah di HP, bisa dipasang sebagai aplikasi (PWA), dan memakai KOMPAS.com Design System.

**Masuk:** buka `http://localhost:3000/admin` (atau port server Anda).
- `npm run db:seed` (atau `npm run db:seed-admin`, yang **tidak** menyentuh data lain — pakai ini untuk database yang sudah berisi) membuat **Admin pertama** (`ADMIN_EMAIL`, default `ardi.suhanda@kompas.com`).
  - Password awalnya dibaca dari `ADMIN_INITIAL_PASSWORD` di `.env`. Kalau kosong, seed membuat password acak dan menuliskannya ke `.env`.
  - Password ini wajib diganti saat login pertama.
- Khusus development, seed juga membuat **akun uji per peran**: `admin|editor|marketing|cs|gudang|finance@cms.test`. Passwordnya `CMS_TEST_PASSWORD` di `.env` (dibuat otomatis kalau kosong).
- Akun lain dibuat Admin di menu **Pengguna CMS**. Password sementaranya tampil sekali dan wajib diganti.
- Akun yang sudah ada tidak diubah oleh seed ulang. Seed tetap **menghapus katalog dan pengaturan**, jadi perubahan dari CMS ikut hilang; gunakan hanya di development.

**Hak akses** (detail di `src/admin/permissions.ts`): Admin semua modul. Selain Admin:

| Peran | Bisa mengubah | Hanya melihat |
|---|---|---|
| Editor | Produk, Kategori, Banner & seksi, Koleksi & menu | Stok |
| Marketing | Promo, Banner & seksi | Produk, Kategori, Koleksi & menu |
| CS / Order | — | Produk, Stok, Promo |
| Gudang | Stok | Produk |
| Finance | — | Produk, Stok, Promo |

Semua akun bisa melihat log perubahannya sendiri; Admin melihat semua.

**Modul:**
- Dashboard
- Produk & varian: foto, deskripsi, spesifikasi, opsi Varian atau Warna × Ukuran + SKU, status & jadwal tayang, link luar, pratinjau draft
- Kategori
- Banner hero
- Seksi produk beranda (manual/otomatis, tanpa batas)
- Koleksi
- Menu & pintasan (menu bawah pencarian + Kategori Pilihan)
- Stok: barang masuk, penyesuaian, riwayat, stok menipis
- Promo
- Pengaturan: WhatsApp store, ambang stok
- Pengguna CMS
- Log perubahan

Semua perubahan langsung tampil di store.

**Keamanan:**
- Password di-hash (scrypt) dan sesi disimpan sebagai hash token. Cookie `skc_admin` memakai `Path=/admin`, HttpOnly, SameSite=Lax.
- CSRF dicegah dengan cek Origin dan token sesi.
- Percobaan login dibatasi per IP+email.
- Header CSP, `X-Frame-Options: DENY`, `no-store`, dan `noindex`.
- Upload foto (JPG/PNG/WebP ≤ 5 MB) dicek dari isi file dan disimpan di `public/uploads/` (gitignore).

**Belum ada:** modul pesanan, refund, dan laporan penjualan. Ketiganya menunggu transaksi pindah ke database (Tahap 3). Promo dari CMS baru dipakai checkout di tahap itu.

## Keamanan (audit OWASP, 15 Oktober 2026)

- **Store:** CSP tanpa skrip inline (`src/lib/security.ts`), `nosniff`, `X-Frame-Options`, `Referrer-Policy`,
  HSTS di produksi; halaman error tanpa stack trace kecuali developer di localhost; data dari CMS yang dirender
  lewat JavaScript di-escape.
- **CMS:** password scrypt (N=2^14, r=8, p=5, hash lama diperbarui saat login) + tolak password umum; sesi
  maks 12 jam (8 jam tanpa aktivitas), cookie HttpOnly/SameSite/Secure; CSRF = token sesi + origin persis +
  Fetch Metadata; batas login per IP+akun (5), per IP (30), per akun dari semua IP (20) / 15 menit, login gagal
  & diblokir tercatat di Log perubahan; akun uji `*@cms.test` hanya bisa login dari localhost saat development.
- **Data & alur:** link yang diisi di CMS hanya `/…` atau `https://` tanpa spasi/kutip; refund dikunci per
  pesanan & dicek ulang saat disetujui; retur ganda ditolak; 4 digit HP saat serah terima maks 5 kali salah.
- **Belum:** login dua langkah (passkey) untuk Admin/Finance, pembatas login di database (perlu sebelum hosting
  multi-instance seperti Vercel), masa berlaku password sementara, dan penghapusan EXIF foto unggahan.

## Membagikan link cepat (tanpa hosting)

Klik dua kali **`Bagikan Store.command`** di Finder: store dinyalakan di Mac (kalau belum), lalu muncul link publik
`https://….trycloudflare.com` yang otomatis tersalin. Link hidup selama jendela Terminal itu terbuka dan Mac
menyala (Mac dijaga tidak tidur); tiap kali dijalankan ulang alamatnya berganti. Butuh `cloudflared`
(`brew install cloudflared`) dan MySQL lokal yang menyala.

## Deploy ke Vercel (staging)

Build Vercel memakai `scripts/vercel-build.mjs` (Build Output API): file `public/` + CSS jadi file statis di CDN,
seluruh aplikasi Express + `views/` jadi satu fungsi Node di region Singapura (`sin1`). Database harus MySQL di
cloud karena Vercel tidak bisa menjangkau MySQL di laptop; contoh yang sudah disiapkan: **TiDB Cloud Starter**
(gratis, kompatibel MySQL, region AWS Singapura).

1. **Database (TiDB Cloud):** buat cluster *Starter* di region **AWS Singapore** → tombol **Connect** → buat
   password → salin connection string, bentuknya
   `mysql://USER:PASSWORD@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?sslaccept=strict`.
2. **Vercel:** *Add New → Project* → impor repo `kcmprodes-tech/store`. Pengaturan build dibaca otomatis dari
   `vercel.json` (Framework: Other, build `npm run vercel-build`).
3. **Environment Variables** (Production & Preview):
   - `DATABASE_URL` = connection string langkah 1 (wajib, akhiran `?sslaccept=strict`)
   - `DATABASE_POOL_SIZE` = `5`
   - `APP_ORIGIN` = alamat Vercel-nya, mis. `https://store-xxx.vercel.app` (link di email & QR pengambilan; isi setelah deploy pertama)
   - `WHATSAPP_NUMBER` = opsional
4. **Deploy.** Deploy *Production* otomatis menjalankan `prisma migrate deploy` lalu mengisi data awal kalau database
   masih kosong (`scripts/seed-if-empty.ts`); deploy berikutnya tidak menimpa data. Deploy *Preview* tidak mengubah database.

Setelah itu setiap push ke `main` otomatis tayang. Mode produksi menutup halaman khusus development
(`/__email`, `/__prototipe`). TLS database dibaca dari parameter URL: `sslaccept=strict` / `ssl-mode=VERIFY_*`
(sertifikat dicek, CA tambahan lewat `DATABASE_CA_CERT`) atau `sslaccept=accept_invalid_certs` / `ssl-mode=REQUIRED`.

Catatan CMS di Vercel: disk fungsi Vercel tidak permanen, jadi foto yang diunggah lewat CMS (`public/uploads/`,
`storage/`) perlu dipindah ke penyimpanan objek (adapter `src/adapters/storage/`) sebelum CMS dipakai di sana.

## Pratinjau email pembeli

`http://localhost:3000/__email` (hanya di development) menampilkan semua template email dengan data contoh,
lengkap dengan subjek, preheader, dan tombol lebar Desktop / Mobile 375px. Satu email saja:
`/__email/<nama>`, mis. `/__email/pembayaran-berhasil`. Link & gambar di email memakai `APP_ORIGIN`.

## QA visual terhadap prototipe

Isi `PROTOTYPE_DIR=../dummy-kompascom-product/build` di `.env`. Build prototipe lalu tersedia di
`http://localhost:3000/__prototipe/desktop/store-v2/index.html` (hanya di development), satu origin dengan
aplikasi, sehingga keduanya bisa dibandingkan per elemen.
