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
| 4–5 | CMS `/admin` dan sistem stok | berikutnya |

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
| `npm run db:reset` | Hapus database, migrasi ulang, dan seed |
| `node scripts/purge-legacy-css.mjs ../dummy-kompascom-product` | Bangun ulang CSS chrome kompas.com (footer, popup login) dari prototipe |

## Struktur

```
prisma/              skema, migrasi, seed + data sumber (seed-data/)
src/
  app.ts, server.ts  aplikasi Express
  web/routes.ts      route halaman + redirect URL prototipe (*.html)
  modules/catalog/   query katalog (produk, kurasi, koleksi, stok tersedia)
  modules/email/     daftar email pembeli, renderer (Handlebars + juice), data contoh, pratinjau
  view/              engine Handlebars per platform + mapper data → bentuk `storev2.*`
  lib/               prisma, format rupiah, deteksi device
views/
  desktop|mobile/    layouts/, partials/ (header store, footer), pages/ (15 halaman)
  shared/partials/   kartu produk, popup login
  emails/            template email pembeli (layouts/, partials/, satu file per email)
assets/sass/         store-v2.scss (sumber CSS store)
public/              css/ (hasil build), js/store-v2.js, images/store-v2/, vendor/kompas/ (CSS chrome)
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

URL lama prototipe (`koleksi.html?tab=…`, `detail.html?product=…`, dst.) di-redirect 301 ke route baru.

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
   - `PUBLIC_BASE_URL` = alamat Vercel-nya, mis. `https://store-xxx.vercel.app` (untuk link di email; isi setelah deploy pertama)
   - `WHATSAPP_NUMBER` = opsional
4. **Deploy.** Deploy *Production* otomatis menjalankan `prisma migrate deploy` lalu mengisi data awal kalau database
   masih kosong (`scripts/seed-if-empty.ts`); deploy berikutnya tidak menimpa data. Deploy *Preview* tidak mengubah database.

Setelah itu setiap push ke `main` otomatis tayang. Mode produksi menutup halaman khusus development
(`/__email`, `/__prototipe`). TLS database dibaca dari parameter URL: `sslaccept=strict` / `ssl-mode=VERIFY_*`
(sertifikat dicek, CA tambahan lewat `DATABASE_CA_CERT`) atau `sslaccept=accept_invalid_certs` / `ssl-mode=REQUIRED`.

## Pratinjau email pembeli

`http://localhost:3000/__email` (hanya di development) menampilkan semua template email dengan data contoh,
lengkap dengan subjek, preheader, dan tombol lebar Desktop / Mobile 375px. Satu email saja:
`/__email/<nama>`, mis. `/__email/pembayaran-berhasil`. Link & gambar di email memakai `PUBLIC_BASE_URL`.

## QA visual terhadap prototipe

Isi `PROTOTYPE_DIR=../dummy-kompascom-product/build` di `.env`. Build prototipe lalu tersedia di
`http://localhost:3000/__prototipe/desktop/store-v2/index.html` (hanya di development), satu origin dengan
aplikasi, sehingga keduanya bisa dibandingkan per elemen.
