/**
 * Seksi produk beranda (dan "Produk terkait"). Tidak ada seksi yang dikunci: semua bisa diubah, disembunyikan,
 * atau dihapus, dan seksi baru bisa ditambah tanpa batas. Isi manual (pilih produk) atau otomatis dari aturan.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { parseRules, productInclude, sectionProducts } from '../../../modules/catalog/catalog.service.js';
import { invalidateStorefront, sectionSeeAllHref } from '../../../modules/storefront/storefront.service.js';
import type { HomeSection, Prisma } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, optionalInt, parseForm, redirectWith, requiredInt, requiredText, requirePermission, safeUrl, slug, slugify } from '../../http.js';
import { direction, moveStep } from '../../sorting.js';
import { describeRules, pickerProducts, productIdsFromForm, ruleCategoryOptions, rulesFromForm, rulesToForm } from './feed.js';

export const seksiRouter = Router();
seksiRouter.use('/seksi', requirePermission('tampilan', 'view'));
const editOnly = requirePermission('tampilan', 'edit');

const schema = z
  .object({
    title: requiredText(120, 'Judul'),
    key: slug(60),
    placement: z.enum(['HOME', 'PRODUCT_RELATED']),
    source: z.enum(['MANUAL', 'RULE'], { error: 'Pilih cara mengisi produk.' }),
    productLimit: requiredInt(1, 48, 'Jumlah produk'),
    seeAllType: z.enum(['NONE', 'SECTION_PAGE', 'COLLECTION', 'CATEGORY', 'URL']).default('NONE'),
    seeAllCollectionId: optionalInt(1),
    seeAllCategoryId: optionalInt(1),
    seeAllUrl: safeUrl(500),
    showMoreButton: checkbox,
    isActive: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.placement !== 'HOME') return;
    if (v.seeAllType === 'COLLECTION' && !v.seeAllCollectionId) ctx.addIssue({ code: 'custom', path: ['seeAllCollectionId'], message: 'Pilih koleksi.' });
    if (v.seeAllType === 'CATEGORY' && !v.seeAllCategoryId) ctx.addIssue({ code: 'custom', path: ['seeAllCategoryId'], message: 'Pilih kategori.' });
    if (v.seeAllType === 'URL' && !v.seeAllUrl) ctx.addIssue({ code: 'custom', path: ['seeAllUrl'], message: 'Isi link.' });
  });

async function formOptions() {
  const [collections, categories, categoryOptions] = await Promise.all([
    prisma.collection.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, title: true, key: true, isActive: true } }),
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { parent: true } }),
    ruleCategoryOptions(),
  ]);
  const parents = categories.filter((c) => !c.parentId);
  const categoryTargets = parents.flatMap((p) => [
    { id: p.id, name: p.name },
    ...categories.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: `${p.name} › ${c.name}` })),
  ]);
  return { collections, categoryTargets, categoryOptions };
}

/** Nilai form dari seksi di database. */
async function valuesOf(section: HomeSection & { items: { productId: number }[] }) {
  return {
    ...section,
    ...rulesToForm(parseRules(section.rules)),
    products: await pickerProducts(section.items.map((i) => i.productId)),
  };
}

async function renderForm(req: Request, res: Response, data: Record<string, unknown>, status = 200) {
  await res.renderAdmin(
    'seksi/form',
    { active: 'seksi', backHref: '/admin/seksi', readOnly: !canEdit(req, 'tampilan'), ...(await formOptions()), ...data },
    status,
  );
}

/** Nilai form yang dikirim ulang saat ada error (produk terpilih tetap tampil). */
async function resubmitted(body: Record<string, unknown>) {
  return { ...body, ruleDiscounted: body.ruleDiscounted === 'on', products: await pickerProducts(productIdsFromForm(body.productIds)) };
}

const snapshot = (s: HomeSection, productIds: number[]) => ({ ...s, productIds });

seksiRouter.get(
  '/seksi',
  handle(async (req, res) => {
    const sections = await prisma.homeSection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { items: true } }, seeAllCollection: true, seeAllCategory: { include: { parent: true, landingCollection: true } } },
    });
    const rows = await Promise.all(
      sections.map(async (s) => ({
        ...s,
        sourceText: s.source === 'MANUAL' ? `Manual · ${s._count.items} produk dipilih` : `Otomatis · ${await describeRules(parseRules(s.rules))}`,
        seeAllHref: s.placement === 'HOME' ? sectionSeeAllHref(s) : null,
      })),
    );
    const group = (placement: 'HOME' | 'PRODUCT_RELATED') => {
      const list = rows.filter((r) => r.placement === placement);
      return list.map((r, i) => ({ ...r, first: i === 0, last: i === list.length - 1 }));
    };
    await res.renderAdmin('seksi/index', {
      pageTitle: 'Seksi produk',
      active: 'seksi',
      canEdit: canEdit(req, 'tampilan'),
      home: group('HOME'),
      related: group('PRODUCT_RELATED'),
    });
  }),
);

seksiRouter.get(
  '/seksi/baru',
  editOnly,
  handle(async (req, res) => {
    const placement = req.query.tempat === 'terkait' ? 'PRODUCT_RELATED' : 'HOME';
    await renderForm(req, res, {
      pageTitle: 'Seksi baru',
      values: { placement, source: 'MANUAL', productLimit: 4, seeAllType: 'SECTION_PAGE', isActive: true, ruleSort: 'terbaru', products: [] },
    });
  }),
);

async function save(req: Request, before?: HomeSection & { items: { productId: number }[] }) {
  const body = { ...req.body, key: req.body?.key || slugify(String(req.body?.title ?? ''), 60) };
  const parsed = parseForm(schema, body);
  const errors: Record<string, string> = parsed.ok ? {} : parsed.errors;
  const productIds = productIdsFromForm(req.body?.productIds);
  if (parsed.ok) {
    const dup = await prisma.homeSection.findUnique({ where: { key: parsed.data.key } });
    if (dup && dup.id !== before?.id) errors.key = `Key "${parsed.data.key}" sudah dipakai seksi "${dup.title}".`;
    if (parsed.data.source === 'MANUAL' && !productIds.length) errors.productIds = 'Pilih minimal satu produk.';
  }
  if (!parsed.ok || Object.keys(errors).length) return { errors, values: await resubmitted(body) };

  const v = parsed.data;
  const home = v.placement === 'HOME';
  const data = {
    title: v.title,
    key: v.key,
    placement: v.placement,
    source: v.source,
    // Mode manual tidak menghapus aturan lama (dipakai lagi kalau kembali ke mode otomatis).
    rules: v.source === 'RULE' ? (rulesFromForm(req.body) as Prisma.InputJsonObject) : undefined,
    productLimit: v.productLimit,
    seeAllType: home ? v.seeAllType : 'NONE',
    seeAllCollectionId: home && v.seeAllType === 'COLLECTION' ? v.seeAllCollectionId : null,
    seeAllCategoryId: home && v.seeAllType === 'CATEGORY' ? v.seeAllCategoryId : null,
    seeAllUrl: home && v.seeAllType === 'URL' ? v.seeAllUrl : null,
    showMoreButton: home && v.seeAllType !== 'NONE' && v.showMoreButton,
    isActive: v.isActive,
  } satisfies Prisma.HomeSectionUncheckedUpdateInput;

  const section = await prisma.$transaction(async (tx) => {
    let saved: HomeSection;
    if (before) {
      saved = await tx.homeSection.update({ where: { id: before.id }, data });
    } else {
      const last = await tx.homeSection.findFirst({ where: { placement: v.placement }, orderBy: { sortOrder: 'desc' } });
      saved = await tx.homeSection.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    }
    // Isi manual disimpan ulang sesuai urutan pemilih; mode aturan tidak mengubah daftar manual yang lama.
    if (v.source === 'MANUAL') {
      await tx.homeSectionItem.deleteMany({ where: { sectionId: saved.id } });
      await tx.homeSectionItem.createMany({ data: productIds.map((productId, sortOrder) => ({ sectionId: saved.id, productId, sortOrder })) });
    }
    const afterIds = v.source === 'MANUAL' ? productIds : (before?.items.map((i) => i.productId) ?? []);
    await audit(tx, req, {
      action: before ? 'update' : 'create',
      entityType: 'home_section',
      entityId: saved.id,
      entityLabel: saved.title,
      changes: diff(before ? snapshot(before, before.items.map((i) => i.productId)) : null, snapshot(saved, afterIds)),
    });
    return saved;
  });
  invalidateStorefront();
  return { section };
}

seksiRouter.post(
  '/seksi',
  editOnly,
  handle(async (req, res) => {
    const result = await save(req);
    if ('errors' in result) return renderForm(req, res, { pageTitle: 'Seksi baru', values: result.values, errors: result.errors }, 400);
    redirectWith(res, `/admin/seksi#seksi-${result.section!.id}`, 'success', `Seksi "${result.section!.title}" ditambahkan.`);
  }),
);

seksiRouter.get(
  '/seksi/:id',
  handle(async (req, res) => {
    const section = await prisma.homeSection.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: { orderBy: { sortOrder: 'asc' }, include: { product: { include: productInclude } } },
        seeAllCollection: true,
        seeAllCategory: { include: { parent: true, landingCollection: true } },
      },
    });
    if (!section) throw new HttpError(404, 'Seksi tidak ditemukan.');
    const live = await sectionProducts(section);
    await renderForm(req, res, {
      pageTitle: `Ubah ${section.title}`,
      section,
      values: await valuesOf(section),
      liveCount: live.length,
      storeHref: section.placement === 'HOME' ? '/' : null,
      seeAllHref: section.placement === 'HOME' ? sectionSeeAllHref(section) : null,
    });
  }),
);

seksiRouter.post(
  '/seksi/:id',
  editOnly,
  handle(async (req, res) => {
    const before = await prisma.homeSection.findUnique({ where: { id: Number(req.params.id) }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!before) throw new HttpError(404, 'Seksi tidak ditemukan.');
    const result = await save(req, before);
    if ('errors' in result) return renderForm(req, res, { pageTitle: `Ubah ${before.title}`, section: before, values: result.values, errors: result.errors }, 400);
    redirectWith(res, `/admin/seksi#seksi-${before.id}`, 'success', `Seksi "${result.section!.title}" disimpan.`);
  }),
);

seksiRouter.post(
  '/seksi/:id/urutan',
  editOnly,
  handle(async (req, res) => {
    const section = await prisma.homeSection.findUnique({ where: { id: Number(req.params.id) } });
    const dir = direction(req.body?.arah);
    if (!section || !dir) throw new HttpError(400, 'Permintaan tidak valid.');
    const siblings = await prisma.homeSection.findMany({ where: { placement: section.placement }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const order = moveStep(siblings, section.id, dir);
    if (order) {
      await prisma.$transaction(async (tx) => {
        for (const o of order) await tx.homeSection.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } });
        await audit(tx, req, { action: 'reorder', entityType: 'home_section', entityId: section.id, entityLabel: section.title, summary: `Digeser ${dir}` });
      });
      invalidateStorefront();
    }
    res.redirect(303, `/admin/seksi#seksi-${section.id}`);
  }),
);

seksiRouter.post(
  '/seksi/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const section = await prisma.homeSection.findUnique({ where: { id: Number(req.params.id) } });
    if (!section) throw new HttpError(404, 'Seksi tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.homeSection.update({ where: { id: section.id }, data: { isActive: !section.isActive } });
      await audit(tx, req, { action: 'update', entityType: 'home_section', entityId: section.id, entityLabel: section.title, changes: { isActive: [section.isActive, !section.isActive] } });
    });
    invalidateStorefront();
    redirectWith(res, `/admin/seksi#seksi-${section.id}`, 'success', `Seksi "${section.title}" ${section.isActive ? 'disembunyikan' : 'ditampilkan'}.`);
  }),
);

seksiRouter.post(
  '/seksi/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const section = await prisma.homeSection.findUnique({ where: { id: Number(req.params.id) }, include: { items: true } });
    if (!section) throw new HttpError(404, 'Seksi tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.homeSection.delete({ where: { id: section.id } });
      await audit(tx, req, {
        action: 'delete',
        entityType: 'home_section',
        entityId: section.id,
        entityLabel: section.title,
        changes: diff(snapshot(section, section.items.map((i) => i.productId)), null),
      });
    });
    invalidateStorefront();
    redirectWith(res, '/admin/seksi', 'success', `Seksi "${section.title}" dihapus.`);
  }),
);

