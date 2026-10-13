import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Relasi yang dibutuhkan kartu produk dan halaman detail. */
export const productInclude = {
  category: { include: { parent: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  options: { orderBy: { sortOrder: 'asc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } },
  variants: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      inventory: true,
      optionValues: { include: { optionValue: { include: { option: true } } } },
    },
  },
  video: true,
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** Produk tayang: status PUBLISHED dan waktu tayang sudah lewat (jadwal tayang di masa depan belum tampil). */
export function publishedWhere(now = new Date()): Prisma.ProductWhereInput {
  return { status: 'PUBLISHED', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] };
}

const NEWEST_FIRST: Prisma.ProductOrderByWithRelationInput[] = [{ publishedAt: 'desc' }, { id: 'asc' }];
const BEST_SELLING: Prisma.ProductOrderByWithRelationInput[] = [{ soldCount: 'desc' }, ...NEWEST_FIRST];

/** Semua produk tayang, urutan default = waktu tayang terbaru dulu. */
export function listPublished(
  where: Prisma.ProductWhereInput = {},
  orderBy: Prisma.ProductOrderByWithRelationInput[] = NEWEST_FIRST,
  take?: number,
) {
  return prisma.product.findMany({ where: { AND: [publishedWhere(), where] }, include: productInclude, orderBy, take });
}

/** Filter kategori (?category=&sub=) seperti halaman Semua produk. */
export function categoryWhere(category?: string, sub?: string): Prisma.ProductWhereInput {
  if (sub) return { category: { slug: sub } };
  if (category) return { OR: [{ category: { slug: category } }, { category: { parent: { slug: category } } }] };
  return {};
}

export function getProductBySlug(slug: string) {
  return prisma.product.findFirst({ where: { AND: [{ slug }, publishedWhere()] }, include: productInclude });
}

export function getBanners(now = new Date()) {
  return prisma.banner.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Aturan isi otomatis seksi produk dan koleksi.
 * - kcat/ksub: kategori/sub (slug); discounted: hanya yang diskon; recentDays: tayang N hari terakhir
 * - sort: terbaru (default) atau terlaris (soldCount; masih statis dari seed sampai Tahap 3)
 * - only: hanya produk kurasi (tanpa produk lain dari aturan)
 */
export const feedRulesSchema = z.object({
  kcat: z.string().max(80).optional(),
  ksub: z.string().max(80).optional(),
  discounted: z.boolean().optional(),
  recentDays: z.number().int().positive().max(3650).optional(),
  sort: z.enum(['terbaru', 'terlaris']).optional(),
  only: z.boolean().optional(),
});
export type FeedRules = z.infer<typeof feedRulesSchema>;

/** Rules JSON dari database → FeedRules (data rusak dianggap tanpa aturan). */
export function parseRules(value: unknown): FeedRules {
  const parsed = feedRulesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function isLive(p: ProductWithRelations, now: Date) {
  return p.status === 'PUBLISHED' && (!p.publishedAt || p.publishedAt <= now);
}

function isDiscounted(p: ProductWithRelations) {
  return p.variants.some((v) => v.priceOriginal && v.priceOriginal > v.price);
}

/**
 * Isi seksi/koleksi: produk kurasi di depan (urutan CMS), lalu produk lain sesuai aturan.
 * Filter diskon diterapkan sebelum batas jumlah.
 */
export async function resolveFeed(rules: FeedRules, curated: ProductWithRelations[] = [], limit?: number) {
  const now = new Date();
  const live = curated.filter((p) => isLive(p, now));
  let products = live;
  if (!rules.only) {
    const since = rules.recentDays ? new Date(now.getTime() - rules.recentDays * 86400_000) : null;
    const where: Prisma.ProductWhereInput = {
      AND: [categoryWhere(rules.kcat, rules.ksub), since ? { publishedAt: { gte: since } } : {}],
    };
    // Tanpa kurasi & filter diskon, batas jumlah bisa langsung dipakai di query.
    const take = limit && !live.length && !rules.discounted ? limit : undefined;
    const rest = await listPublished(where, rules.sort === 'terlaris' ? BEST_SELLING : NEWEST_FIRST, take);
    const curatedIds = new Set(live.map((p) => p.id));
    products = [...live, ...rest.filter((p) => !curatedIds.has(p.id))];
  }
  if (rules.discounted) products = products.filter(isDiscounted);
  return limit ? products.slice(0, limit) : products;
}

/** Produk untuk halaman koleksi /koleksi/:key; null = tidak ada atau nonaktif. */
export async function getCollectionProducts(key: string) {
  const collection = await prisma.collection.findFirst({
    where: { key, isActive: true },
    include: { items: { orderBy: { sortOrder: 'asc' }, include: { product: { include: productInclude } } } },
  });
  if (!collection) return null;
  const products = await resolveFeed(parseRules(collection.rules), collection.items.map((i) => i.product));
  return { collection, products };
}

const sectionInclude = {
  items: {
    orderBy: { sortOrder: 'asc' },
    where: { product: publishedWhere() },
    include: { product: { include: productInclude } },
  },
  seeAllCollection: true,
  seeAllCategory: { include: { parent: true, landingCollection: true } },
} satisfies Prisma.HomeSectionInclude;

export type SectionWithRelations = Prisma.HomeSectionGetPayload<{ include: typeof sectionInclude }>;

/** Produk seksi: manual = item kurasi; aturan = otomatis. `limit` false = semua (halaman /seksi/:key). */
export function sectionProducts(section: SectionWithRelations, limit: number | false = section.productLimit) {
  const curated = section.items.map((i) => i.product);
  const rules = section.source === 'RULE' ? parseRules(section.rules) : { only: true };
  return resolveFeed(rules, section.source === 'RULE' ? [] : curated, limit === false ? undefined : limit);
}

/** Seksi produk beranda yang aktif, berurutan, beserta produknya (seksi kosong tidak ikut). */
export async function getHomeSections() {
  const sections = await prisma.homeSection.findMany({
    where: { placement: 'HOME', isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: sectionInclude,
  });
  const withProducts = await Promise.all(sections.map(async (section) => ({ section, products: await sectionProducts(section) })));
  return withProducts.filter((s) => s.products.length > 0);
}

/** Seksi untuk halaman /seksi/:key (semua produk); null = tidak ada atau nonaktif. */
export async function getSectionPage(key: string) {
  const section = await prisma.homeSection.findFirst({ where: { key, isActive: true }, include: sectionInclude });
  if (!section) return null;
  return { section, products: await sectionProducts(section, false) };
}

/** "Produk terkait" (halaman detail, keranjang, pencarian). */
export async function getRelatedProducts() {
  const section = await prisma.homeSection.findFirst({
    where: { placement: 'PRODUCT_RELATED', isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: sectionInclude,
  });
  return section ? sectionProducts(section) : [];
}

export async function getWishlistProducts(userId: number) {
  const rows = await prisma.wishlist.findMany({
    where: { userId, product: publishedWhere() },
    orderBy: { createdAt: 'desc' },
    include: { product: { include: productInclude } },
  });
  return rows.map((r) => r.product);
}

export async function getWishlistIds(userId: number | undefined) {
  if (!userId) return new Set<number>();
  const rows = await prisma.wishlist.findMany({ where: { userId }, select: { productId: true } });
  return new Set(rows.map((r) => r.productId));
}

export function listVideos() {
  return listPublished({ type: 'DIGITAL_VIDEO' });
}

/** Stok tersedia per SKU = on_hand − reserved (dijumlah semua lokasi). null = stok tidak dilacak. */
export function availableStock(variant: ProductWithRelations['variants'][number]): number | null {
  if (!variant.trackStock) return null;
  return Math.max(0, variant.inventory.reduce((sum, level) => sum + level.onHand - level.reserved, 0));
}
