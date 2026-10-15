/**
 * Koleksi = halaman /koleksi/:key (tab koleksi). Isi: produk kurasi di depan lalu produk dari aturan,
 * atau hanya produk kurasi. Dipakai menu, kartu Kategori Pilihan, link "Lihat semua", dan menu Kategori.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { getCollectionProducts, parseRules } from '../../../modules/catalog/catalog.service.js';
import { collectionHref, invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import type { Collection, Prisma } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, parseForm, redirectWith, requiredText, requirePermission, safeUrl, slug, slugify } from '../../http.js';
import { describeRules, pickerProducts, productIdsFromForm, ruleCategoryOptions, rulesFromForm, rulesToForm } from './feed.js';

export const koleksiRouter = Router();
koleksiRouter.use('/koleksi', requirePermission('menu', 'view'));
const editOnly = requirePermission('menu', 'edit');

const schema = z.object({
  title: requiredText(120, 'Judul'),
  key: slug(60),
  icon: safeUrl(255),
  mode: z.enum(['MIXED', 'ONLY']),
  isActive: checkbox,
});

const snapshot = (c: Collection, productIds: number[]) => ({ ...c, productIds });

async function renderForm(req: Request, res: Response, data: Record<string, unknown>, status = 200) {
  await res.renderAdmin(
    'koleksi/form',
    { active: 'koleksi', backHref: '/admin/koleksi', readOnly: !canEdit(req, 'menu'), categoryOptions: await ruleCategoryOptions(), ...data },
    status,
  );
}

koleksiRouter.get(
  '/koleksi',
  handle(async (req, res) => {
    const collections = await prisma.collection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { items: true, navigationItems: true, landingFor: true, seeAllSections: true } } },
    });
    const rows = await Promise.all(
      collections.map(async (c) => {
        const rules = parseRules(c.rules);
        const used = c._count.navigationItems + c._count.landingFor + c._count.seeAllSections;
        return {
          ...c,
          href: collectionHref(c.key),
          sourceText: rules.only ? `Hanya ${c._count.items} produk kurasi` : `${c._count.items ? `${c._count.items} kurasi + ` : ''}${await describeRules(rules)}`,
          usedText: used ? `Dipakai ${used} menu/link` : 'Belum dipakai menu',
        };
      }),
    );
    await res.renderAdmin('koleksi/index', { pageTitle: 'Koleksi', active: 'koleksi', canEdit: canEdit(req, 'menu'), collections: rows });
  }),
);

koleksiRouter.get(
  '/koleksi/baru',
  editOnly,
  handle(async (req, res) => {
    await renderForm(req, res, { pageTitle: 'Koleksi baru', values: { mode: 'MIXED', isActive: true, ruleSort: 'terbaru', products: [] } });
  }),
);

async function save(req: Request, before?: Collection & { items: { productId: number }[] }) {
  const body = { ...req.body, key: req.body?.key || slugify(String(req.body?.title ?? ''), 60) };
  const parsed = parseForm(schema, body);
  const errors: Record<string, string> = parsed.ok ? {} : parsed.errors;
  const productIds = productIdsFromForm(req.body?.productIds);
  if (parsed.ok) {
    const dup = await prisma.collection.findUnique({ where: { key: parsed.data.key } });
    if (dup && dup.id !== before?.id) errors.key = `Key "${parsed.data.key}" sudah dipakai koleksi "${dup.title}".`;
    if (parsed.data.mode === 'ONLY' && !productIds.length) errors.productIds = 'Mode "hanya produk kurasi" butuh minimal satu produk.';
  }
  if (!parsed.ok || Object.keys(errors).length) {
    return { errors, values: { ...body, ruleDiscounted: body.ruleDiscounted === 'on', products: await pickerProducts(productIds) } };
  }
  const v = parsed.data;
  const rules: Prisma.InputJsonObject = v.mode === 'ONLY' ? { only: true } : (rulesFromForm(req.body) as Prisma.InputJsonObject);
  const data = { title: v.title, key: v.key, icon: v.icon, rules, isActive: v.isActive };

  const collection = await prisma.$transaction(async (tx) => {
    let saved: Collection;
    if (before) {
      saved = await tx.collection.update({ where: { id: before.id }, data });
    } else {
      const last = await tx.collection.findFirst({ orderBy: { sortOrder: 'desc' } });
      saved = await tx.collection.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    }
    await tx.collectionItem.deleteMany({ where: { collectionId: saved.id } });
    await tx.collectionItem.createMany({ data: productIds.map((productId, sortOrder) => ({ collectionId: saved.id, productId, sortOrder })) });
    await audit(tx, req, {
      action: before ? 'update' : 'create',
      entityType: 'collection',
      entityId: saved.id,
      entityLabel: saved.title,
      changes: diff(before ? snapshot(before, before.items.map((i) => i.productId)) : null, snapshot(saved, productIds)),
    });
    return saved;
  });
  invalidateStorefront();
  return { collection, keyChanged: Boolean(before && before.key !== collection.key) };
}

koleksiRouter.post(
  '/koleksi',
  editOnly,
  handle(async (req, res) => {
    const result = await save(req);
    if ('errors' in result) return renderForm(req, res, { pageTitle: 'Koleksi baru', values: result.values, errors: result.errors }, 400);
    redirectWith(res, '/admin/koleksi', 'success', `Koleksi "${result.collection!.title}" ditambahkan di ${collectionHref(result.collection!.key)}.`);
  }),
);

koleksiRouter.get(
  '/koleksi/:id',
  handle(async (req, res) => {
    const collection = await prisma.collection.findUnique({ where: { id: Number(req.params.id) }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!collection) throw new HttpError(404, 'Koleksi tidak ditemukan.');
    const rules = parseRules(collection.rules);
    const live = collection.isActive ? await getCollectionProducts(collection.key) : null;
    await renderForm(req, res, {
      pageTitle: `Ubah ${collection.title}`,
      collection,
      href: collectionHref(collection.key),
      liveCount: live?.products.length ?? 0,
      values: {
        ...collection,
        mode: rules.only ? 'ONLY' : 'MIXED',
        ...rulesToForm(rules),
        products: await pickerProducts(collection.items.map((i) => i.productId)),
      },
    });
  }),
);

koleksiRouter.post(
  '/koleksi/:id',
  editOnly,
  handle(async (req, res) => {
    const before = await prisma.collection.findUnique({ where: { id: Number(req.params.id) }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!before) throw new HttpError(404, 'Koleksi tidak ditemukan.');
    const result = await save(req, before);
    if ('errors' in result) return renderForm(req, res, { pageTitle: `Ubah ${before.title}`, collection: before, values: result.values, errors: result.errors }, 400);
    const note = result.keyChanged ? ` Alamat berubah ke ${collectionHref(result.collection!.key)} — periksa link manual (banner/URL) yang memakai alamat lama.` : '';
    redirectWith(res, '/admin/koleksi', 'success', `Koleksi "${result.collection!.title}" disimpan.${note}`);
  }),
);

koleksiRouter.post(
  '/koleksi/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const c = await prisma.collection.findUnique({ where: { id: Number(req.params.id) } });
    if (!c) throw new HttpError(404, 'Koleksi tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.collection.update({ where: { id: c.id }, data: { isActive: !c.isActive } });
      await audit(tx, req, { action: 'update', entityType: 'collection', entityId: c.id, entityLabel: c.title, changes: { isActive: [c.isActive, !c.isActive] } });
    });
    invalidateStorefront();
    const msg = c.isActive
      ? `Koleksi "${c.title}" dinonaktifkan: halamannya 404 dan menu/link yang menautnya disembunyikan.`
      : `Koleksi "${c.title}" diaktifkan.`;
    redirectWith(res, '/admin/koleksi', 'success', msg);
  }),
);

koleksiRouter.post(
  '/koleksi/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const c = await prisma.collection.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: true, _count: { select: { navigationItems: true, landingFor: true, seeAllSections: true } } },
    });
    if (!c) throw new HttpError(404, 'Koleksi tidak ditemukan.');
    const reasons = [
      c._count.navigationItems && `dipakai ${c._count.navigationItems} item menu/Kategori Pilihan`,
      c._count.landingFor && `jadi tujuan ${c._count.landingFor} kategori di menu Kategori`,
      c._count.seeAllSections && `jadi link "Lihat semua" ${c._count.seeAllSections} seksi`,
    ].filter(Boolean);
    if (reasons.length) return redirectWith(res, '/admin/koleksi', 'error', `"${c.title}" tidak bisa dihapus: ${reasons.join('; ')}. Nonaktifkan saja, atau ganti tujuannya dulu.`);
    await prisma.$transaction(async (tx) => {
      await tx.collection.delete({ where: { id: c.id } });
      const { items, _count, ...plain } = c;
      await audit(tx, req, { action: 'delete', entityType: 'collection', entityId: c.id, entityLabel: c.title, changes: diff(snapshot(plain, items.map((i) => i.productId)), null) });
    });
    invalidateStorefront();
    redirectWith(res, '/admin/koleksi', 'success', `Koleksi "${c.title}" dihapus.`);
  }),
);
