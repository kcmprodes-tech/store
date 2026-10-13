/**
 * Bagian bersama seksi produk & koleksi: aturan isi dari form, pemilih produk, dan ringkasan aturan.
 */
import { Router } from 'express';
import { formatRupiah } from '../../../lib/format.js';
import { prisma } from '../../../lib/prisma.js';
import { resolveFeed, type FeedRules } from '../../../modules/catalog/catalog.service.js';
import { handle, HttpError } from '../../http.js';
import { can } from '../../permissions.js';

/** Field form aturan (ruleCategory "kategori" atau "kategori/sub", ruleDiscounted, ruleRecentDays, ruleSort) → FeedRules. */
export function rulesFromForm(body: Record<string, unknown>): FeedRules {
  const rules: FeedRules = {};
  const cat = typeof body.ruleCategory === 'string' ? body.ruleCategory.trim() : '';
  if (cat) {
    const [kcat, ksub] = cat.split('/');
    if (kcat) rules.kcat = kcat;
    if (ksub) rules.ksub = ksub;
  }
  if (body.ruleDiscounted === 'on' || body.ruleDiscounted === true) rules.discounted = true;
  const days = Number(body.ruleRecentDays);
  if (Number.isInteger(days) && days > 0 && days <= 3650) rules.recentDays = days;
  if (body.ruleSort === 'terlaris') rules.sort = 'terlaris';
  return rules;
}

/** FeedRules → nilai field form. */
export function rulesToForm(rules: FeedRules) {
  return {
    ruleCategory: rules.ksub ? `${rules.kcat ?? ''}/${rules.ksub}` : (rules.kcat ?? ''),
    ruleDiscounted: Boolean(rules.discounted),
    ruleRecentDays: rules.recentDays ?? '',
    ruleSort: rules.sort ?? 'terbaru',
  };
}

/** "1,5,9" (urutan pemilih produk) → [1,5,9] tanpa duplikat. */
export function productIdsFromForm(value: unknown): number[] {
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const ids = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, 200);
}

/** Pilihan kategori untuk aturan: "kategori" dan "kategori/sub". */
export async function ruleCategoryOptions() {
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return categories
    .filter((c) => !c.parentId)
    .flatMap((p) => [
      { value: p.slug, label: p.name },
      ...categories.filter((c) => c.parentId === p.id).map((c) => ({ value: `${p.slug}/${c.slug}`, label: `${p.name} › ${c.name}` })),
    ]);
}

/** Ringkasan aturan untuk daftar CMS, mis. "Merchandise › Apparel · diskon · terlaris". */
export async function describeRules(rules: FeedRules) {
  const parts: string[] = [];
  if (rules.kcat || rules.ksub) {
    const slugs = [rules.kcat, rules.ksub].filter(Boolean) as string[];
    const cats = await prisma.category.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } });
    const name = (s?: string) => cats.find((c) => c.slug === s)?.name ?? s;
    parts.push(rules.ksub ? `${name(rules.kcat)} › ${name(rules.ksub)}` : String(name(rules.kcat)));
  } else {
    parts.push('Semua kategori');
  }
  if (rules.discounted) parts.push('hanya diskon');
  if (rules.recentDays) parts.push(`tayang ${rules.recentDays} hari terakhir`);
  parts.push(rules.sort === 'terlaris' ? 'urut terlaris' : 'urut terbaru');
  return parts.join(' · ');
}

type PickerProduct = { id: number; title: string; image: string; status: string; price: string };

const STATUS: Record<string, string> = { DRAFT: 'Draft', PUBLISHED: 'Tayang', ARCHIVED: 'Arsip' };

function toPicker(p: {
  id: number;
  title: string;
  status: string;
  publishedAt: Date | null;
  images: { url: string }[];
  variants: { price: number }[];
}): PickerProduct {
  const scheduled = p.status === 'PUBLISHED' && p.publishedAt && p.publishedAt > new Date();
  return {
    id: p.id,
    title: p.title,
    image: p.images[0]?.url ?? '',
    status: scheduled ? 'Terjadwal' : (STATUS[p.status] ?? p.status),
    price: p.variants[0] ? formatRupiah(p.variants[0].price) : '',
  };
}

const pickerSelect = {
  id: true,
  title: true,
  status: true,
  publishedAt: true,
  images: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true } },
  variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' as const }, take: 1, select: { price: true } },
};

/** Produk terpilih (berurutan) untuk pemilih produk di form. */
export async function pickerProducts(ids: number[]) {
  if (!ids.length) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: pickerSelect });
  const byId = new Map(rows.map((r) => [r.id, toPicker(r)]));
  return ids.map((id) => byId.get(id)).filter((p): p is PickerProduct => Boolean(p));
}

// ───────────── API untuk form (pencarian produk & pratinjau aturan) ─────────────

export const feedApiRouter = Router();

feedApiRouter.use('/api', (req, _res, next) => {
  const roles = req.admin?.roles ?? [];
  if (can(roles, 'produk') || can(roles, 'tampilan') || can(roles, 'menu')) return next();
  next(new HttpError(403, 'Tidak ada akses.'));
});

feedApiRouter.get(
  '/api/produk',
  handle(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = await prisma.product.findMany({
      where: q
        ? { OR: [{ title: { contains: q } }, { slug: { contains: q } }, { sku: { contains: q } }, { variants: { some: { sku: { contains: q } } } }] }
        : {},
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
      select: pickerSelect,
    });
    res.json({ items: rows.map(toPicker) });
  }),
);

feedApiRouter.get(
  '/api/pratinjau',
  handle(async (req, res) => {
    const rules = rulesFromForm(req.query as Record<string, unknown>);
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 8));
    const products = await resolveFeed(rules, [], limit);
    res.json({
      items: products.map((p) => ({
        id: p.id,
        title: p.title,
        image: p.images[0]?.url ?? '',
        status: 'Tayang',
        price: p.variants[0] ? formatRupiah(p.variants[0].price) : '',
      })),
    });
  }),
);

