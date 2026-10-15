/** Produk & varian: daftar, tambah, ubah, arsip, hapus (hanya yang belum pernah punya stok/pesanan), pratinjau. */
import { Router, type Request, type Response } from 'express';
import { formatRupiah } from '../../../lib/format.js';
import { deviceMiddleware } from '../../../lib/device.js';
import { prisma } from '../../../lib/prisma.js';
import { productInclude } from '../../../modules/catalog/catalog.service.js';
import { invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import { renderMiddleware } from '../../../view/engine.js';
import { productUrl } from '../../../view/mappers.js';
import { renderProductPage } from '../../../web/routes.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, handle, HttpError, pageParam, q, redirectWith, requirePermission, slugify } from '../../http.js';
import { defaultLowStockThreshold, resetLowStockCache } from '../stok/stok.service.js';
import { auditSnapshot, displayStatus, editInclude, parseProductForm, sanitizeDescription, saveProduct, toFormValues, TYPE_LABELS } from './produk.service.js';

export const produkRouter = Router();
produkRouter.use('/produk', requirePermission('produk', 'view'));
const editOnly = requirePermission('produk', 'edit');
const PER_PAGE = 25;

const STATUS_FILTERS = {
  semua: { label: 'Semua', where: (): Prisma.ProductWhereInput => ({ status: { not: 'ARCHIVED' } }) },
  tayang: {
    label: 'Tayang',
    where: (now: Date): Prisma.ProductWhereInput => ({ status: 'PUBLISHED', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] }),
  },
  terjadwal: { label: 'Terjadwal', where: (now: Date): Prisma.ProductWhereInput => ({ status: 'PUBLISHED', publishedAt: { gt: now } }) },
  draft: { label: 'Draft', where: (): Prisma.ProductWhereInput => ({ status: 'DRAFT' }) },
  arsip: { label: 'Arsip', where: (): Prisma.ProductWhereInput => ({ status: 'ARCHIVED' }) },
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

/** Id produk dengan SKU stok habis/menipis (untuk filter daftar). */
async function productIdsByStock(kind: 'habis' | 'menipis') {
  const threshold = await defaultLowStockThreshold();
  const rows = await prisma.$queryRaw<{ productId: number }[]>`
    SELECT DISTINCT v.product_id AS productId FROM (
      SELECT v.id, v.product_id, v.low_stock_threshold, COALESCE(SUM(l.on_hand - l.reserved), 0) AS available
      FROM product_variants v LEFT JOIN inventory_levels l ON l.variant_id = v.id
      WHERE v.track_stock = 1 AND v.is_active = 1
      GROUP BY v.id, v.product_id, v.low_stock_threshold
    ) v
    WHERE ${kind === 'habis' ? Prisma.sql`v.available <= 0` : Prisma.sql`v.available <= COALESCE(v.low_stock_threshold, ${threshold})`}`;
  return rows.map((r) => Number(r.productId));
}

produkRouter.get(
  '/produk',
  handle(async (req, res) => {
    const now = new Date();
    const status: StatusFilter = (q(req.query.status) in STATUS_FILTERS ? q(req.query.status) : 'semua') as StatusFilter;
    const search = q(req.query.q).slice(0, 100);
    const type = q(req.query.jenis);
    const categoryId = Number(req.query.kategori) || null;
    const stock = q(req.query.stok) === 'habis' || q(req.query.stok) === 'menipis' ? (q(req.query.stok) as 'habis' | 'menipis') : null;
    const page = pageParam(req.query.hal);

    const filters: Prisma.ProductWhereInput[] = [];
    if (search) {
      filters.push({ OR: [{ title: { contains: search } }, { slug: { contains: search } }, { sku: { contains: search } }, { variants: { some: { sku: { contains: search } } } }] });
    }
    if (type in TYPE_LABELS) filters.push({ type: type as keyof typeof TYPE_LABELS });
    if (categoryId) filters.push({ OR: [{ categoryId }, { category: { parentId: categoryId } }] });
    if (stock) filters.push({ id: { in: await productIdsByStock(stock) } });
    const base: Prisma.ProductWhereInput = { AND: filters };
    const where: Prisma.ProductWhereInput = { AND: [base, STATUS_FILTERS[status].where(now)] };

    const [total, products, counts, categories] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
        include: {
          category: { include: { parent: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { inventory: true } },
        },
      }),
      Promise.all(
        (Object.keys(STATUS_FILTERS) as StatusFilter[]).map(async (key) => [key, await prisma.product.count({ where: { AND: [base, STATUS_FILTERS[key].where(now)] } })] as const),
      ),
      prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    ]);

    const threshold = await defaultLowStockThreshold();
    const rows = products.map((p) => {
      const prices = p.variants.map((v) => v.price);
      const tracked = p.variants.filter((v) => v.trackStock);
      const available = tracked.map((v) => v.inventory.reduce((n, l) => n + l.onHand - l.reserved, 0));
      const low = tracked.some((v, i) => available[i]! <= (v.lowStockThreshold ?? threshold));
      return {
        ...p,
        image: p.images[0]?.url ?? '',
        categoryName: p.category ? (p.category.parent ? `${p.category.parent.name} › ${p.category.name}` : p.category.name) : '—',
        priceText: prices.length ? `${new Set(prices).size > 1 ? 'mulai ' : ''}${formatRupiah(Math.min(...prices))}${p.priceSuffix ?? ''}` : '—',
        stock: tracked.length ? available.reduce((a, b) => a + Math.max(0, b), 0) : null,
        stockLow: low,
        skuCount: p.variants.length,
        typeLabel: TYPE_LABELS[p.type],
        status: displayStatus(p, now),
      };
    });

    const parents = categories.filter((c) => !c.parentId);
    const params = (patch: Record<string, string | number | null>) => {
      const s = new URLSearchParams();
      const merged: Record<string, string | number | null> = { q: search, status, jenis: type, kategori: categoryId, stok: stock, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v !== null && v !== '' && !(k === 'status' && v === 'semua')) s.set(k, String(v));
      const str = s.toString();
      return `/admin/produk${str ? `?${str}` : ''}`;
    };
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));

    await res.renderAdmin('produk/index', {
      pageTitle: 'Produk',
      active: 'produk',
      canEdit: canEdit(req, 'produk'),
      products: rows,
      total,
      filters: { q: search, status, jenis: type, kategori: categoryId, stok: stock },
      tabs: counts.map(([key, count]) => ({ key, label: STATUS_FILTERS[key].label, count, active: key === status, href: params({ status: key, hal: null }) })),
      types: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
      categoryOptions: parents.flatMap((p) => [
        { id: p.id, name: p.name },
        ...categories.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: `— ${c.name}` })),
      ]),
      page,
      pages,
      prevHref: page > 1 ? params({ hal: page - 1 }) : null,
      nextHref: page < pages ? params({ hal: page + 1 }) : null,
      resetHref: search || type || categoryId || stock ? params({ q: null, jenis: null, kategori: null, stok: null, hal: null }) : null,
    });
  }),
);

// ───────────── Form ─────────────

async function formOptions() {
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return {
    types: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
    categoryOptions: categories
      .filter((c) => !c.parentId)
      .flatMap((p) => [{ id: p.id, name: p.name }, ...categories.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: `${p.name} › ${c.name}` }))]),
    defaultThreshold: await defaultLowStockThreshold(),
  };
}

async function renderForm(req: Request, res: Response, data: Record<string, unknown>, status = 200) {
  const values = data.values as Record<string, unknown>;
  await res.renderAdmin(
    'produk/form',
    {
      active: 'produk',
      backHref: '/admin/produk',
      scripts: ['/cms/product-editor.js'],
      readOnly: !canEdit(req, 'produk'),
      ...(await formOptions()),
      // State awal editor dinamis (foto, spesifikasi, opsi, SKU) untuk admin.js
      editorState: {
        images: values.images ?? [],
        specs: values.specs ?? [],
        optionMode: values.optionMode ?? 'NONE',
        optVarian: values.optVarian ?? [],
        optWarna: values.optWarna ?? [],
        optUkuran: values.optUkuran ?? [],
        variants: values.variants ?? [],
        errors: data.errors ?? {},
      },
      ...data,
    },
    status,
  );
}

/** Body form → nilai untuk dirender ulang ketika ada error. */
function resubmitted(body: Record<string, unknown>) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  return {
    ...body,
    description: sanitizeDescription(typeof body.description === 'string' ? body.description : ''),
    specs: arr(body.specs),
    images: arr(body.images),
    optVarian: arr(body.optVarian),
    optWarna: arr(body.optWarna),
    optUkuran: arr(body.optUkuran),
    variants: arr(body.variants).map((v) => ({ ...(v as object), isActive: (v as Record<string, unknown>).isActive === 'on', trackStock: (v as Record<string, unknown>).trackStock === 'on' })),
    video: body.video ?? {},
  };
}

produkRouter.get(
  '/produk/baru',
  editOnly,
  handle(async (req, res) => {
    await renderForm(req, res, {
      pageTitle: 'Produk baru',
      values: {
        type: 'PHYSICAL',
        status: 'DRAFT',
        optionMode: 'NONE',
        specs: [],
        images: [],
        variants: [{ id: '', sku: '', price: '', priceOriginal: '', isActive: true, trackStock: true, lowStockThreshold: '', imageIndex: '' }],
        video: {},
      },
    });
  }),
);

function loadForEdit(id: number) {
  return prisma.product.findUnique({ where: { id }, include: editInclude });
}

produkRouter.post(
  '/produk',
  editOnly,
  handle(async (req, res) => {
    const body = { ...req.body, slug: req.body?.slug || slugify(String(req.body?.title ?? ''), 191) };
    const { form, errors } = await parseProductForm(body);
    if (!form || Object.keys(errors).length) {
      return renderForm(req, res, { pageTitle: 'Produk baru', values: resubmitted(body), errors }, 400);
    }
    const product = await prisma.$transaction(async (tx) => {
      const created = await saveProduct(tx, form, null);
      const after = await tx.product.findUniqueOrThrow({ where: { id: created.id }, include: editInclude });
      await audit(tx, req, { action: 'create', entityType: 'product', entityId: created.id, entityLabel: created.title, changes: diff(null, auditSnapshot(after)) });
      return created;
    });
    resetLowStockCache();
    invalidateStorefront();
    const hint = form.variants.some((v) => v.trackStock) ? ' Isi stok awal lewat menu Stok → Barang masuk.' : '';
    redirectWith(res, `/admin/produk/${product.id}`, 'success', `Produk "${product.title}" dibuat.${hint}`);
  }),
);

produkRouter.get(
  '/produk/:id',
  handle(async (req, res) => {
    const product = await loadForEdit(Number(req.params.id));
    if (!product) throw new HttpError(404, 'Produk tidak ditemukan.');
    const deletable = product.variants.every((v) => v._count.movements + v._count.orderItems + v._count.cartItems === 0);
    await renderForm(req, res, {
      pageTitle: product.title,
      product,
      status: displayStatus(product),
      storeHref: productUrl(product),
      deletable,
      values: toFormValues(product),
    });
  }),
);

produkRouter.post(
  '/produk/:id',
  editOnly,
  handle(async (req, res) => {
    const before = await loadForEdit(Number(req.params.id));
    if (!before) throw new HttpError(404, 'Produk tidak ditemukan.');
    const { form, errors } = await parseProductForm(req.body, before.id);
    if (!form || Object.keys(errors).length) {
      return renderForm(req, res, { pageTitle: before.title, product: before, status: displayStatus(before), values: resubmitted(req.body), errors }, 400);
    }
    await prisma.$transaction(async (tx) => {
      await saveProduct(tx, form, before);
      const after = await tx.product.findUniqueOrThrow({ where: { id: before.id }, include: editInclude });
      await audit(tx, req, { action: 'update', entityType: 'product', entityId: before.id, entityLabel: after.title, changes: diff(auditSnapshot(before), auditSnapshot(after)) });
    });
    resetLowStockCache();
    invalidateStorefront();
    redirectWith(res, `/admin/produk/${before.id}`, 'success', `Produk "${form.core.title}" disimpan.`);
  }),
);

produkRouter.post(
  '/produk/:id/arsip',
  editOnly,
  handle(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) } });
    if (!product) throw new HttpError(404, 'Produk tidak ditemukan.');
    const status = product.status === 'ARCHIVED' ? 'DRAFT' : 'ARCHIVED';
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { status } });
      await audit(tx, req, { action: status === 'ARCHIVED' ? 'archive' : 'update', entityType: 'product', entityId: product.id, entityLabel: product.title, changes: { status: [product.status, status] } });
    });
    resetLowStockCache();
    redirectWith(res, `/admin/produk/${product.id}`, 'success', status === 'ARCHIVED' ? `"${product.title}" diarsipkan dan tidak tampil di store.` : `"${product.title}" dikembalikan sebagai draft.`);
  }),
);

produkRouter.post(
  '/produk/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const product = await loadForEdit(Number(req.params.id));
    if (!product) throw new HttpError(404, 'Produk tidak ditemukan.');
    const used = product.variants.some((v) => v._count.movements + v._count.orderItems + v._count.cartItems > 0);
    if (used) {
      return redirectWith(res, `/admin/produk/${product.id}`, 'error', 'Produk ini punya riwayat stok atau pesanan, jadi tidak bisa dihapus. Arsipkan saja supaya tidak tampil di store.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id: product.id } });
      await audit(tx, req, { action: 'delete', entityType: 'product', entityId: product.id, entityLabel: product.title, changes: diff(auditSnapshot(product), null) });
    });
    resetLowStockCache();
    invalidateStorefront();
    redirectWith(res, '/admin/produk', 'success', `Produk "${product.title}" dihapus.`);
  }),
);

// ───────────── Pratinjau (template detail store, termasuk produk draft/terjadwal) ─────────────

const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "connect-src 'self'",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

produkRouter.get(
  '/produk/:id/pratinjau',
  deviceMiddleware,
  renderMiddleware,
  handle(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: productInclude });
    if (!product) throw new HttpError(404, 'Produk tidak ditemukan.');
    res.set('Content-Security-Policy', PREVIEW_CSP);
    await renderProductPage(res, product);
  }),
);
