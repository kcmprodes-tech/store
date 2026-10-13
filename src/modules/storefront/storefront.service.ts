/**
 * Bagian store yang diatur dari CMS dan tampil di banyak halaman: menu di bawah pencarian,
 * kartu Kategori Pilihan, dan menu Kategori. Di-cache 60 detik; CMS memanggil invalidateStorefront()
 * setiap kali menyimpan supaya perubahan langsung tampil.
 */
import { prisma } from '../../lib/prisma.js';
import { resetWhatsappCache } from '../../lib/settings.js';
import type { Prisma } from '../../generated/prisma/client.js';

export type NavLink = { label: string; href: string; image: string | null };
export type CategoryLink = { slug: string; name: string; href: string };
export type CategoryNode = CategoryLink & { children: CategoryLink[] };

export type StoreChrome = {
  /** Menu di bawah kolom pencarian. */
  searchMenu: NavLink[];
  /** Kartu Kategori Pilihan di beranda. */
  shortcuts: NavLink[];
  /** Menu Kategori (hanya kategori aktif). */
  categories: CategoryNode[];
  /** Label semua kategori untuk filter store-v2.js (termasuk yang disembunyikan, supaya URL lama tetap berlabel). */
  categoryLabels: { cat: Record<string, string>; sub: Record<string, string> };
};

type CategoryForLink = {
  slug: string;
  isActive: boolean;
  parent?: { slug: string; isActive: boolean } | null;
  landingCollection?: { key: string; isActive: boolean } | null;
};

export function collectionHref(key: string) {
  return `/koleksi/${key}`;
}

/** Link kategori: koleksi tujuan (kalau diatur & aktif) atau halaman Semua produk terfilter. */
export function categoryHref(c: CategoryForLink) {
  if (c.landingCollection?.isActive) return collectionHref(c.landingCollection.key);
  return c.parent ? `/produk?category=${c.parent.slug}&sub=${c.slug}` : `/produk?category=${c.slug}`;
}

export function isCategoryVisible(c: CategoryForLink) {
  return c.isActive && (!c.parent || c.parent.isActive);
}

const navInclude = {
  collection: true,
  category: { include: { parent: true, landingCollection: true } },
} satisfies Prisma.NavigationItemInclude;

type NavItemWithTarget = Prisma.NavigationItemGetPayload<{ include: typeof navInclude }>;

/** Tujuan item menu; null = tujuannya nonaktif/hilang sehingga item tidak ditampilkan. */
export function resolveLink(item: NavItemWithTarget): string | null {
  switch (item.linkType) {
    case 'COLLECTION':
      return item.collection?.isActive ? collectionHref(item.collection.key) : null;
    case 'CATEGORY':
      return item.category && isCategoryVisible(item.category) ? categoryHref(item.category) : null;
    case 'URL':
      return item.url || null;
  }
}

function toNavLinks(items: NavItemWithTarget[]): NavLink[] {
  return items.flatMap((item) => {
    const href = resolveLink(item);
    return href ? [{ label: item.label, href, image: item.imageUrl ?? item.collection?.icon ?? null }] : [];
  });
}

async function loadStoreChrome(): Promise<StoreChrome> {
  const [navItems, categories] = await Promise.all([
    prisma.navigationItem.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: navInclude,
    }),
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { landingCollection: true } }),
  ]);

  const parents = categories.filter((c) => c.parentId === null);
  const tree: CategoryNode[] = parents
    .filter((p) => p.isActive)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      href: categoryHref(p),
      children: categories
        .filter((c) => c.parentId === p.id && c.isActive)
        .map((c) => ({ slug: c.slug, name: c.name, href: categoryHref({ ...c, parent: p }) })),
    }));

  return {
    searchMenu: toNavLinks(navItems.filter((i) => i.placement === 'SEARCH_MENU')),
    shortcuts: toNavLinks(navItems.filter((i) => i.placement === 'HOME_SHORTCUT')),
    categories: tree,
    categoryLabels: {
      cat: Object.fromEntries(parents.map((c) => [c.slug, c.name])),
      sub: Object.fromEntries(categories.filter((c) => c.parentId !== null).map((c) => [c.slug, c.name])),
    },
  };
}

let cache: { value: StoreChrome; at: number } | null = null;

export async function getStoreChrome(): Promise<StoreChrome> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = await loadStoreChrome();
  cache = { value, at: Date.now() };
  return value;
}

type SectionForLink = {
  key: string;
  seeAllType: 'NONE' | 'SECTION_PAGE' | 'COLLECTION' | 'CATEGORY' | 'URL';
  seeAllCollection?: { key: string; isActive: boolean } | null;
  seeAllCategory?: CategoryForLink | null;
  seeAllUrl?: string | null;
};

/** Link "Lihat Semua" seksi produk; null = tidak ditampilkan. */
export function sectionSeeAllHref(s: SectionForLink): string | null {
  switch (s.seeAllType) {
    case 'SECTION_PAGE':
      return `/seksi/${s.key}`;
    case 'COLLECTION':
      return s.seeAllCollection?.isActive ? collectionHref(s.seeAllCollection.key) : null;
    case 'CATEGORY':
      return s.seeAllCategory ? categoryHref(s.seeAllCategory) : null;
    case 'URL':
      return s.seeAllUrl || null;
    default:
      return null;
  }
}

/** Buang cache bagian store yang diatur CMS (menu, kategori, nomor WhatsApp). */
export function invalidateStorefront() {
  cache = null;
  resetWhatsappCache();
}
