/**
 * Seed database dari data prototipe store-v2 (prisma/seed-data/).
 *
 * Idempoten: semua tabel dikosongkan dulu lalu diisi ulang, jadi menjalankan seed dua kali
 * tidak menggandakan data. HANYA untuk development — seed menghapus pesanan & data lain.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPrisma } from '../src/lib/prisma.js';
import { discountPercent, parseIndonesianDate, parsePrice } from '../src/lib/format.js';

const prisma = createPrisma();

const dataDir = fileURLToPath(new URL('./seed-data/', import.meta.url));
const readJson = (file: string) => JSON.parse(readFileSync(dataDir + file, 'utf8'));

type ProtoProduct = {
  id: string;
  title: string;
  price: string;
  price_disc?: string;
  disc?: number | string;
  image?: string;
  images?: string[];
  category?: string;
  kcat?: string;
  ksub?: string;
  link?: string;
  url?: string;
  sku?: string;
  desc?: string[];
  stock?: Record<string, Record<string, number>>;
  playlist?: string;
  date?: string;
  access?: string[];
};

const store = readJson('storev2.json') as Record<string, ProtoProduct[]> & {
  hero: { image: string; image_mobile?: string; title: string; href: string }[];
};
const pestaBola = readJson('pesta-bola.json');

// ───────────── Konstanta yang di prototipe di-hardcode di store-v2.js ─────────────

const CATEGORIES: { slug: string; name: string; subs: [string, string][] }[] = [
  { slug: 'merchandise', name: 'Merchandise', subs: [['apparel', 'Apparel'], ['accessories', 'Accessories'], ['drinkware', 'Drinkware']] },
  { slug: 'buku', name: 'Buku', subs: [['novel', 'Novel'], ['quran', 'Quran'], ['biografi', 'Biografi'], ['ensiklopedia', 'Ensiklopedia']] },
  { slug: 'membership', name: 'Membership', subs: [] },
  { slug: 'digital', name: 'Digital', subs: [['video-premium', 'Video premium'], ['konten-premium', 'Konten premium'], ['sticker', 'Sticker']] },
  { slug: 'event', name: 'Event', subs: [['aktivitas', 'Aktivitas'], ['webinar', 'Webinar'], ['workshop', 'Workshop'], ['tour', 'Tour']] },
];

/** Tab halaman koleksi (TABS di store-v2.js). `first` = produk kurasi di urutan depan. */
const COLLECTIONS: { key: string; title: string; icon: string; first?: string[]; rules: Record<string, unknown> }[] = [
  { key: 'terlaris', title: 'Terlaris', icon: 'cat-terlaris.png', rules: {},
    first: ['premium-kompascom-max', 'kaos-hitam-ekslusif-kompascom-sandang-pangan-papan-kebenaran', 'tumbler-eksklusif-kompascom', 'payung-eksklusif-kompascom'] },
  { key: 'rekomendasi', title: 'Rekomendasi', icon: 'cat-rekomendasi.png', rules: {},
    first: ['buku-menafsir-gelap-menyulam-terang-catatan-kolumnis-kompascom-di-jalan-ketidakpastian', 'jason-ranti-mentalitas-di-dunia-yang-berisik-beginu-5-tahun', 'premium-kompas-one', 'the-things-you-can-see-only-when-you-slow-down'] },
  // Terbaru = semua produk yang tayang 30 hari terakhir, urut waktu tayang (tanpa kurasi manual).
  { key: 'terbaru', title: 'Terbaru', icon: 'cat-terbaru.png', rules: { recentDays: 30 } },
]

/** Produk terbaru di prototipe (urutan = paling baru dulu); di seed diberi waktu tayang dalam 30 hari terakhir. */
const NEWEST = ['jaket-principles-kompasiana', 'jaket-storyteller-kompasiana', 'kaos-principles-kompasiana', 'kaos-storyteller-kompasiana', 'tumbler-principles-kompasiana', 'tumbler-storyteller-kompasiana', 'kaos-hitam-ekslusif-kompascom-mencari-kebenaran-bukan-pembenaran', 'dr-m-faisal-bertumbuh-di-era-ngonten-beginu-5-tahun', 'jj-rizal-bisakah-membangun-masa-depan-tanpa-sejarah-beginu-5-tahun', 'ade-putri-makanan-cerita-dan-prinsip-cukup-beginu-5-tahun', 'premium-kompascom-lite', 'you-do-you-discovering-life-through-experiments-self-awareness'];

const MORE_COLLECTIONS: { key: string; title: string; icon: string; first?: string[]; rules: Record<string, unknown> }[] = [
  { key: 'diskon', title: 'Diskon Spesial', icon: 'cat-diskon-spesial.png', rules: { discounted: true } },
  { key: 'merchandise', title: 'Merchandise', icon: 'cat-merchandise.png', rules: { kcat: 'merchandise' } },
  { key: 'video-premium', title: 'Video premium', icon: 'cat-video-premium.svg', rules: { kcat: 'digital', ksub: 'video-premium' } },
  { key: 'event', title: 'Event', icon: 'cat-event.png', rules: { kcat: 'event' } },
  { key: 'membership', title: 'Membership', icon: 'cat-membership.png', rules: { kcat: 'membership' } },
];

/** Seksi produk: isi manual dari list prototipe, "Lihat Semua" ke koleksi `seeAll`. */
const HOME_SECTIONS: { key: string; title: string; limit: number; seeAll?: string; moreButton?: boolean; related?: boolean }[] = [
  { key: 'terlaris', title: 'Terlaris', limit: 4, seeAll: 'terlaris' },
  { key: 'rekomendasi', title: 'Rekomendasi untukmu', limit: 4, seeAll: 'rekomendasi' },
  { key: 'merchandise', title: 'Merchandise pilihan', limit: 4, seeAll: 'merchandise' },
  { key: 'baru', title: 'Baru di store', limit: 12, seeAll: 'terbaru', moreButton: true },
  { key: 'related', title: 'Produk terkait', limit: 8, related: true },
];

/** Menu di bawah kolom pencarian (key koleksi; label = judul koleksi). */
const SEARCH_MENU = ['terlaris', 'rekomendasi', 'merchandise', 'video-premium', 'event', 'membership'];
/** Kartu Kategori Pilihan di beranda (key koleksi; label & gambar = judul & ikon koleksi). */
const HOME_SHORTCUTS = ['diskon', 'rekomendasi', 'terbaru', 'merchandise', 'membership', 'event'];

const COLORS: [string, string][] = [['Hitam', '#1F1F1F'], ['Putih', '#FFFFFF'], ['Grey', '#9A9A9A']];

/**
 * Warna apparel per produk + foto milik tiap warna (index foto di galeri).
 * Default: warna prototipe (Hitam/Putih/Grey); semua foto produk berwarna hitam → milik Hitam.
 * Paguyuban punya foto asli dua warna (hijau army & putih).
 */
type ApparelColors = { colors: [string, string][]; photos: Record<string, number[]>; stockFrom: Record<string, string> };
const APPAREL_COLORS: Record<string, ApparelColors> = {
  'kaos-gaspol-paguyuban-cap-orang-dalam': {
    colors: [['Hijau Army', '#5B5F3A'], ['Putih', '#FFFFFF']],
    photos: { 'Hijau Army': [0, 2, 5, 8], Putih: [1, 3, 4, 6, 7] },
    stockFrom: { 'Hijau Army': 'Hitam', Putih: 'Putih' },
  },
};
function apparelColors(slug: string, imageCount: number): ApparelColors {
  return (
    APPAREL_COLORS[slug] ?? {
      colors: COLORS,
      photos: { Hitam: Array.from({ length: imageCount }, (_, i) => i) },
      stockFrom: { Hitam: 'Hitam', Putih: 'Putih', Grey: 'Grey' },
    }
  );
}
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const PAYMENT_METHODS: [string, string, 'INSTANT' | 'ASYNC', string][] = [
  ['cc', 'Kartu kredit', 'INSTANT', 'pay-kartu-kredit.png'],
  ['gopay', 'GoPay', 'INSTANT', 'pay-gopay.png'],
  ['ovo', 'OVO', 'INSTANT', 'pay-ovo.png'],
  ['shopeepay', 'ShopeePay', 'INSTANT', 'pay-shopeepay.png'],
  ['dana', 'DANA', 'INSTANT', 'pay-dana.png'],
  ['linkaja', 'LinkAja', 'INSTANT', 'pay-linkaja.png'],
  ['astrapay', 'AstraPay', 'INSTANT', 'pay-astrapay.png'],
  ['bca-va', 'Virtual account BCA', 'ASYNC', 'pay-bca.png'],
  ['qris', 'QRIS', 'ASYNC', 'pay-qris.png'],
];

const REGIONS: Record<string, Record<string, string[]>> = {
  'DKI Jakarta': {
    'Jakarta Barat': ['Kebon Jeruk', 'Palmerah', 'Grogol Petamburan', 'Kembangan'],
    'Jakarta Pusat': ['Gambir', 'Menteng', 'Tanah Abang', 'Senen'],
    'Jakarta Selatan': ['Kebayoran Baru', 'Setiabudi', 'Tebet', 'Cilandak'],
    'Jakarta Timur': ['Jatinegara', 'Duren Sawit', 'Cakung', 'Matraman'],
    'Jakarta Utara': ['Kelapa Gading', 'Penjaringan', 'Tanjung Priok', 'Koja'],
  },
  'Jawa Barat': {
    'Kota Bandung': ['Coblong', 'Sukajadi', 'Lengkong', 'Cicendo'],
    'Kota Bekasi': ['Bekasi Barat', 'Bekasi Selatan', 'Medan Satria'],
    'Kota Bogor': ['Bogor Tengah', 'Bogor Utara', 'Tanah Sareal'],
    'Kota Depok': ['Beji', 'Pancoran Mas', 'Sukmajaya'],
  },
  Banten: {
    'Kota Tangerang': ['Cipondoh', 'Karawaci', 'Tangerang'],
    'Kota Tangerang Selatan': ['Serpong', 'Pondok Aren', 'Ciputat'],
    'Kota Serang': ['Serang', 'Cipocok Jaya', 'Taktakan'],
  },
};

const DEFAULT_STOCK = 100;
const SKU_PREFIX: Record<string, string> = { merchandise: 'MER', buku: 'BUK', membership: 'MEM', digital: 'DIG', event: 'EVT' };

// ───────────── Helper ─────────────

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Path aset prototipe ("../asset/images/store-v2/x.png") → path publik ("/images/store-v2/x.png"). */
const assetPath = (p: string) => p.replace(/^(\.\.\/)?asset\/images\//, '/images/').replace(/^\.\.\/asset\/images\//, '/images/');

/** Link halaman prototipe → route baru. */
function routeFromPrototypeHref(href: string): string {
  const [file, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (file === 'koleksi.html') return `/koleksi/${params.get('tab') ?? 'terlaris'}`;
  if (file === 'semua-produk.html') return `/produk${query ? `?${query}` : ''}`;
  if (file === 'search.html') return `/cari${query ? `?${query}` : ''}`;
  return '/';
}

function productType(p: ProtoProduct) {
  if (p.link === 'detail-video.html') return 'DIGITAL_VIDEO' as const;
  if (p.url) return 'MEMBERSHIP' as const;
  if (p.ksub === 'konten-premium') return 'DIGITAL_CONTENT' as const;
  if (p.kcat === 'event') return 'EVENT' as const;
  return 'PHYSICAL' as const;
}

/** Prototipe: kalau price_disc terisi, `price` = harga coret dan `price_disc` = harga jual. */
function pricing(p: ProtoProduct) {
  const hasDisc = Boolean(p.price_disc && String(p.price_disc).trim());
  const sale = parsePrice(hasDisc ? p.price_disc! : p.price);
  const original = hasDisc ? parsePrice(p.price).amount : null;
  return { price: sale.amount, priceOriginal: original, suffix: sale.suffix };
}

// ───────────── Langkah seed ─────────────

async function clearAll() {
  // Urutan: tabel anak dulu, lalu induk.
  await prisma.navigationItem.deleteMany();
  await prisma.videoAccess.deleteMany();
  await prisma.promoRedemption.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.wishlist.deleteMany();
  await prisma.address.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryLevel.deleteMany();
  await prisma.pickupLocation.deleteMany();
  await prisma.stockLocation.deleteMany();
  await prisma.variantOptionValue.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productOptionValue.deleteMany();
  await prisma.productOption.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVideo.deleteMany();
  await prisma.homeSectionItem.deleteMany();
  await prisma.homeSection.deleteMany();
  await prisma.collectionItem.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany({ where: { parentId: { not: null } } });
  await prisma.category.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.promoCode.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.shippingMethod.deleteMany();
  await prisma.region.deleteMany({ where: { level: 'DISTRICT' } });
  await prisma.region.deleteMany({ where: { level: 'CITY' } });
  await prisma.region.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.user.deleteMany();
}

async function seedCategories() {
  const ids = new Map<string, number>();
  for (const [i, cat] of CATEGORIES.entries()) {
    const parent = await prisma.category.create({ data: { slug: cat.slug, name: cat.name, sortOrder: i } });
    ids.set(cat.slug, parent.id);
    for (const [j, [slug, name]] of cat.subs.entries()) {
      const sub = await prisma.category.create({ data: { slug, name, parentId: parent.id, sortOrder: j } });
      ids.set(slug, sub.id);
    }
  }
  return ids;
}

/** Gabungkan semua list prototipe per id: list berikutnya melengkapi field yang belum ada. */
function mergedProducts(): ProtoProduct[] {
  const byId = new Map<string, ProtoProduct>();
  const lists = ['semua', 'membership', 'apparel', 'video', 'terlaris', 'rekomendasi', 'merchandise', 'baru', 'related', 'wishlist'];
  for (const key of lists) {
    for (const item of store[key] ?? []) {
      byId.set(item.id, { ...item, ...byId.get(item.id), ...pickRich(item) });
    }
  }
  return [...byId.values()];
}

/** Field "kaya" dari list apparel/video selalu diambil walau produk sudah ada. */
function pickRich(item: ProtoProduct): Partial<ProtoProduct> {
  const rich: Partial<ProtoProduct> = {};
  for (const k of ['images', 'desc', 'stock', 'sku', 'playlist', 'date', 'access', 'url'] as const) {
    if (item[k] !== undefined && item[k] !== '') (rich as Record<string, unknown>)[k] = item[k];
  }
  return rich;
}

type SeededVariant = { id: number; stock: number; trackStock: boolean };

async function seedProducts(categoryIds: Map<string, number>) {
  const productIds = new Map<string, number>();
  const variants: SeededVariant[] = [];
  // Waktu tayang (relatif waktu seed dijalankan):
  // - produk NEWEST: 0–22 hari lalu, urutan sesuai daftar (paling atas = paling baru) → masuk tab Terbaru
  // - produk lain: > 40 hari lalu, urutan relatif = list `semua` prototipe
  const now = Date.now();
  const base = now - 40 * 86400_000;
  const publishTime = (id: string, index: number) =>
    NEWEST.includes(id) ? new Date(now - NEWEST.indexOf(id) * 2 * 86400_000 - 3600_000) : new Date(base - index * 3600_000);
  let skuSeq = 2000;
  const discMismatch: string[] = [];

  const all = mergedProducts();
  for (const [index, p] of all.entries()) {
    const type = productType(p);
    const { price, priceOriginal, suffix } = pricing(p);
    if (p.disc !== '' && p.disc !== undefined && Number(p.disc) !== discountPercent(price, priceOriginal)) {
      discMismatch.push(`${p.id}: data ${p.disc}% vs hitung ${discountPercent(price, priceOriginal)}%`);
    }
    const isApparel = p.link === 'detail-apparel.html' && p.stock;
    const colorSet = isApparel ? apparelColors(p.id, (p.images ?? []).length) : null;
    const trackStock = type === 'PHYSICAL' || type === 'EVENT';
    const sku = p.sku ?? `STORE-${SKU_PREFIX[p.kcat ?? ''] ?? 'GEN'}-${skuSeq++}`;
    const publishedAt = publishTime(p.id, index);
    const images = (p.images?.length ? p.images : p.image ? [p.image] : []).map(assetPath);

    const product = await prisma.product.create({
      data: {
        slug: p.id,
        title: p.title,
        label: p.category ?? null,
        type,
        status: 'PUBLISHED',
        categoryId: categoryIds.get(p.ksub || p.kcat || '') ?? null,
        sku,
        description: p.desc?.length ? p.desc.map((para) => `<p>${escapeHtml(para)}</p>`).join('\n') : null,
        specs: isApparel
          ? ['Produk: ' + p.title, 'Kategori: Merchandise · Apparel', 'Warna: ' + colorSet!.colors.map(([c]) => c).join(', '), 'Ukuran: XS, S, M, L, XL, XXL, XXXL']
          : undefined,
        externalUrl: p.url || null,
        priceSuffix: suffix,
        publishedAt,
        images: { create: images.map((url, i) => ({ url, sortOrder: i })) },
        video:
          type === 'DIGITAL_VIDEO'
            ? { create: { playlist: p.playlist ?? null, videoDate: parseIndonesianDate(p.date ?? ''), accessPoints: p.access ?? [] } }
            : undefined,
      },
    });
    productIds.set(p.id, product.id);

    if (isApparel) {
      // Opsi Warna × Ukuran → 21 SKU, stok dari matriks prototipe.
      const color = await prisma.productOption.create({
        data: { productId: product.id, name: 'Warna', sortOrder: 0,
          values: { create: colorSet!.colors.map(([value, swatch], i) => ({ value, swatch, sortOrder: i })) } },
        include: { values: true },
      });
      const size = await prisma.productOption.create({
        data: { productId: product.id, name: 'Ukuran', sortOrder: 1,
          values: { create: SIZES.map((value, i) => ({ value, sortOrder: i })) } },
        include: { values: true },
      });
      for (const cv of color.values) {
        const indices = colorSet!.photos[cv.value] ?? [];
        if (indices.length) {
          await prisma.productImage.updateMany({
            where: { productId: product.id, sortOrder: { in: indices } },
            data: { optionValueId: cv.id },
          });
        }
      }
      let order = 0;
      for (const cv of color.values) {
        for (const sv of size.values) {
          const v = await prisma.productVariant.create({
            data: {
              productId: product.id,
              sku: `${sku}-${cv.value.toUpperCase()}-${sv.value}`,
              name: `${cv.value}, ${sv.value}`,
              price,
              priceOriginal,
              trackStock: true,
              sortOrder: order++,
              optionValues: { create: [{ optionValueId: cv.id }, { optionValueId: sv.id }] },
            },
          });
          variants.push({ id: v.id, stock: p.stock?.[colorSet!.stockFrom[cv.value] ?? cv.value]?.[sv.value] ?? 0, trackStock: true });
        }
      }
    } else {
      const v = await prisma.productVariant.create({
        data: { productId: product.id, sku, price, priceOriginal, trackStock, sortOrder: 0 },
      });
      variants.push({ id: v.id, stock: trackStock ? DEFAULT_STOCK : 0, trackStock });
    }
  }

  // Produk detail.html prototipe (Bundling Pesta Bola) dengan 4 varian harga & stok sendiri.
  const pb = pestaBola;
  const product = await prisma.product.create({
    data: {
      slug: pb.id,
      title: pb.title,
      label: pb.label,
      type: 'PHYSICAL',
      status: 'PUBLISHED',
      categoryId: categoryIds.get(pb.kcat) ?? null,
      sku: pb.sku,
      description: pb.descriptionHtml,
      specs: pb.specs,
      soldCount: pb.soldCount,
      publishedAt: new Date(base - 60 * 86400_000),
      images: { create: pb.images.map((url: string, i: number) => ({ url, sortOrder: i })) },
    },
  });
  productIds.set(pb.id, product.id);
  const option = await prisma.productOption.create({
    data: { productId: product.id, name: 'Varian', sortOrder: 0,
      values: { create: pb.variants.map((v: { name: string }, i: number) => ({ value: v.name, sortOrder: i })) } },
    include: { values: true },
  });
  for (const [i, v] of (pb.variants as { name: string; price: number; priceOriginal: number; stock: number; imageIndex: number }[]).entries()) {
    const created = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${pb.sku}-${v.name.toUpperCase().replace(/\s+/g, '-')}`,
        name: v.name,
        price: v.price,
        priceOriginal: v.priceOriginal,
        imageIndex: v.imageIndex,
        sortOrder: i,
        optionValues: { create: [{ optionValueId: option.values[i].id }] },
      },
    });
    variants.push({ id: created.id, stock: v.stock, trackStock: true });
  }

  if (discMismatch.length) console.warn('⚠ Persen diskon prototipe berbeda dari hasil hitung:\n  ' + discMismatch.join('\n  '));
  return { productIds, variants };
}

async function seedInventory(variants: SeededVariant[]) {
  const warehouse = await prisma.stockLocation.create({
    data: { code: 'GUDANG-UTAMA', name: 'Gudang Utama', type: 'WAREHOUSE', address: 'Kompas Gramedia, Jl. Palmerah Selatan No. 22-26, Jakarta' },
  });
  const tracked = variants.filter((v) => v.trackStock);
  await prisma.inventoryLevel.createMany({
    data: tracked.map((v) => ({ variantId: v.id, locationId: warehouse.id, onHand: v.stock })),
  });
  await prisma.stockMovement.createMany({
    data: tracked
      .filter((v) => v.stock > 0)
      .map((v) => ({ variantId: v.id, locationId: warehouse.id, type: 'IN' as const, qtyDelta: v.stock, refType: 'seed', note: 'Stok awal dari data prototipe', createdBy: 'seed' })),
  });
  return warehouse;
}

async function seedCuration(productIds: Map<string, number>) {
  await prisma.banner.createMany({
    data: store.hero.map((h, i) => ({
      title: h.title,
      imageUrl: assetPath(h.image),
      imageMobileUrl: h.image_mobile ? assetPath(h.image_mobile) : null,
      href: routeFromPrototypeHref(h.href),
      sortOrder: i,
    })),
  });

  // urutan tab: terlaris, rekomendasi, terbaru, diskon, merchandise, video-premium, event, membership
  const collections = new Map<string, { id: number; title: string; icon: string | null }>();
  for (const [i, c] of [...COLLECTIONS, ...MORE_COLLECTIONS].entries()) {
    const created = await prisma.collection.create({
      data: {
        key: c.key,
        title: c.title,
        icon: `/images/store-v2/${c.icon}`,
        rules: c.rules as object,
        sortOrder: i,
        items: {
          create: (c.first ?? [])
            .filter((id) => productIds.has(id))
            .map((id, j) => ({ productId: productIds.get(id)!, sortOrder: j })),
        },
      },
    });
    collections.set(c.key, created);
  }

  for (const [i, s] of HOME_SECTIONS.entries()) {
    await prisma.homeSection.create({
      data: {
        key: s.key,
        title: s.title,
        sortOrder: i,
        placement: s.related ? 'PRODUCT_RELATED' : 'HOME',
        productLimit: s.limit,
        seeAllType: s.seeAll ? 'COLLECTION' : 'NONE',
        seeAllCollectionId: s.seeAll ? collections.get(s.seeAll)!.id : null,
        showMoreButton: Boolean(s.moreButton),
        items: { create: (store[s.key] ?? []).map((p, j) => ({ productId: productIds.get(p.id)!, sortOrder: j })) },
      },
    });
  }

  await prisma.navigationItem.createMany({
    data: [
      ...SEARCH_MENU.map((key, i) => ({ placement: 'SEARCH_MENU' as const, key, i })),
      ...HOME_SHORTCUTS.map((key, i) => ({ placement: 'HOME_SHORTCUT' as const, key, i })),
    ].map(({ placement, key, i }) => {
      const c = collections.get(key)!;
      return {
        placement,
        label: c.title,
        imageUrl: placement === 'HOME_SHORTCUT' ? c.icon : null,
        linkType: 'COLLECTION' as const,
        collectionId: c.id,
        sortOrder: i,
      };
    }),
  });

  // Menu Kategori: Membership langsung ke halaman koleksinya.
  await prisma.category.update({ where: { slug: 'membership' }, data: { landingCollectionId: collections.get('membership')!.id } });
}

async function seedCommerce(warehouseId: number, productIds: Map<string, number>) {
  await prisma.promoCode.createMany({
    data: [
      { code: 'DJFXA54', type: 'FIXED', value: 14000 },
      { code: 'PAYDAY25', type: 'FIXED', value: 25000 },
    ],
  });
  await prisma.paymentMethod.createMany({
    data: PAYMENT_METHODS.map(([code, name, flow, logo], i) => ({ code, name, flow, logoUrl: `/images/store-v2/${logo}`, sortOrder: i })),
  });
  await prisma.shippingMethod.createMany({
    data: [
      { code: 'jne-premium', courier: 'JNE', service: 'Premium', name: 'JNE Premium', fee: 12000, sortOrder: 0 },
      { code: 'jne-regular', courier: 'JNE', service: 'Regular', name: 'JNE Regular', fee: 9000, sortOrder: 1 },
    ],
  });
  await prisma.pickupLocation.create({
    data: {
      name: 'Kantor KOMPAS.com',
      address:
        'Kompas Gramedia, Jl. Palmerah Sel. No.22-26 Unit 2 Lantai 2, RT.4/RW.2, Gelora, Kecamatan Tanah Abang, Kota Jakarta Pusat, Daerah Khusus Ibukota Jakarta 10270',
      openingHours: 'Senin-Jumat Pukul 09.00-17.00',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kompas%20Gramedia%20Palmerah',
      stockLocationId: warehouseId,
    },
  });
  await prisma.setting.createMany({
    data: [
      { key: 'protection_fee', value: 3000 },
      // Proteksi paket disembunyikan dulu (keputusan 13 Okt 2026); ubah ke true untuk menampilkan lagi
      { key: 'protection_fee_enabled', value: false },
      { key: 'payment_due_hours', value: 24 },
      { key: 'auto_complete_days', value: 7 },
      { key: 'refund_max_days', value: 14 },
      { key: 'invoice_prefix', value: 'SKC' },
      { key: 'video_access_url', value: 'https://store.kompas.com/video-premium/history' },
    ],
  });

  for (const [province, cities] of Object.entries(REGIONS)) {
    const prov = await prisma.region.create({ data: { level: 'PROVINCE', name: province } });
    for (const [city, districts] of Object.entries(cities)) {
      const c = await prisma.region.create({ data: { level: 'CITY', name: city, parentId: prov.id } });
      await prisma.region.createMany({ data: districts.map((name) => ({ level: 'DISTRICT' as const, name, parentId: c.id })) });
    }
  }

  // User mock (adapter auth mock memakai user ini) + wishlist contohnya.
  const user = await prisma.user.create({
    data: { name: 'Reza Pratama', email: 'reza.pratama@gmail.com', ssoId: 'mock-reza' },
  });
  await prisma.wishlist.createMany({
    data: store.wishlist.map((p, i) => ({
      userId: user.id,
      productId: productIds.get(p.id)!,
      createdAt: new Date(Date.UTC(2026, 9, 1) - i * 86400_000),
    })),
  });
}

async function main() {
  console.log('Mengosongkan tabel…');
  await clearAll();
  const categoryIds = await seedCategories();
  const { productIds, variants } = await seedProducts(categoryIds);
  const warehouse = await seedInventory(variants);
  await seedCuration(productIds);
  await seedCommerce(warehouse.id, productIds);

  const [products, skus, movements, levels] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.stockMovement.count(),
    prisma.inventoryLevel.count(),
  ]);
  console.log(`✔ Seed selesai: ${products} produk, ${skus} SKU, ${levels} baris stok, ${movements} mutasi stok awal.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
