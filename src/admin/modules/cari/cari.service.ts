/**
 * Pencarian global CMS (kotak cari di dashboard & halaman /admin/cari): satu kata kunci ke beberapa modul sekaligus,
 * hasil dikelompokkan per modul dan hanya modul yang boleh dilihat peran akun.
 */
import { prisma } from '../../../lib/prisma.js';
import { formatRupiah } from '../../../lib/format.js';
import { INVOICE_PATTERN } from '../../../lib/invoice.js';
import type { AdminRole, Prisma } from '../../../generated/prisma/client.js';
import { can, ROLE_LABELS } from '../../permissions.js';
import { orderSearchWhere, statusBadge } from '../pesanan/pesanan.view.js';
import { displayStatus } from '../produk/produk.service.js';
import { promoStatus } from '../promo/promo.routes.js';

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

export type SearchItem = {
  title: string;
  subtitle?: string;
  href: string;
  image?: string | null;
  badge?: { label: string; tone: string } | null;
};

export type SearchGroup = {
  key: string;
  label: string;
  icon: string;
  total: number;
  items: SearchItem[];
  /** Halaman daftar modul dengan kata kunci yang sama (kalau modulnya punya pencarian). */
  moreHref?: string;
};

const inactive = (active: boolean) => (active ? null : { label: 'Nonaktif', tone: 'plain' });

/** Kata kunci → teks bersih (spasi dirapikan), atau '' kalau terlalu pendek. */
export function normalizeQuery(raw: unknown) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  return text.length >= MIN_QUERY ? text : '';
}

/** Kecocokan pasti yang langsung dibuka (no invoice atau no resi lengkap). */
export async function directMatch(roles: readonly AdminRole[], text: string) {
  if (!can(roles, 'pesanan')) return null;
  const upper = text.toUpperCase();
  const order = INVOICE_PATTERN.test(upper)
    ? await prisma.order.findUnique({ where: { invoiceNo: upper }, select: { invoiceNo: true } })
    : /^[A-Z0-9-]{8,40}$/.test(upper)
      ? await prisma.order.findFirst({ where: { trackingNo: upper }, select: { invoiceNo: true } })
      : null;
  return order ? `/admin/pesanan/${order.invoiceNo}` : null;
}

export async function globalSearch(roles: readonly AdminRole[], text: string, limit = 5): Promise<SearchGroup[]> {
  if (!text) return [];
  const enc = encodeURIComponent(text);
  const now = new Date();
  const tasks: Promise<SearchGroup>[] = [];

  if (can(roles, 'pesanan')) {
    const where = orderSearchWhere(text);
    tasks.push(
      Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          select: { invoiceNo: true, status: true, buyerName: true, total: true, trackingNo: true },
        }),
      ]).then(([total, rows]) => ({
        key: 'pesanan',
        label: 'Pesanan',
        icon: 'receipt',
        total,
        moreHref: `/admin/pesanan?status=semua&q=${enc}`,
        items: rows.map((o) => ({
          title: o.invoiceNo,
          subtitle: [o.buyerName, formatRupiah(o.total), o.trackingNo ? `resi ${o.trackingNo}` : null].filter(Boolean).join(' · '),
          href: `/admin/pesanan/${o.invoiceNo}`,
          badge: statusBadge(o),
        })),
      })),
    );
  }

  if (can(roles, 'produk')) {
    const where: Prisma.ProductWhereInput = {
      OR: [
        { title: { contains: text } },
        { slug: { contains: text } },
        { sku: { contains: text } },
        { variants: { some: { OR: [{ sku: { contains: text } }, { barcode: text }] } } },
      ],
    };
    tasks.push(
      Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            title: true,
            sku: true,
            status: true,
            publishedAt: true,
            category: { select: { name: true } },
            images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
            variants: { where: { sku: { contains: text } }, take: 1, select: { sku: true } },
          },
        }),
      ]).then(([total, rows]) => ({
        key: 'produk',
        label: 'Produk',
        icon: 'package',
        total,
        moreHref: `/admin/produk?q=${enc}`,
        items: rows.map((p) => ({
          title: p.title,
          subtitle: [p.variants[0]?.sku ?? p.sku, p.category?.name].filter(Boolean).join(' · '),
          href: `/admin/produk/${p.id}`,
          image: p.images[0]?.url ?? null,
          badge: displayStatus(p, now),
        })),
      })),
    );
  }

  if (can(roles, 'kategori')) {
    const where: Prisma.CategoryWhereInput = { OR: [{ name: { contains: text } }, { slug: { contains: text } }] };
    tasks.push(
      Promise.all([
        prisma.category.count({ where }),
        prisma.category.findMany({ where, orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }], take: limit, include: { parent: { select: { name: true } } } }),
      ]).then(([total, rows]) => ({
        key: 'kategori',
        label: 'Kategori',
        icon: 'tree-structure',
        total,
        items: rows.map((c) => ({
          title: c.name,
          subtitle: c.parent ? `Subkategori ${c.parent.name}` : 'Kategori utama',
          href: `/admin/kategori/${c.id}`,
          badge: inactive(c.isActive),
        })),
      })),
    );
  }

  if (can(roles, 'promo')) {
    const where: Prisma.PromoCodeWhereInput = { code: { contains: text.toUpperCase() } };
    tasks.push(
      Promise.all([prisma.promoCode.count({ where }), prisma.promoCode.findMany({ where, orderBy: { code: 'asc' }, take: limit })]).then(([total, rows]) => ({
        key: 'promo',
        label: 'Promo',
        icon: 'ticket',
        total,
        moreHref: `/admin/promo?q=${enc}`,
        items: rows.map((p) => {
          const status = promoStatus(p, now);
          return {
            title: p.code,
            subtitle: p.type === 'PERCENT' ? `Diskon ${p.value}%` : `Potongan ${formatRupiah(p.value)}`,
            href: `/admin/promo/${p.id}`,
            badge: { label: status.label, tone: status.tone || 'plain' },
          };
        }),
      })),
    );
  }

  if (can(roles, 'menu')) {
    const where: Prisma.CollectionWhereInput = { OR: [{ title: { contains: text } }, { key: { contains: text } }] };
    tasks.push(
      Promise.all([prisma.collection.count({ where }), prisma.collection.findMany({ where, orderBy: { sortOrder: 'asc' }, take: limit })]).then(([total, rows]) => ({
        key: 'koleksi',
        label: 'Koleksi',
        icon: 'stack',
        total,
        items: rows.map((c) => ({ title: c.title, subtitle: `/koleksi/${c.key}`, href: `/admin/koleksi/${c.id}`, badge: inactive(c.isActive) })),
      })),
    );
  }

  if (can(roles, 'tampilan')) {
    const sectionWhere: Prisma.HomeSectionWhereInput = { OR: [{ title: { contains: text } }, { key: { contains: text } }] };
    const bannerWhere: Prisma.BannerWhereInput = { title: { contains: text } };
    tasks.push(
      Promise.all([prisma.homeSection.count({ where: sectionWhere }), prisma.homeSection.findMany({ where: sectionWhere, orderBy: { sortOrder: 'asc' }, take: limit })]).then(
        ([total, rows]) => ({
          key: 'seksi',
          label: 'Seksi produk',
          icon: 'rows',
          total,
          items: rows.map((s) => ({ title: s.title, subtitle: s.source === 'MANUAL' ? 'Pilihan manual' : 'Aturan otomatis', href: `/admin/seksi/${s.id}`, badge: inactive(s.isActive) })),
        }),
      ),
      Promise.all([prisma.banner.count({ where: bannerWhere }), prisma.banner.findMany({ where: bannerWhere, orderBy: { id: 'desc' }, take: limit })]).then(([total, rows]) => ({
        key: 'banner',
        label: 'Banner hero',
        icon: 'image',
        total,
        items: rows.map((b) => ({ title: b.title, href: `/admin/banner/${b.id}`, badge: inactive(b.isActive) })),
      })),
    );
  }

  if (can(roles, 'pengguna')) {
    const where: Prisma.AdminUserWhereInput = { OR: [{ name: { contains: text } }, { email: { contains: text } }] };
    tasks.push(
      Promise.all([
        prisma.adminUser.count({ where }),
        prisma.adminUser.findMany({ where, orderBy: { name: 'asc' }, take: limit, include: { roles: true } }),
      ]).then(([total, rows]) => ({
        key: 'pengguna',
        label: 'Pengguna CMS',
        icon: 'users-three',
        total,
        items: rows.map((u) => ({
          title: u.name,
          subtitle: [u.email, u.roles.map((r) => ROLE_LABELS[r.role]).join(', ')].filter(Boolean).join(' · '),
          href: `/admin/pengguna/${u.id}`,
          badge: inactive(u.isActive),
        })),
      })),
    );
  }

  return (await Promise.all(tasks)).filter((g) => g.total > 0);
}
