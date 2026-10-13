/**
 * Menu di bawah kolom pencarian (desktop & mobile) dan kartu "Kategori Pilihan" di beranda.
 * Keduanya tabel navigation_items, dibedakan placement.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { categoryHref, collectionHref, invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import type { NavPlacement, Prisma } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, optionalInt, parseForm, redirectWith, requiredText, requirePermission, safeUrl } from '../../http.js';
import { direction, moveStep } from '../../sorting.js';

export const menuRouter = Router();
menuRouter.use('/menu', requirePermission('menu', 'view'));
const editOnly = requirePermission('menu', 'edit');

export const PLACEMENTS: Record<NavPlacement, { slug: string; title: string; desc: string }> = {
  SEARCH_MENU: { slug: 'menu', title: 'Menu bawah pencarian', desc: 'Baris link di bawah kolom pencarian (desktop & mobile).' },
  HOME_SHORTCUT: { slug: 'kartu', title: 'Kategori Pilihan', desc: 'Kartu bergambar di beranda, di bawah banner.' },
};

const placementFromSlug = (slug: unknown): NavPlacement => (slug === 'kartu' ? 'HOME_SHORTCUT' : 'SEARCH_MENU');

const schema = z
  .object({
    placement: z.enum(['SEARCH_MENU', 'HOME_SHORTCUT']),
    label: requiredText(80, 'Label'),
    linkType: z.enum(['COLLECTION', 'CATEGORY', 'URL'], { error: 'Pilih jenis tujuan.' }),
    collectionId: optionalInt(1),
    categoryId: optionalInt(1),
    url: safeUrl(500),
    imageUrl: safeUrl(500),
    isActive: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.linkType === 'COLLECTION' && !v.collectionId) ctx.addIssue({ code: 'custom', path: ['collectionId'], message: 'Pilih koleksi tujuan.' });
    if (v.linkType === 'CATEGORY' && !v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Pilih kategori tujuan.' });
    if (v.linkType === 'URL' && !v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Isi link tujuan.' });
  });

const include = {
  collection: true,
  category: { include: { parent: true, landingCollection: true } },
} satisfies Prisma.NavigationItemInclude;

type ItemWithTarget = Prisma.NavigationItemGetPayload<{ include: typeof include }>;

/** Keterangan tujuan untuk daftar CMS, plus peringatan kalau tujuan tidak aktif. */
function describe(item: ItemWithTarget) {
  switch (item.linkType) {
    case 'COLLECTION':
      return {
        kind: 'Koleksi',
        name: item.collection?.title ?? '(koleksi terhapus)',
        href: item.collection ? collectionHref(item.collection.key) : '',
        warning: item.collection && !item.collection.isActive ? 'Koleksi nonaktif — item tidak tampil di store' : null,
      };
    case 'CATEGORY': {
      const c = item.category;
      return {
        kind: 'Kategori',
        name: c ? (c.parent ? `${c.parent.name} › ${c.name}` : c.name) : '(kategori terhapus)',
        href: c ? categoryHref(c) : '',
        warning: c && (!c.isActive || (c.parent && !c.parent.isActive)) ? 'Kategori disembunyikan — item tidak tampil di store' : null,
      };
    }
    default:
      return { kind: 'Link', name: item.url ?? '', href: item.url ?? '', warning: null };
  }
}

async function formOptions() {
  const [collections, categories] = await Promise.all([
    prisma.collection.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, title: true, key: true, icon: true, isActive: true } }),
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { parent: true } }),
  ]);
  const parents = categories.filter((c) => !c.parentId);
  const categoryOptions = parents.flatMap((p) => [
    { id: p.id, name: p.name },
    ...categories.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: `${p.name} › ${c.name}` })),
  ]);
  return { collections, categoryOptions };
}

async function shortcutImageError(data: z.infer<typeof schema>) {
  if (data.placement !== 'HOME_SHORTCUT' || data.imageUrl) return null;
  if (data.linkType === 'COLLECTION' && data.collectionId) {
    const c = await prisma.collection.findUnique({ where: { id: data.collectionId } });
    if (c?.icon) return null;
  }
  return 'Kartu Kategori Pilihan butuh gambar.';
}

function toData(v: z.infer<typeof schema>) {
  return {
    placement: v.placement,
    label: v.label,
    linkType: v.linkType,
    collectionId: v.linkType === 'COLLECTION' ? v.collectionId : null,
    categoryId: v.linkType === 'CATEGORY' ? v.categoryId : null,
    url: v.linkType === 'URL' ? v.url : null,
    imageUrl: v.placement === 'HOME_SHORTCUT' ? v.imageUrl : null,
    isActive: v.isActive,
  };
}

menuRouter.get(
  '/menu',
  handle(async (req, res) => {
    const items = await prisma.navigationItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include });
    const groups = (Object.keys(PLACEMENTS) as NavPlacement[]).map((placement) => {
      const list = items.filter((i) => i.placement === placement);
      return {
        placement,
        ...PLACEMENTS[placement],
        items: list.map((item, i) => ({
          ...item,
          target: describe(item),
          image: item.imageUrl ?? item.collection?.icon ?? null,
          first: i === 0,
          last: i === list.length - 1,
        })),
      };
    });
    await res.renderAdmin('menu/index', { pageTitle: 'Menu & pintasan', active: 'menu', groups, canEdit: canEdit(req, 'menu') });
  }),
);

menuRouter.get(
  '/menu/baru',
  editOnly,
  handle(async (req, res) => {
    const placement = placementFromSlug(req.query.tempat);
    await res.renderAdmin('menu/form', {
      pageTitle: `Item baru · ${PLACEMENTS[placement].title}`,
      active: 'menu',
      backHref: '/admin/menu',
      place: PLACEMENTS[placement],
      values: { placement, linkType: 'COLLECTION', isActive: true },
      ...(await formOptions()),
    });
  }),
);

async function save(req: Request, id?: number) {
  const parsed = parseForm(schema, req.body);
  if (!parsed.ok) return { errors: parsed.errors };
  const imageError = await shortcutImageError(parsed.data);
  if (imageError) return { errors: { imageUrl: imageError } };
  const data = toData(parsed.data);
  const item = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.navigationItem.findUniqueOrThrow({ where: { id } });
      const after = await tx.navigationItem.update({ where: { id }, data: { ...data, placement: before.placement } });
      await audit(tx, req, { action: 'update', entityType: 'navigation_item', entityId: id, entityLabel: after.label, changes: diff(before, after) });
      return after;
    }
    const last = await tx.navigationItem.findFirst({ where: { placement: data.placement }, orderBy: { sortOrder: 'desc' } });
    const created = await tx.navigationItem.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    await audit(tx, req, {
      action: 'create',
      entityType: 'navigation_item',
      entityId: created.id,
      entityLabel: created.label,
      summary: PLACEMENTS[created.placement].title,
      changes: diff(null, created),
    });
    return created;
  });
  invalidateStorefront();
  return { item };
}

menuRouter.post(
  '/menu',
  editOnly,
  handle(async (req, res) => {
    const result = await save(req);
    if ('errors' in result) {
      const placement = placementFromSlug(req.body?.placement === 'HOME_SHORTCUT' ? 'kartu' : 'menu');
      return res.renderAdmin(
        'menu/form',
        { pageTitle: 'Item baru', active: 'menu', backHref: '/admin/menu', place: PLACEMENTS[placement], values: req.body, errors: result.errors, ...(await formOptions()) },
        400,
      );
    }
    redirectWith(res, `/admin/menu#item-${result.item!.id}`, 'success', `"${result.item!.label}" ditambahkan.`);
  }),
);

menuRouter.get(
  '/menu/:id',
  handle(async (req, res) => {
    const item = await prisma.navigationItem.findUnique({ where: { id: Number(req.params.id) } });
    if (!item) throw new HttpError(404, 'Item menu tidak ditemukan.');
    await res.renderAdmin('menu/form', {
      pageTitle: `Ubah ${item.label}`,
      active: 'menu',
      backHref: '/admin/menu',
      item,
      place: PLACEMENTS[item.placement],
      values: item,
      readOnly: !canEdit(req, 'menu'),
      ...(await formOptions()),
    });
  }),
);

menuRouter.post(
  '/menu/:id',
  editOnly,
  handle(async (req, res) => {
    const item = await prisma.navigationItem.findUnique({ where: { id: Number(req.params.id) } });
    if (!item) throw new HttpError(404, 'Item menu tidak ditemukan.');
    req.body = { ...req.body, placement: item.placement };
    const result = await save(req, item.id);
    if ('errors' in result) {
      return res.renderAdmin(
        'menu/form',
        {
          pageTitle: `Ubah ${item.label}`,
          active: 'menu',
          backHref: '/admin/menu',
          item,
          place: PLACEMENTS[item.placement],
          values: req.body,
          errors: result.errors,
          ...(await formOptions()),
        },
        400,
      );
    }
    redirectWith(res, `/admin/menu#item-${item.id}`, 'success', `"${result.item!.label}" disimpan.`);
  }),
);

menuRouter.post(
  '/menu/:id/urutan',
  editOnly,
  handle(async (req, res) => {
    const item = await prisma.navigationItem.findUnique({ where: { id: Number(req.params.id) } });
    const dir = direction(req.body?.arah);
    if (!item || !dir) throw new HttpError(400, 'Permintaan tidak valid.');
    const siblings = await prisma.navigationItem.findMany({ where: { placement: item.placement }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const order = moveStep(siblings, item.id, dir);
    if (order) {
      await prisma.$transaction(async (tx) => {
        for (const o of order) await tx.navigationItem.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } });
        await audit(tx, req, { action: 'reorder', entityType: 'navigation_item', entityId: item.id, entityLabel: item.label, summary: `Digeser ${dir}` });
      });
      invalidateStorefront();
    }
    res.redirect(303, `/admin/menu#item-${item.id}`);
  }),
);

menuRouter.post(
  '/menu/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const item = await prisma.navigationItem.findUnique({ where: { id: Number(req.params.id) } });
    if (!item) throw new HttpError(404, 'Item menu tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.navigationItem.update({ where: { id: item.id }, data: { isActive: !item.isActive } });
      await audit(tx, req, { action: 'update', entityType: 'navigation_item', entityId: item.id, entityLabel: item.label, changes: { isActive: [item.isActive, !item.isActive] } });
    });
    invalidateStorefront();
    redirectWith(res, `/admin/menu#item-${item.id}`, 'success', `"${item.label}" ${item.isActive ? 'disembunyikan' : 'ditampilkan'}.`);
  }),
);

menuRouter.post(
  '/menu/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const item = await prisma.navigationItem.findUnique({ where: { id: Number(req.params.id) } });
    if (!item) throw new HttpError(404, 'Item menu tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.navigationItem.delete({ where: { id: item.id } });
      await audit(tx, req, { action: 'delete', entityType: 'navigation_item', entityId: item.id, entityLabel: item.label, changes: diff(item, null) });
    });
    invalidateStorefront();
    redirectWith(res, '/admin/menu', 'success', `"${item.label}" dihapus.`);
  }),
);
