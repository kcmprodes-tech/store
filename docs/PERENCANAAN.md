# Perencanaan Store Kompas.com (New Flow) — Node.js + MySQL

> Disetujui 13 Oktober 2026. Tahap 0–2 dikerjakan lebih dulu; Tahap 3–6 di sesi berikutnya.

## Status Tahap 4 — CMS MVP (13 Oktober 2026, branch `cms`)

**CMS MVP di `/admin` selesai** (branch `cms`, belum di-merge ke `main`). Cara masuk ada di [README](../README.md#cms-admin).

- **Prasyarat store (Langkah 1):** menu di bawah pencarian, menu Kategori (desktop & mobile), kartu Kategori Pilihan, dan seksi produk beranda kini dirender dari database. HTML 26 halaman × desktop/mobile dibandingkan dengan sebelum perubahan dan hasilnya identik (kecuali tag JSON label kategori di `/produk` & `/cari`). Dropdown kategori pencarian dan breadcrumb apparel juga dari DB.
  - Migrasi `storefront_from_db` ikut mengisi data setara template lama, jadi DB yang sudah ada cukup di-migrate tanpa seed ulang.
  - Halaman baru `/seksi/:key` = "Lihat semua" otomatis untuk seksi baru.
- **CMS:**
  - Login akun terpisah (scrypt), sesi ter-hash, CSRF, batas percobaan login, wajib ganti password saat login pertama.
  - 6 peran dengan matriks hak akses (`src/admin/permissions.ts`) dan log perubahan sebelum → sesudah.
  - Modul: Dasbor, Produk & varian, Kategori, Banner hero, Seksi produk, Koleksi, Menu & pintasan, Stok (barang masuk, penyesuaian, riwayat, stok menipis), Promo, Pengaturan, Pengguna CMS, Log.
  - Responsif (sidebar desktop, menu bawah di HP) + PWA (manifest + service worker), KOMPAS.com Design System.
- **Database:** 39 tabel, 5 migrasi (`storefront_from_db`, `cms_admin` baru).
- **Tes:** 131 tes otomatis.

Catatan & keputusan selama pengerjaan:
- **Kategori Pilihan** = daftar pintasan bebas (label, gambar, tujuan), disimpan di `navigation_items` bersama menu bawah pencarian.
- **Kategori disembunyikan** hanya hilang dari menu & filter; produknya tetap tayang.
- **Promo** dari CMS baru dipakai checkout di Tahap 3. Sampai saat itu checkout tetap memakai DJFXA54/PAYDAY25 bawaan prototipe.
- **Deskripsi produk** disimpan semantik (`h2.pdp-description-heading`, `ul > li`). Ikon centang ditambahkan saat dirender (`decorateDescription`).
- **Belum dikerjakan (sesuai rencana):** modul Pesanan, refund, dan laporan penjualan (menunggu Tahap 3), scan QR/barcode, notifikasi push, cache offline, dark mode, pustaka media, dan kolom SEO.

## Status implementasi (13 Oktober 2026)

**Tahap 0–2 selesai.** Cara menjalankan ada di [README](../README.md).

- **Database:** MySQL 26.7 (Homebrew), 34 tabel (katalog, stok, pengguna, transaksi), 2 migrasi.
- **Seed:** 36 produk, 212 SKU, 199 baris stok, 186 mutasi stok awal.
- **Storefront:** 15 halaman × desktop/mobile dirender server dari MySQL.
- **QA visual:** dibandingkan per elemen dengan build prototipe.
  - Identik: beranda, semua halaman detail, koleksi (8 tab), pencarian, wishlist, keranjang, checkout, halaman pembayaran & pesanan.
- **Tes:** 65 tes otomatis (`npm test`).

Penyesuaian terhadap rencana:
- **Route pembayaran** memakai `/pembayaran/:invoice` dan `/pembayaran/:invoice/berhasil` (bukan `/pesanan/:id/bayar`), supaya selector JS untuk link detail pesanan (`/pesanan…`) tidak bentrok.
- **Produk "Bundling Pesta Bola" (`source-18`)** sekarang ikut tampil di Semua produk dan kategori Buku (36 produk, prototipe 35).
- **Tombol WhatsApp "Butuh bantuan?"** dari chrome store lama (link placeholder `wa.me/xxxxx`) belum dibawa.
- **Tambahan setelah port:** kartu Dikirim di Daftar Pesanan punya tombol "Pesanan selesai". Kalau diklik, kartu pindah ke tab Selesai.

## Context
Prototipe **store-v2** sudah selesai didesain di sesi "Halaman store baru" (repo `dummy-kompascom-product`, branch `design-task3-store-v2`, disingkat **R** di bawah). Isinya 17 halaman desktop + 17 mobile, ditulis dengan Handlebars + SASS + vanilla JS. Semua datanya masih dummy:
- produk dari `R/db/kanal/storev2.json`
- keranjang, checkout, dan contoh pesanan di-hardcode di HTML
- pesanan, alamat, promo, dan login disimpan di `localStorage`

Prototipe ini akan dijadikan aplikasi sungguhan di folder baru `Store Kompas.com New Flow`. Backend memakai Node.js dan database MySQL, tampilan tetap sama, dan fondasinya disiapkan untuk **CMS** dan **sistem stok barang**.

**Keputusan (sudah dipilih user):**
- Frontend: Express SSR + Handlebars, memakai ulang template store-v2.
- Backend: Express + TypeScript + Prisma.
- Database dev: MySQL lewat Homebrew. Homebrew 6 sudah terpasang; MySQL dan Docker belum.
- Bayar, login, dan ongkir: mock lewat adapter, supaya nanti bisa diganti layanan asli.
- Template desktop & mobile tetap terpisah. Server memilih set template dari User-Agent.
- Chrome kompas.com: hanya footer + popup login kgOneTap yang dibawa. jQuery, slick, main-store.js v1, dan `header_2021` tidak dibawa.
- **Dikerjakan pertama: Tahap 0–2** (setup, database, storefront dari MySQL). Tahap 3–6 cukup didokumentasikan.


## Fakta penting dari prototipe (hasil eksplorasi)
- **CSS dan JS sama persis untuk desktop dan mobile:**
  - `R/sass/desktop/style-store-v2.scss` sama dengan versi mobile. Panjangnya ±10,6k baris, semua di-scope `.store-v2-content`, dan tidak memakai `@import`.
  - `R/build/desktop/asset/js/store-v2.js` sama dengan versi mobile. Panjangnya 2.196 baris, vanilla, tanpa jQuery.
- **Partial bersama:** kartu produk ada di `R/hbs/{desktop,mobile}/partials/module/product_card_v2.handlebars`, dengan field `id, title, price, price_disc, disc, image, url|link, kcat, ksub, wishlisted`. Popup login ada di `R/hbs/*/partials/_v2/components/kgOneTap.handlebars`.
- **Header store tidak berupa partial:**
  - Desktop: header store ditulis inline di tiap template (baris 7–106, kelas `sv2h-`).
  - Mobile: ada blok `.sv2m-header`, plus `header_2021` yang selama ini disembunyikan lewat CSS.
- **Helper Handlebars yang dipakai:** `eq` (dari paket handlebars-helpers) dan `json` (`R/handlebars-helpers-custom.js:409`).
- **Data `storev2.json`:**
  - Key-nya: `hero`, `terlaris`, `rekomendasi`, `merchandise`, `baru`, `related`, `semua`(35), `membership`(3), `apparel`(9, dengan `sku` dan `stock[Warna][Ukuran]`), `wishlist`(8), `video`(6, dengan `playlist`, `date`, `access[]`).
  - Harga berupa string, misalnya `"162.000"` atau `"29.000/bulan"`. Kalau `price_disc` terisi, `price` adalah harga coret.
- **`detail.html` masih statis:** satu produk "Bundling Pesta Bola" (`source-18`, SKU `STORE-PESTABOLA-634812`) dengan 4 varian: Basic 50.000/100.000 stok 0, Bundling Plus 99.000/125.000 stok 24, Bundling Premium 475.000/750.000 stok 12, Premium MAX 525.000/800.000 stok 8.
- **`category.html` dan `collection.html` adalah halaman lama** yang statis dan tidak ditautkan dari navigasi v2. Keduanya tidak di-port; URL lamanya di-redirect ke `/produk`.
- **Konstanta yang di-hardcode di JS:**
  - `TABS` (JS 887–896)
  - `CAT`/`SUB` (JS 485–488)
  - `PROMOS` DJFXA54 = 14.000 dan PAYDAY25 = 25.000 (JS 1155)
  - `METHOD_LABEL`: cc, gopay, ovo, shopeepay, dana, linkaja, astrapay, bca-va, qris (JS 1554)
  - `REGION`: DKI, Jabar, Banten (JS 752)
  - `PICKUP_PLACE`: Kantor KOMPAS.com Palmerah, Senin–Jumat 09.00–17.00 (JS 2077)
  - Kurir: jne-premium 12.000 dan jne-regular 9.000. Proteksi paket 3.000.
  - Invoice berformat `GRI-YYMMDD-NNNN`.
  - Status pesanan: unpaid, processing, shipped, completed, canceled, ditambah varian pickup.
- **Gambar:**
  - Gambar produk berupa URL remote (`asset.kompas.com`, `image.gramedia.net`).
  - Aset UI lokal ada di `R/build/{desktop,mobile}/asset/images/store-v2/`: 97 file di desktop, mobile menambah 3 banner, total ±34MB.
- **CSS footer:** desktop di `R/build/desktop/asset/css/kcm2017-article.css`, mobile di `R/build/mobile/asset/css/style-kanal.css`.

## Arsitektur
```
Browser ─► Express (1 app, TypeScript)
            ├─ middleware device: UA → req.platform = 'desktop'|'mobile' (override ?device= + cookie)
            ├─ web routes (SSR)  → renderer per platform (2 instance express-handlebars)
            ├─ /api/v1 (tahap 3) → dipakai store-v2.js
            ├─ /admin  (tahap 4) → CMS
            └─ services ─► Prisma ─► MySQL
                  └─ adapters/{payment,auth,shipping} (mock dulu)
```
Ada dua instance `express-handlebars`, masing-masing dengan `partialsDir` platformnya sendiri. Dengan begitu nama partial tetap sama seperti di prototipe (`{{> product_card_v2}}`, `{{> kgOneTap}}`). Helper `res.renderPage(view, data)` memilih instance sesuai `req.platform`.

**Trik reuse:** service katalog mengembalikan model Prisma. Mapper `toCardVM()` lalu mengubahnya ke bentuk persis seperti `storev2.*` (harga sebagai string berformat, `disc`, `link`, `kcat`/`ksub`, `wishlisted`). Karena itu template cukup diubah sedikit, karena yang dipakai tetap `{{#each storev2.terlaris}}`.

## Struktur folder
```
Store Kompas.com New Flow/
├─ docs/PERENCANAAN.md
├─ prisma/{schema.prisma, migrations/, seed.ts, seed-data/storev2.json}
├─ src/
│  ├─ server.ts, app.ts, config/env.ts
│  ├─ lib/{prisma.ts, format.ts (rupiah), device.ts}
│  ├─ view/{engine.ts (2 renderer + helpers eq/json/rupiah), mappers.ts (toCardVM, toPdpVM)}
│  ├─ modules/catalog/{catalog.service.ts, catalog.routes.ts}
│  ├─ modules/{cart,wishlist,account,promo,checkout,orders,inventory}/  (kerangka, diisi tahap 3)
│  ├─ adapters/{payment,auth,shipping}/  (interface + mock, tahap 3)
│  └─ web/routes.ts   (peta route halaman + redirect *.html lama)
├─ views/{desktop,mobile}/{layouts/main.hbs, partials/, pages/}
├─ assets/sass/{store-v2.scss, chrome-footer-desktop.scss, chrome-footer-mobile.scss}
├─ public/{css/ (hasil build), js/store-v2.js, images/store-v2/}
├─ tests/
├─ .env.example, .gitignore, package.json, tsconfig.json
```

## Skema database (dibuat lengkap di Tahap 1, termasuk tabel stok & pesanan)
Prinsipnya, **setiap produk punya ≥1 SKU (`product_variants`), dan stok selalu melekat pada SKU.** Harga disimpan sebagai `Int` rupiah.

- **Katalog**
  - `categories`: parent_id, slug, name, icon, sort. Isinya 5 kategori induk + 14 sub.
  - `products`: slug, title, type (PHYSICAL | DIGITAL_VIDEO | MEMBERSHIP | EVENT), category_id, description JSON, specs JSON, external_url, price_suffix (`/bulan`), weight_gram, sold_count, status (DRAFT | PUBLISHED | ARCHIVED), published_at.
  - `product_images`
  - `product_options` dan `product_option_values` (Warna, Ukuran, Varian)
  - `product_variants`: sku, price, price_original, image_index, track_stock, is_active
  - `variant_option_values`
  - `product_videos`: playlist, video_date, access_points JSON, media_url
- **Kurasi**
  - `banners` (hero)
  - `home_sections` + `home_section_items` (terlaris, rekomendasi, merchandise, baru, related)
  - `collections` + `collection_items`: tab koleksi beserta aturannya (discounted, kcat/ksub, curated `first`/`only`)
- **Stok**
  - `stock_locations` (WAREHOUSE | PICKUP_POINT)
  - `inventory_levels` (variant × location: on_hand, reserved)
  - `stock_movements`: qty_delta, type (IN | OUT | ADJUST | RESERVE | RELEASE | RETURN), ref_type, ref_id, note, created_by
- **Pengguna**
  - `users`
  - `addresses`: label, recipient, phone, province, city, district, address, postal_code, note, is_default
  - `regions`: provinsi/kota/kecamatan, di-seed DKI, Jabar, Banten
  - `wishlists`
  - `carts` dan `cart_items` (+ note)
- **Transaksi**
  - `promo_codes`: FIXED | PERCENT, value, min_spend, max_discount, quota, periode
  - `promo_redemptions`
  - `payment_methods`: code, name, logo, flow INSTANT | ASYNC
  - `shipping_methods`
  - `pickup_locations`
  - `orders`: invoice_no, status, fulfillment SHIPPING | PICKUP | DIGITAL, subtotal, shipping_fee, protection_fee, discount, total, address_snapshot JSON, courier, tracking_no, pickup_location_id, pickup_token, payment_due_at, paid_at, completed_at
  - `order_items`: snapshot judul, SKU, opsi, gambar, harga, qty, note
  - `order_status_history`: sumber timeline
  - `payments`
  - `video_access`
  - `settings`: key/value untuk biaya proteksi, batas bayar dalam jam, dan sejenisnya

Tabel admin/role/audit dibuat di Tahap 4.

## Tahap 0 — Setup
1. Dokumen rencana ini (`docs/PERENCANAAN.md`).
2. Siapkan MySQL:
   - `brew install mysql` lalu `brew services start mysql`.
   - Buat database `store_kompas` dan user `store_dev`. User ini diberi hak CREATE supaya Prisma bisa membuat shadow DB.
   - Kredensial hanya disimpan di `.env`, yang di-gitignore.
3. Siapkan proyek Node:
   - `git init` dan `npm init`.
   - Dependensi: `express`, `express-handlebars`, `@prisma/client`, `cookie-parser`, `zod`.
   - Dependensi dev: `typescript`, `tsx`, `prisma`, `sass`, `vitest`, `supertest`, `eslint`, `prettier`, `concurrently`.
4. Tambahkan script npm:
   - `dev`: tsx watch + sass watch
   - `build`
   - `start`
   - `db:migrate`
   - `db:seed`
   - `db:reset`
   - `test`

## Tahap 1 — Database & seed
1. Tulis `prisma/schema.prisma` sesuai skema di atas, lalu jalankan `prisma migrate dev --name init`.
2. Salin `R/db/kanal/storev2.json` ke `prisma/seed-data/`. `seed.ts` (idempoten, upsert per slug) mengisi:
   - **Produk:** gabungan semua list berdasarkan `id` (semua, membership, apparel, video, list beranda, related, wishlist).
     - Tipe produk ditentukan dari `link`/`url`.
     - Harga diparse dari string.
     - Data apparel (gambar, desc, sku) dan data video (playlist, akses) digabungkan ke produknya.
   - **Apparel:** opsi Warna × Ukuran → 21 SKU per produk (`STORE-APP-1001-HITAM-XS`), stok dari matriks `stock`.
   - **Produk `source-18`:** 4 varian dengan harga dan stok dari `detail.handlebars`.
   - **Produk fisik lain:** 1 SKU default dengan stok awal 100.
   - **Video dan membership:** `track_stock=false`.
   - **Stok:** satu `stock_location` "Gudang Utama" + `inventory_levels`. Setiap stok awal dicatat sebagai `stock_movements` bertipe `IN` dengan note "seed".
   - **Kurasi:** kategori dan sub (dari CAT/SUB + `kcat`/`ksub`), banners (hero), home_sections, collections (dari `TABS`).
   - **Transaksi & pengguna:** promo codes, 9 payment methods, 2 shipping methods, pickup location Palmerah, regions, settings, user mock "Reza Pratama" + wishlist contohnya.

## Tahap 2 — Storefront dari MySQL
1. **Aset**
   - Salin `style-store-v2.scss` (desktop) menjadi `assets/sass/store-v2.scss` dan ubah path `../images/store-v2/` ke `/images/store-v2/`.
   - Satukan gambar desktop + 3 banner mobile ke `public/images/store-v2/`.
   - Salin `store-v2.js` ke `public/js/`.
   - CSS footer: ambil aturan `.footerMain`/`.footer` dari `kcm2017-article.css` (desktop) dan `style-kanal.css` (mobile) ke `chrome-footer-*.scss`. Kalau hasil ekstraksi bergeser, sementara link CSS kompiled utuh, lalu dirapikan.
   - Font Inter mengikuti `head_font.handlebars`.
2. **Layout & partial**
   - `views/{platform}/layouts/main.hbs`: head minimal + CSS store-v2 + CSS footer, `{{{body}}}`, footer, `store-v2.js`, dan GSI client hanya di halaman yang butuh login.
   - Header desktop (template baris 7–106) dijadikan partial `store_header`. Blok `.sv2m-header` mobile dijadikan partial `store_header_mobile`.
   - Partial lain yang disalin: `product_card_v2`, `kgOneTap`, footer.
   - Template legacy `header_2021`, `navpanel_new`, dan `smartbanner` tidak dibawa. Aturan CSS yang menyembunyikannya juga dihapus.
3. **Halaman (15 × 2 platform).** Salin `R/hbs/{desktop,mobile}/source/store-v2/*.handlebars` ke `views/{platform}/pages/`, buang chrome lama, dan ganti link `*.html` dengan route baru:

   | Route | Template | Data |
   |---|---|---|
   | `/` | index | banners, home_sections |
   | `/produk?category=&sub=` | semua-produk | produk published |
   | `/koleksi/:tab` | koleksi | collections |
   | `/cari?q=&category=` | search | produk + related |
   | `/produk/:slug` | detail / detail-apparel / detail-video (dipilih dari type + opsi) | toPdpVM |
   | `/wishlist` | wishlist | wishlist user mock |
   | `/keranjang`, `/checkout`, `/pesanan/:id/bayar`, `/pesanan/:id/berhasil`, `/pesanan/:id/diambil`, `/pesanan/:id`, `/akun` | cart, payment, payment-instruction, payment-success, pickup-success, order-detail, account | masih perilaku prototipe (localStorage), dipindah ke API di Tahap 3 |

   - Redirect 301 untuk `*.html?…` lama ke route baru. `category.html` dan `collection.html` diarahkan ke `/produk`.
   - **`detail.handlebars` dibuat data-driven:**
     - Chip varian dirender dari `product_variants` (data-price, data-stock, dan seterusnya).
     - SKU, deskripsi, dan "terjual" diambil dari DB.
   - **Detail apparel/video:**
     - Inline JSON hanya berisi produk yang sedang dibuka.
     - Stok di inline JSON adalah stok tersedia (on_hand − reserved).
4. **Penyesuaian kecil di `store-v2.js`**
   - `initApparelPdp` dan video: kalau tidak ada `?product=`, pakai item pertama di inline JSON.
   - Ganti string URL `*.html` ke route baru, misalnya `payment-instruction.html?method=&id=` menjadi `/pesanan/:id/bayar?method=`.
   - Logika lain tidak diubah.

## Tahap 3–6 (didokumentasikan, dikerjakan di sesi berikutnya)
- **Tahap 3 — Transaksi**
  - Auth mock + session, keranjang, wishlist, alamat, promo, checkout lewat `/api/v1`.
  - `POST /orders`: harga dan total dihitung ulang di server, stok di-reserve dengan `SELECT … FOR UPDATE`.
  - Pembayaran mock (VA/QRIS → "Saya sudah bayar"), timeline dari `order_status_history`, pickup QR, `video_access`.
  - Job yang membuat pesanan unpaid kedaluwarsa setelah 24 jam lalu melepas stoknya.
  - Semua `localStorage` di `store-v2.js` diganti `fetch`.
- **Tahap 4 — CMS `/admin`**
  - Login admin + role (Admin, Editor, Gudang, CS) + audit log.
  - CRUD produk, varian/SKU, gambar, kategori, banner, kurasi beranda/koleksi, dan promo.
  - **Seksi produk beranda** — termasuk 4 seksi yang ada sekarang (Terlaris, Rekomendasi untukmu, Merchandise pilihan, Baru di store), tidak ada seksi yang dikunci: tambah seksi baru (tanpa batas jumlah) atau hapus seksi, judul, urutan, isi (pilih produk manual atau otomatis dari aturan: kategori, terlaris, terbaru, diskon), jumlah produk, link Lihat semua (ke halaman koleksi yang dibuat otomatis untuk seksi itu, atau ke kategori/link lain), tampil/sembunyi.
  - **Menu navigasi** di bawah kolom pencarian (Terlaris, Rekomendasi, Merchandise, …): tambah/hapus item, label, tujuan, urutan, tampil/sembunyi — tabel baru `navigation_items`.
  - **Kategori:** tambah/ubah/sembunyikan/hapus kategori dan subkategori; langsung tampil di menu Kategori header, kartu Kategori Pilihan, dan filter.
  - Prasyarat di store: menu di bawah pencarian, menu Kategori (`.sv2k`), kartu Kategori Pilihan, dan daftar seksi beranda saat ini masih tertulis di `views/*/partials/store_header*.hbs` dan `views/*/pages/index.hbs` → ubah dulu supaya dirender dari database.
  - Kelola pesanan: status, input no resi, batal, invoice, scan QR pickup.
  - **CMS mobile (PWA, satu web CMS yang responsif):** MVP = scan QR pengambilan (cocokkan nama & isi pesanan, input manual invoice), daftar & cari pesanan, scan barcode resi, notifikasi push (dibayar, terlambat diproses, refund, stok menipis, belum diambil; pilihan per orang + jam tenang), setujui refund dari notifikasi, halaman awal sesuai peran, login sidik jari/Face ID (passkey), hubungi pembeli via WhatsApp. Berikutnya = daftar kemas + foto paket, serah terima kurir massal, scan barcode SKU (stok/opname), foto retur, mode sinyal lemah, dasbor ringkas, foto produk dari kamera, cetak label thermal Bluetooth.
  - **Chat pembeli = WhatsApp dulu:** tombol "Butuh bantuan?" + "Tanya pesanan ini" (pesan otomatis berisi no invoice) → nanti WhatsApp Business API + inbox bersama. Chat buatan sendiri hanya bila volume sangat besar. Nomor WhatsApp resmi masih ditunggu.
- **Tahap 5 — Stok**
  - Dasbor per SKU × lokasi.
  - Barang masuk, penyesuaian, opname, retur, dan transfer antarlokasi, semuanya lewat `stock_movements`.
  - Riwayat per SKU, peringatan stok menipis, impor/ekspor CSV.
- **Tahap 6 — Integrasi asli & rilis**
  - Payment gateway lewat adapter + webhook.
  - SSO Kompas (kgOneTap/Google).
  - Ongkir kurir asli.
  - Deploy dan storage gambar/CDN.
- **Keputusan (13 Oktober 2026)** — detail dan dampaknya ada di dokumen "User Flow & Kebutuhan CMS":
  - Pembayaran lewat **Xendit** (adapter + webhook).
  - **Ongkir asli per alamat** lewat API ongkir; **no resi diisi admin** di CMS.
  - Format invoice **`SKC-YYMMDD-XXXXXX`** (6 karakter acak, tanpa O/0/I/1), mis. `SKC-261013-7KQ4MP`.
  - Batas bayar VA BCA / QRIS **24 jam**.
  - Pesanan Dikirim **otomatis Selesai 7 hari** setelah dikirim.
  - Refund diajukan CS, **disetujui Finance, maksimal 14 hari**.
  - Tombol Akses video → **halaman detail video** (link per produk video).
  - Konten premium VIK dan Event **diarahkan keluar** seperti membership (Event sampai alur tiket didesain).
  - Tombol Beli Lagi → **halaman detail produk**.
  - Login CMS dengan **akun terpisah** (email + password).
  - Wilayah alamat **seluruh Indonesia**.
  - Gudang dan lokasi ambil **hanya Palmerah**.
  - Proteksi paket Rp3.000 **disembunyikan dulu** (tidak tampil, tidak masuk total; nilai tetap di `settings`).
  - Admin CMS pertama: **ardi.suhanda@kompas.com** (dibuat lewat seed saat CMS dipasang).
- **Masih menunggu:** penyedia ongkir (mis. Biteship/RajaOngkir) dan kurir aktif — sementara tetap tarif tetap JNE Premium/Regular; link tujuan VIK dan Event — sementara produknya tetap tampil seperti sekarang.

## Verifikasi (Tahap 0–2)
1. **Database:**
   - `npm run db:migrate && npm run db:seed` sukses, dan seed dua kali tidak menggandakan data.
   - Hitung baris: 8 apparel × 21 + Paguyuban 2 warna × 7 = 182 SKU apparel; video 6; source-18 4 varian. Jumlah total produk sama dengan jumlah id unik di storev2.json.
   - Jumlah `stock_movements` IN sama dengan jumlah SKU yang `track_stock`.
2. **Tes otomatis (`npm test`):**
   - Vitest: `format.ts` (parse/format rupiah) dan `toCardVM`/`toPdpVM`.
   - Supertest: semua route mengembalikan 200 untuk UA desktop dan mobile, dan redirect `*.html` mengembalikan 301.
3. **Visual (browser pane):**
   - Jalankan `npm run dev` (port 3000) dan prototipe statis `R/build/desktop` + `R/build/mobile` (`npx serve`).
   - Bandingkan screenshot setiap halaman di desktop 1440px dan mobile 360px (preset mobile yang otomatis memakai UA Android, sehingga server memilih template mobile).
   - Ukur gutter mobile (16px kiri/kanan, konten 328px) dan jarak konten ke footer 120px.
4. **Interaksi & data:**
   - Klik-jalan: beranda → kartu → detail apparel. Pilih ukuran yang stoknya 0 → tombol nonaktif.
   - Ubah stok/harga langsung di MySQL → refresh → angka di halaman ikut berubah. Ini membuktikan data sudah dari DB.
   - Filter kategori, pencarian, dan koleksi menampilkan jumlah yang sama dengan prototipe.
