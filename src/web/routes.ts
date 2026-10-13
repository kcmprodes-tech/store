import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  categoryWhere,
  getBanners,
  getCollectionProducts,
  getHomeSections,
  getProductBySlug,
  getRelatedProducts,
  getSectionPage,
  getWishlistProducts,
  listPublished,
  listVideos,
} from '../modules/catalog/catalog.service.js';
import { formatNumber, formatRupiah } from '../lib/format.js';
import { getSettings } from '../lib/settings.js';
import { sectionSeeAllHref } from '../modules/storefront/storefront.service.js';
import { toCards, toPdpJson, toPdpVM } from '../view/mappers.js';

export const web = Router();

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** User mock (Tahap 2): wishlist contoh milik "Reza Pratama". Diganti adapter auth di Tahap 3. */
async function mockUserId() {
  const user = await prisma.user.findUnique({ where: { email: 'reza.pratama@gmail.com' }, select: { id: true } });
  return user?.id;
}

async function relatedCards() {
  return toCards(await getRelatedProducts());
}

// ───────────── Katalog ─────────────

web.get(
  '/',
  route(async (_req, res) => {
    const [banners, sections] = await Promise.all([getBanners(), getHomeSections()]);
    await res.renderPage('index', {
      pageTitle: 'Store',
      storev2: {
        hero: banners.map((b) => ({ image: b.imageUrl, image_mobile: b.imageMobileUrl, title: b.title, href: b.href ?? '#' })),
      },
      homeSections: sections.map(({ section, products }) => {
        const seeAllHref = sectionSeeAllHref(section);
        return {
          title: section.title,
          products: toCards(products),
          seeAllHref,
          moreHref: section.showMoreButton ? seeAllHref : null,
        };
      }),
    });
  }),
);

web.get(
  '/produk',
  route(async (req, res) => {
    const products = await listPublished(categoryWhere(str(req.query.category), str(req.query.sub)));
    await res.renderPage('semua-produk', { pageTitle: 'Semua produk', storev2: { semua: toCards(products) } });
  }),
);

web.get(
  '/koleksi/:tab',
  route(async (req, res, next) => {
    const result = await getCollectionProducts(String(req.params.tab));
    if (!result) return next();
    const { collection, products } = result;
    await res.renderPage('koleksi', {
      pageTitle: collection.title,
      tab: { key: collection.key, title: collection.title, icon: collection.icon },
      storev2: { semua: toCards(products) },
    });
  }),
);

/** Halaman "Lihat semua" milik seksi produk: semua produk seksi, memakai tampilan halaman koleksi. */
web.get(
  '/seksi/:key',
  route(async (req, res, next) => {
    const result = await getSectionPage(String(req.params.key));
    if (!result) return next();
    const { section, products } = result;
    await res.renderPage('koleksi', {
      pageTitle: section.title,
      tab: { key: section.key, title: section.title, icon: null },
      storev2: { semua: toCards(products) },
    });
  }),
);

web.get(
  '/cari',
  route(async (req, res) => {
    const q = str(req.query.q);
    const category = str(req.query.category);
    const products = await listPublished({
      ...categoryWhere(category),
      ...(q ? { title: { contains: q } } : {}),
    });
    await res.renderPage('search', {
      pageTitle: q ? `Hasil pencarian "${q}"` : 'Pencarian',
      storev2: { semua: toCards(products), related: await relatedCards() },
    });
  }),
);

web.get(
  '/produk/:slug',
  route(async (req, res, next) => {
    const product = await getProductBySlug(String(req.params.slug));
    if (!product) return next();
    if (product.externalUrl) return res.redirect(302, product.externalUrl);

    const related = await relatedCards();
    if (product.type === 'DIGITAL_VIDEO') {
      return res.renderPage('detail-video', {
        pageTitle: product.title,
        product: toPdpVM(product),
        storev2: { video: [toPdpJson(product)], related },
      });
    }
    if (product.options.some((o) => o.name === 'Warna' || o.name === 'Ukuran')) {
      return res.renderPage('detail-apparel', {
        pageTitle: product.title,
        product: toPdpVM(product),
        storev2: { apparel: [toPdpJson(product)], related },
      });
    }
    await res.renderPage('detail', { pageTitle: product.title, product: toPdpVM(product), storev2: { related } });
  }),
);

web.get(
  '/wishlist',
  route(async (_req, res) => {
    const userId = await mockUserId();
    const products = userId ? await getWishlistProducts(userId) : [];
    await res.renderPage('wishlist', {
      pageTitle: 'Wishlist',
      storev2: { wishlist: toCards(products, new Set(products.map((p) => p.id))) },
    });
  }),
);

// ───────────── Transaksi (Tahap 2: perilaku prototipe, data di localStorage) ─────────────

web.get('/keranjang', route(async (_req, res) => res.renderPage('cart', { pageTitle: 'Keranjang', storev2: { related: await relatedCards() } })));

/** Angka ringkasan checkout. Subtotal & ongkir masih contoh prototipe sampai keranjang pindah ke database (Tahap 3). */
async function checkoutSummary() {
  const subtotal = 50000;
  const shipping = 9000;
  const settings = await getSettings(['protection_fee', 'protection_fee_enabled']);
  // Proteksi paket disembunyikan dulu (keputusan 13 Okt 2026); nilainya tetap di settings
  const protection = settings.protection_fee_enabled === true ? Number(settings.protection_fee ?? 0) : 0;
  const total = subtotal + shipping + protection;
  return {
    subtotal: formatRupiah(subtotal),
    shipping: formatRupiah(shipping),
    protectionFee: protection ? formatRupiah(protection) : '',
    total: formatRupiah(total),
    totalCompact: `Rp${formatNumber(total)}`,
  };
}

web.get(
  '/checkout',
  route(async (_req, res) => {
    const [videos, checkout] = await Promise.all([listVideos(), checkoutSummary()]);
    await res.renderPage('payment', { pageTitle: 'Checkout', checkout, storev2: { video: videos.map(toPdpJson) } });
  }),
);

web.get('/pembayaran/berhasil', route(async (_req, res) => res.renderPage('payment-success', { pageTitle: 'Pembelian Berhasil' })));
web.get('/pembayaran', route(async (_req, res) => res.renderPage('payment-instruction', { pageTitle: 'Selesaikan pembayaran' })));
web.get('/pembayaran/:id/berhasil', route(async (_req, res) => res.renderPage('payment-success', { pageTitle: 'Pembelian Berhasil' })));
web.get('/pembayaran/:id', route(async (_req, res) => res.renderPage('payment-instruction', { pageTitle: 'Selesaikan pembayaran' })));

web.get('/pesanan/diambil', route(async (_req, res) => res.renderPage('pickup-success', { pageTitle: 'Pesanan berhasil diambil' })));
web.get('/pesanan', route(async (_req, res) => res.renderPage('order-detail', { pageTitle: 'Detail Transaksi' })));
web.get('/pesanan/:id/diambil', route(async (_req, res) => res.renderPage('pickup-success', { pageTitle: 'Pesanan berhasil diambil' })));
web.get('/pesanan/:id', route(async (_req, res) => res.renderPage('order-detail', { pageTitle: 'Detail Transaksi' })));

web.get('/akun', route(async (_req, res) => res.renderPage('account', { pageTitle: 'Akun' })));

// ───────────── Redirect URL prototipe (*.html) ─────────────

const LEGACY: Record<string, (q: URLSearchParams) => string> = {
  'index.html': () => '/',
  'semua-produk.html': (q) => withQuery('/produk', q),
  'category.html': () => '/produk',
  'collection.html': () => '/produk',
  'koleksi.html': (q) => withQuery(`/koleksi/${q.get('tab') || 'terlaris'}`, q, ['tab']),
  'search.html': (q) => withQuery('/cari', q),
  'detail.html': (q) => (q.get('product') ? `/produk/${q.get('product')}` : '/produk'),
  'detail-apparel.html': (q) => (q.get('product') ? `/produk/${q.get('product')}` : '/produk'),
  'detail-video.html': (q) => (q.get('product') ? `/produk/${q.get('product')}` : '/produk'),
  'wishlist.html': (q) => withQuery('/wishlist', q),
  'cart.html': (q) => withQuery('/keranjang', q),
  'payment.html': (q) => withQuery('/checkout', q),
  'payment-instruction.html': (q) => withQuery(q.get('id') ? `/pembayaran/${q.get('id')}` : '/pembayaran', q, ['id']),
  'payment-success.html': (q) => (q.get('id') ? `/pembayaran/${q.get('id')}/berhasil` : '/pembayaran/berhasil'),
  'pickup-success.html': (q) => (q.get('id') ? `/pesanan/${q.get('id')}/diambil` : '/pesanan/diambil'),
  'order-detail.html': (q) => withQuery(q.get('id') ? `/pesanan/${q.get('id')}` : '/pesanan', q, ['id']),
  'account.html': (q) => withQuery('/akun', q),
};

function withQuery(path: string, q: URLSearchParams, drop: string[] = []) {
  const rest = new URLSearchParams(q);
  for (const key of drop) rest.delete(key);
  const s = rest.toString();
  return s ? `${path}?${s}` : path;
}

web.get(/^\/(?:store-v2\/)?([a-z-]+\.html)$/, (req, res, next) => {
  const file = String((req.params as Record<string, string>)[0]);
  const target = LEGACY[file];
  if (!target) return next();
  const query = new URLSearchParams(req.url.split('?')[1] ?? '');
  res.redirect(301, target(query));
});
