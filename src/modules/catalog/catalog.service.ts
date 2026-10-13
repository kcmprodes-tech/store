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

/** Semua produk tayang, urutan default = waktu tayang terbaru dulu. */
export function listPublished(where: Prisma.ProductWhereInput = {}) {
  return prisma.product.findMany({
    where: { AND: [publishedWhere(), where] },
    include: productInclude,
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
  });
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

export async function getHomeSections() {
  const sections = await prisma.homeSection.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        where: { product: publishedWhere() },
        include: { product: { include: productInclude } },
      },
    },
  });
  return Object.fromEntries(sections.map((s) => [s.key, s.items.map((i) => i.product)])) as Record<
    string,
    ProductWithRelations[]
  >;
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

export type CollectionRules = {
  only?: boolean;
  discounted?: boolean;
  kcat?: string;
  ksub?: string;
  /** Hanya produk yang tayang dalam N hari terakhir (urut waktu tayang terbaru). */
  recentDays?: number;
};

/**
 * Produk untuk tab koleksi: produk kurasi di depan (urutan CMS), lalu sisanya sesuai aturan tab.
 * Sama dengan logika TABS di store-v2.js prototipe.
 */
export async function getCollectionProducts(key: string) {
  const collection = await prisma.collection.findUnique({
    where: { key },
    include: { items: { orderBy: { sortOrder: 'asc' }, include: { product: { include: productInclude } } } },
  });
  if (!collection) return null;
  const rules = (collection.rules ?? {}) as CollectionRules;
  const now = new Date();
  const isLive = (p: ProductWithRelations) => p.status === 'PUBLISHED' && (!p.publishedAt || p.publishedAt <= now);
  const curated = collection.items.map((i) => i.product).filter(isLive);
  if (rules.only) return { collection, products: curated };

  const since = rules.recentDays ? new Date(now.getTime() - rules.recentDays * 86400_000) : null;
  const rest = await listPublished({
    AND: [categoryWhere(rules.kcat, rules.ksub), since ? { publishedAt: { gte: since } } : {}],
  });
  const curatedIds = new Set(curated.map((p) => p.id));
  let products = [...curated, ...rest.filter((p) => !curatedIds.has(p.id))];
  if (rules.discounted) products = products.filter((p) => p.variants.some((v) => v.priceOriginal && v.priceOriginal > v.price));
  return { collection, products };
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
