/**
 * Kategori & subkategori (2 tingkat). Perubahan langsung tampil di menu Kategori, dropdown pencarian,
 * dan filter store. Kategori yang masih dipakai tidak bisa dihapus.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { categoryHref, invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, optionalInt, parseForm, redirectWith, requiredText, requirePermission, slug, slugify } from '../../http.js';
import { direction, moveStep } from '../../sorting.js';

export const kategoriRouter = Router();
kategoriRouter.use('/kategori', requirePermission('kategori', 'view'));
const editOnly = requirePermission('kategori', 'edit');

const schema = z.object({
  name: requiredText(120, 'Nama'),
  slug: slug(80),
  parentId: optionalInt(1),
  landingCollectionId: optionalInt(1),
  isActive: checkbox,
});

async function formOptions(excludeId?: number) {
  const [parents, collections] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.collection.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, title: true, key: true } }),
  ]);
  return { parents, collections };
}

/** Ganti slug lama → baru di aturan koleksi & seksi (kcat/ksub). */
async function renameInRules(tx: Prisma.TransactionClient, oldSlug: string, newSlug: string) {
  const replace = (rules: unknown) => {
    if (!rules || typeof rules !== 'object') return null;
    const r = { ...(rules as Record<string, unknown>) };
    let changed = false;
    for (const key of ['kcat', 'ksub']) {
      if (r[key] === oldSlug) {
        r[key] = newSlug;
        changed = true;
      }
    }
    return changed ? (r as Prisma.InputJsonObject) : null;
  };
  for (const c of await tx.collection.findMany({ select: { id: true, rules: true } })) {
    const rules = replace(c.rules);
    if (rules) await tx.collection.update({ where: { id: c.id }, data: { rules } });
  }
  for (const s of await tx.homeSection.findMany({ select: { id: true, rules: true } })) {
    const rules = replace(s.rules);
    if (rules) await tx.homeSection.update({ where: { id: s.id }, data: { rules } });
  }
}

async function validate(data: z.infer<typeof schema>, id?: number) {
  const errors: Record<string, string> = {};
  const dup = await prisma.category.findUnique({ where: { slug: data.slug } });
  if (dup && dup.id !== id) errors.slug = `Slug "${data.slug}" sudah dipakai kategori "${dup.name}".`;
  if (data.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.parentId !== null) errors.parentId = 'Induk harus kategori utama.';
    if (id && data.parentId === id) errors.parentId = 'Kategori tidak bisa menjadi induk dirinya sendiri.';
    if (id && (await prisma.category.count({ where: { parentId: id } })) > 0) {
      errors.parentId = 'Kategori ini punya subkategori, jadi harus tetap kategori utama.';
    }
  }
  return errors;
}

kategoriRouter.get(
  '/kategori',
  handle(async (req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { products: true } }, landingCollection: { select: { title: true, key: true } } },
    });
    const parents = categories
      .filter((c) => c.parentId === null)
      .map((p, i, list) => {
        const children = categories.filter((c) => c.parentId === p.id);
        return {
          ...p,
          first: i === 0,
          last: i === list.length - 1,
          total: p._count.products + children.reduce((n, c) => n + c._count.products, 0),
          children: children.map((c, j) => ({ ...c, first: j === 0, last: j === children.length - 1, parentActive: p.isActive })),
        };
      });
    await res.renderAdmin('kategori/index', {
      pageTitle: 'Kategori',
      active: 'kategori',
      parents,
      canEdit: canEdit(req, 'kategori'),
    });
  }),
);

kategoriRouter.get(
  '/kategori/baru',
  editOnly,
  handle(async (req, res) => {
    const parentId = Number(req.query.induk) || null;
    await res.renderAdmin('kategori/form', {
      pageTitle: parentId ? 'Subkategori baru' : 'Kategori baru',
      active: 'kategori',
      backHref: '/admin/kategori',
      values: { parentId, isActive: true },
      ...(await formOptions()),
    });
  }),
);

kategoriRouter.post(
  '/kategori',
  editOnly,
  handle(async (req, res) => {
    const body = { ...req.body, slug: req.body?.slug || slugify(String(req.body?.name ?? '')) };
    const parsed = parseForm(schema, body);
    const errors = parsed.ok ? await validate(parsed.data) : parsed.errors;
    if (!parsed.ok || Object.keys(errors).length) {
      return res.renderAdmin(
        'kategori/form',
        { pageTitle: 'Kategori baru', active: 'kategori', backHref: '/admin/kategori', values: body, errors, ...(await formOptions()) },
        400,
      );
    }
    const data = parsed.data;
    const last = await prisma.category.findFirst({ where: { parentId: data.parentId ?? null }, orderBy: { sortOrder: 'desc' } });
    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.category.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
      await audit(tx, req, { action: 'create', entityType: 'category', entityId: category.id, entityLabel: category.name, changes: diff(null, category) });
      return category;
    });
    invalidateStorefront();
    redirectWith(res, '/admin/kategori', 'success', `Kategori "${created.name}" ditambahkan.`);
  }),
);

kategoriRouter.get(
  '/kategori/:id',
  handle(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { products: true, children: true } }, parent: true, landingCollection: true },
    });
    if (!category) throw new HttpError(404, 'Kategori tidak ditemukan.');
    await res.renderAdmin('kategori/form', {
      pageTitle: `Ubah ${category.name}`,
      active: 'kategori',
      backHref: '/admin/kategori',
      category,
      storeHref: categoryHref(category),
      values: category,
      readOnly: !canEdit(req, 'kategori'),
      ...(await formOptions(category.id)),
    });
  }),
);

kategoriRouter.post(
  '/kategori/:id',
  editOnly,
  handle(async (req, res) => {
    const before = await prisma.category.findUnique({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!before) throw new HttpError(404, 'Kategori tidak ditemukan.');
    const parsed = parseForm(schema, req.body);
    const errors = parsed.ok ? await validate(parsed.data, before.id) : parsed.errors;
    if (!parsed.ok || Object.keys(errors).length) {
      return res.renderAdmin(
        'kategori/form',
        { pageTitle: `Ubah ${before.name}`, active: 'kategori', backHref: '/admin/kategori', category: before, values: req.body, errors, ...(await formOptions(before.id)) },
        400,
      );
    }
    const data = parsed.data;
    await prisma.$transaction(async (tx) => {
      const after = await tx.category.update({ where: { id: before.id }, data });
      if (before.slug !== after.slug) await renameInRules(tx, before.slug, after.slug);
      const { _count, ...plain } = before;
      await audit(tx, req, { action: 'update', entityType: 'category', entityId: after.id, entityLabel: after.name, changes: diff(plain, after) });
    });
    invalidateStorefront();
    redirectWith(res, '/admin/kategori', 'success', `Kategori "${data.name}" disimpan.`);
  }),
);

kategoriRouter.post(
  '/kategori/:id/urutan',
  editOnly,
  handle(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
    const dir = direction(req.body?.arah);
    if (!category || !dir) throw new HttpError(400, 'Permintaan tidak valid.');
    const siblings = await prisma.category.findMany({ where: { parentId: category.parentId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const order = moveStep(siblings, category.id, dir);
    if (order) {
      await prisma.$transaction(async (tx) => {
        for (const o of order) await tx.category.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } });
        await audit(tx, req, { action: 'reorder', entityType: 'category', entityId: category.id, entityLabel: category.name, summary: `Digeser ${dir}` });
      });
      invalidateStorefront();
    }
    res.redirect(303, `/admin/kategori#kategori-${category.id}`);
  }),
);

kategoriRouter.post(
  '/kategori/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
    if (!category) throw new HttpError(404, 'Kategori tidak ditemukan.');
    const isActive = !category.isActive;
    await prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id: category.id }, data: { isActive } });
      await audit(tx, req, { action: 'update', entityType: 'category', entityId: category.id, entityLabel: category.name, changes: { isActive: [category.isActive, isActive] } });
    });
    invalidateStorefront();
    redirectWith(res, `/admin/kategori#kategori-${category.id}`, 'success', `"${category.name}" ${isActive ? 'ditampilkan' : 'disembunyikan'} di store.`);
  }),
);

kategoriRouter.post(
  '/kategori/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { products: true, children: true, navigationItems: true, seeAllSections: true } } },
    });
    if (!category) throw new HttpError(404, 'Kategori tidak ditemukan.');
    const c = category._count;
    const reasons = [
      c.children && `masih punya ${c.children} subkategori`,
      c.products && `masih berisi ${c.products} produk (pindahkan dulu produknya)`,
      c.navigationItems && `dipakai ${c.navigationItems} item menu/Kategori Pilihan`,
      c.seeAllSections && `dipakai sebagai link "Lihat semua" di ${c.seeAllSections} seksi`,
    ].filter(Boolean);
    if (reasons.length) {
      return redirectWith(res, '/admin/kategori', 'error', `"${category.name}" tidak bisa dihapus: ${reasons.join('; ')}.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id: category.id } });
      const { _count, ...plain } = category;
      await audit(tx, req, { action: 'delete', entityType: 'category', entityId: category.id, entityLabel: category.name, changes: diff(plain, null) });
    });
    invalidateStorefront();
    redirectWith(res, '/admin/kategori', 'success', `Kategori "${category.name}" dihapus.`);
  }),
);
