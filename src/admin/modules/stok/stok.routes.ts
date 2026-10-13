/** Stok per SKU: daftar & peringatan, barang masuk, penyesuaian, riwayat mutasi. Gudang tunggal (Palmerah). */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { Prisma, StockMovementType } from '../../../generated/prisma/client.js';
import { canEdit, handle, HttpError, optionalText, pageParam, q, redirectWith, requirePermission } from '../../http.js';
import { fromDateTimeLocal } from '../../time.js';
import { ADJUST_REASONS, adjustStock, mainLocation, MOVEMENT_LABELS, resetLowStockCache, stockIn, stockRows } from './stok.service.js';

export const stokRouter = Router();
stokRouter.use('/stok', requirePermission('stok', 'view'));
const editOnly = requirePermission('stok', 'edit');
const PER_PAGE = 50;

const STATE_FILTERS = { semua: 'Semua', menipis: 'Menipis', habis: 'Habis', aman: 'Aman' } as const;
type StateFilter = keyof typeof STATE_FILTERS;

stokRouter.get(
  '/stok',
  handle(async (req, res) => {
    const filter: StateFilter = (q(req.query.status) in STATE_FILTERS ? q(req.query.status) : 'semua') as StateFilter;
    const search = q(req.query.q).toLowerCase().slice(0, 100);
    const page = pageParam(req.query.hal);
    const all = await stockRows();
    const matches = search ? all.filter((r) => r.title.toLowerCase().includes(search) || r.sku.toLowerCase().includes(search)) : all;
    // "Menipis" termasuk yang habis: keduanya butuh perhatian.
    const inState = (r: (typeof all)[number], f: StateFilter) => f === 'semua' || r.state === f || (f === 'menipis' && r.state === 'habis');
    const filtered = matches.filter((r) => inState(r, filter)).sort((a, b) => (filter === 'menipis' || filter === 'habis' ? a.available - b.available : 0));
    const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const link = (patch: Record<string, string | number | null>) => {
      const s = new URLSearchParams();
      const merged: Record<string, string | number | null> = { q: search, status: filter, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v !== null && v !== '' && !(k === 'status' && v === 'semua')) s.set(k, String(v));
      return `/admin/stok${s.toString() ? `?${s}` : ''}`;
    };
    await res.renderAdmin('stok/index', {
      pageTitle: 'Stok',
      active: 'stok',
      canEdit: canEdit(req, 'stok'),
      rows: filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
      total: filtered.length,
      filters: { q: search, status: filter },
      tabs: (Object.keys(STATE_FILTERS) as StateFilter[]).map((key) => ({
        key,
        label: STATE_FILTERS[key],
        count: matches.filter((r) => inState(r, key)).length,
        active: key === filter,
        href: link({ status: key, hal: null }),
      })),
      page,
      pages,
      prevHref: page > 1 ? link({ hal: page - 1 }) : null,
      nextHref: page < pages ? link({ hal: page + 1 }) : null,
      location: await mainLocation(),
    });
  }),
);

// ───────────── API pencarian SKU untuk form stok ─────────────

stokRouter.get(
  '/stok/api/sku',
  handle(async (req, res) => {
    const search = q(req.query.q).slice(0, 100);
    const variants = await prisma.productVariant.findMany({
      where: {
        trackStock: true,
        isActive: true,
        ...(search ? { OR: [{ sku: { contains: search } }, { name: { contains: search } }, { product: { title: { contains: search } } }] } : {}),
      },
      orderBy: [{ product: { updatedAt: 'desc' } }, { sortOrder: 'asc' }],
      take: 20,
      include: { inventory: true, product: { select: { title: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } },
    });
    res.json({
      items: variants.map((v) => {
        const onHand = v.inventory.reduce((n, l) => n + l.onHand, 0);
        const reserved = v.inventory.reduce((n, l) => n + l.reserved, 0);
        return { id: v.id, sku: v.sku, title: v.product.title, variantName: v.name, image: v.product.images[0]?.url ?? '', onHand, reserved, available: onHand - reserved };
      }),
    });
  }),
);

async function skuSummary(variantId: number) {
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true, product: { select: { id: true, title: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } },
  });
  if (!v || !v.trackStock) return null;
  const onHand = v.inventory.reduce((n, l) => n + l.onHand, 0);
  const reserved = v.inventory.reduce((n, l) => n + l.reserved, 0);
  return { id: v.id, sku: v.sku, title: v.product.title, productId: v.product.id, variantName: v.name, image: v.product.images[0]?.url ?? '', onHand, reserved, available: onHand - reserved };
}

// ───────────── Barang masuk ─────────────

stokRouter.get(
  '/stok/masuk',
  editOnly,
  handle(async (req, res) => {
    const preset = Number(req.query.sku) ? await skuSummary(Number(req.query.sku)) : null;
    await res.renderAdmin('stok/masuk', {
      pageTitle: 'Barang masuk',
      active: 'stok',
      backHref: '/admin/stok',
      scripts: ['/cms/stock-forms.js'],
      initialRows: preset ? [{ ...preset, qty: '' }] : [],
      values: {},
    });
  }),
);

stokRouter.post(
  '/stok/masuk',
  editOnly,
  handle(async (req, res) => {
    const raw = Array.isArray(req.body?.rows) ? req.body.rows : req.body?.rows && typeof req.body.rows === 'object' ? Object.values(req.body.rows) : [];
    const rows = (raw as Record<string, unknown>[]).map((r) => ({ variantId: Number(r.variantId), qty: Number(String(r.qty ?? '').replace(/[.\s]/g, '')) }));
    const refId = optionalText(80).safeParse(req.body?.refId);
    const note = optionalText(500).safeParse(req.body?.note);
    const errors: Record<string, string> = {};
    if (!rows.length) errors.rows = 'Tambahkan minimal satu SKU.';
    rows.forEach((r, i) => {
      if (!Number.isInteger(r.qty) || r.qty < 1 || r.qty > 100000) errors[`rows.${i}`] = 'Jumlah harus 1–100.000.';
    });
    const ids = [...new Set(rows.map((r) => r.variantId))];
    if (ids.length !== rows.length) errors.rows = 'Ada SKU yang dobel — gabungkan jumlahnya di satu baris.';
    const valid = await prisma.productVariant.count({ where: { id: { in: ids }, trackStock: true } });
    if (valid !== ids.length) errors.rows = 'Ada SKU yang tidak ditemukan atau stoknya tidak dilacak.';
    if (!refId.success) errors.refId = 'Maksimal 80 karakter.';
    if (!note.success) errors.note = 'Maksimal 500 karakter.';
    if (Object.keys(errors).length) {
      const summaries = await Promise.all(rows.map(async (r) => ({ ...(await skuSummary(r.variantId)), qty: Number.isFinite(r.qty) ? r.qty : '' })));
      return res.renderAdmin(
        'stok/masuk',
        { pageTitle: 'Barang masuk', active: 'stok', backHref: '/admin/stok', scripts: ['/cms/stock-forms.js'], initialRows: summaries.filter((s) => s.id), values: req.body, errors },
        400,
      );
    }
    await prisma.$transaction((tx) => stockIn(tx, req, rows, { refId: refId.data ?? null, note: note.data ?? null }));
    resetLowStockCache();
    const total = rows.reduce((n, r) => n + r.qty, 0);
    redirectWith(res, '/admin/stok/riwayat', 'success', `Barang masuk dicatat: ${rows.length} SKU, total ${total} pcs.`);
  }),
);

// ───────────── Penyesuaian ─────────────

stokRouter.get(
  '/stok/penyesuaian',
  editOnly,
  handle(async (req, res) => {
    const sku = Number(req.query.sku) ? await skuSummary(Number(req.query.sku)) : null;
    await res.renderAdmin('stok/penyesuaian', {
      pageTitle: 'Penyesuaian stok',
      active: 'stok',
      backHref: '/admin/stok',
      scripts: ['/cms/stock-forms.js'],
      sku,
      reasons: ADJUST_REASONS,
      values: { mode: 'set' },
    });
  }),
);

stokRouter.post(
  '/stok/penyesuaian',
  editOnly,
  handle(async (req, res) => {
    const variantId = Number(req.body?.variantId);
    const mode = req.body?.mode === 'delta' ? 'delta' : 'set';
    const qty = Number(String(req.body?.qty ?? '').replace(/[.\s]/g, ''));
    const reason = ADJUST_REASONS.includes(req.body?.reason) ? (req.body.reason as string) : '';
    const note = optionalText(300).safeParse(req.body?.note);
    const sku = variantId ? await skuSummary(variantId) : null;
    const render = (extra: Record<string, unknown>, status = 400) =>
      res.renderAdmin('stok/penyesuaian', { pageTitle: 'Penyesuaian stok', active: 'stok', backHref: '/admin/stok', scripts: ['/cms/stock-forms.js'], sku, reasons: ADJUST_REASONS, values: req.body, ...extra }, status);

    const errors: Record<string, string> = {};
    if (!sku) errors.variantId = 'Pilih SKU yang stoknya dilacak.';
    if (!Number.isInteger(qty) || (mode === 'set' ? qty < 0 : qty === 0) || Math.abs(qty) > 100000) {
      errors.qty = mode === 'set' ? 'Isi jumlah fisik hasil hitung (0 atau lebih).' : 'Isi jumlah tambah (+) atau kurang (−), bukan 0.';
    }
    if (!reason) errors.reason = 'Pilih alasan penyesuaian.';
    if (reason === 'Lainnya' && !(note.success && note.data)) errors.note = 'Jelaskan alasannya di catatan.';
    if (!note.success) errors.note = 'Maksimal 300 karakter.';
    if (Object.keys(errors).length) return render({ errors });

    const result = await prisma.$transaction((tx) =>
      adjustStock(tx, req, { variantId, mode, qty, reason, note: note.data ?? null, allowBelowReserved: req.body?.confirmBelowReserved === 'on' }),
    );
    if ('error' in result) return render({ errors: { qty: result.error } });
    if ('warning' in result) return render({ belowReserved: result.warning }, 409);
    resetLowStockCache();
    const { before, after, delta } = result.ok;
    redirectWith(res, `/admin/stok/riwayat?varian=${variantId}`, 'success', `Stok ${result.ok.sku}: ${before} → ${after} (${delta > 0 ? '+' : ''}${delta}).`);
  }),
);

// ───────────── Riwayat mutasi ─────────────

stokRouter.get(
  '/stok/riwayat',
  handle(async (req, res) => {
    const variantId = Number(req.query.varian) || null;
    const type = q(req.query.tipe) in MOVEMENT_LABELS ? (q(req.query.tipe) as StockMovementType) : null;
    const actor = q(req.query.oleh).slice(0, 191);
    const from = fromDateTimeLocal(q(req.query.dari) ? `${q(req.query.dari)}T00:00` : '');
    const to = fromDateTimeLocal(q(req.query.sampai) ? `${q(req.query.sampai)}T23:59` : '');
    const page = pageParam(req.query.hal);
    const where: Prisma.StockMovementWhereInput = {
      ...(variantId ? { variantId } : {}),
      ...(type ? { type } : {}),
      ...(actor ? { createdBy: { contains: actor } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [total, movements, sku, actors] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
        include: { variant: { select: { id: true, sku: true, name: true, product: { select: { id: true, title: true } } } } },
      }),
      variantId ? skuSummary(variantId) : null,
      prisma.stockMovement.findMany({ distinct: ['createdBy'], select: { createdBy: true }, where: { createdBy: { not: null } } }),
    ]);
    if (variantId && !sku) throw new HttpError(404, 'SKU tidak ditemukan.');
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const params = new URLSearchParams(Object.entries({ varian: variantId ?? '', tipe: type ?? '', oleh: actor, dari: q(req.query.dari), sampai: q(req.query.sampai) }).filter(([, v]) => v !== '') as [string, string][]);
    const link = (p: number) => {
      const s = new URLSearchParams(params);
      if (p > 1) s.set('hal', String(p));
      return `/admin/stok/riwayat${s.toString() ? `?${s}` : ''}`;
    };
    await res.renderAdmin('stok/riwayat', {
      pageTitle: sku ? `Riwayat ${sku.sku}` : 'Riwayat mutasi stok',
      active: 'stok',
      backHref: '/admin/stok',
      canEdit: canEdit(req, 'stok'),
      sku,
      movements: movements.map((m) => ({ ...m, typeLabel: MOVEMENT_LABELS[m.type], positive: m.qtyDelta > 0 })),
      total,
      types: Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label })),
      actors: actors.map((a) => a.createdBy).filter(Boolean),
      filters: { tipe: type, oleh: actor, dari: q(req.query.dari), sampai: q(req.query.sampai), varian: variantId },
      page,
      pages,
      prevHref: page > 1 ? link(page - 1) : null,
      nextHref: page < pages ? link(page + 1) : null,
    });
  }),
);
