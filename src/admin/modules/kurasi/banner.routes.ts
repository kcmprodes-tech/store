/** Banner hero beranda: gambar desktop & mobile, link, urutan, aktif, jadwal tayang. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import type { Banner } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, parseForm, redirectWith, requiredText, requirePermission, safeUrl } from '../../http.js';
import { direction, moveStep } from '../../sorting.js';
import { fromDateTimeLocal } from '../../time.js';

export const bannerRouter = Router();
bannerRouter.use('/banner', requirePermission('tampilan', 'view'));
const editOnly = requirePermission('tampilan', 'edit');

const schema = z
  .object({
    title: requiredText(255, 'Judul'),
    imageUrl: safeUrl(500).refine((v) => Boolean(v), 'Gambar desktop wajib diisi.'),
    imageMobileUrl: safeUrl(500),
    href: safeUrl(500),
    startsAt: z.preprocess(fromDateTimeLocal, z.date().nullable()),
    endsAt: z.preprocess(fromDateTimeLocal, z.date().nullable()),
    isActive: checkbox,
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { path: ['endsAt'], message: 'Waktu selesai harus setelah waktu mulai.' });

export function bannerStatus(b: Banner, now = new Date()) {
  if (!b.isActive) return { label: 'Nonaktif', tone: '' };
  if (b.startsAt && b.startsAt > now) return { label: 'Terjadwal', tone: 'info' };
  if (b.endsAt && b.endsAt < now) return { label: 'Berakhir', tone: 'warning' };
  return { label: 'Tayang', tone: 'success' };
}

const formPage = (data: Record<string, unknown>) => ({ active: 'banner', backHref: '/admin/banner', ...data });

bannerRouter.get(
  '/banner',
  handle(async (req, res) => {
    const banners = await prisma.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    await res.renderAdmin('banner/index', {
      pageTitle: 'Banner hero',
      active: 'banner',
      canEdit: canEdit(req, 'tampilan'),
      banners: banners.map((b, i) => ({ ...b, status: bannerStatus(b), first: i === 0, last: i === banners.length - 1 })),
      liveCount: banners.filter((b) => bannerStatus(b).label === 'Tayang').length,
    });
  }),
);

bannerRouter.get(
  '/banner/baru',
  editOnly,
  handle(async (_req, res) => {
    await res.renderAdmin('banner/form', formPage({ pageTitle: 'Banner baru', values: { isActive: true } }));
  }),
);

async function save(req: Request, before?: Banner) {
  const parsed = parseForm(schema, req.body);
  if (!parsed.ok) return { errors: parsed.errors };
  const data = { ...parsed.data, imageUrl: parsed.data.imageUrl! };
  const banner = await prisma.$transaction(async (tx) => {
    if (before) {
      const after = await tx.banner.update({ where: { id: before.id }, data });
      await audit(tx, req, { action: 'update', entityType: 'banner', entityId: after.id, entityLabel: after.title, changes: diff(before, after) });
      return after;
    }
    const last = await tx.banner.findFirst({ orderBy: { sortOrder: 'desc' } });
    const created = await tx.banner.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    await audit(tx, req, { action: 'create', entityType: 'banner', entityId: created.id, entityLabel: created.title, changes: diff(null, created) });
    return created;
  });
  invalidateStorefront();
  return { banner };
}

bannerRouter.post(
  '/banner',
  editOnly,
  handle(async (req, res) => {
    const result = await save(req);
    if ('errors' in result) return res.renderAdmin('banner/form', formPage({ pageTitle: 'Banner baru', values: req.body, errors: result.errors }), 400);
    redirectWith(res, '/admin/banner', 'success', `Banner "${result.banner!.title}" ditambahkan.`);
  }),
);

bannerRouter.get(
  '/banner/:id',
  handle(async (req, res) => {
    const banner = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } });
    if (!banner) throw new HttpError(404, 'Banner tidak ditemukan.');
    await res.renderAdmin('banner/form', formPage({ pageTitle: `Ubah banner`, banner, values: banner, readOnly: !canEdit(req, 'tampilan') }));
  }),
);

bannerRouter.post(
  '/banner/:id',
  editOnly,
  handle(async (req, res) => {
    const banner = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } });
    if (!banner) throw new HttpError(404, 'Banner tidak ditemukan.');
    const result = await save(req, banner);
    if ('errors' in result) return res.renderAdmin('banner/form', formPage({ pageTitle: 'Ubah banner', banner, values: req.body, errors: result.errors }), 400);
    redirectWith(res, '/admin/banner', 'success', `Banner "${result.banner!.title}" disimpan.`);
  }),
);

bannerRouter.post(
  '/banner/:id/urutan',
  editOnly,
  handle(async (req, res) => {
    const banner = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } });
    const dir = direction(req.body?.arah);
    if (!banner || !dir) throw new HttpError(400, 'Permintaan tidak valid.');
    const order = moveStep(await prisma.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }), banner.id, dir);
    if (order) {
      await prisma.$transaction(async (tx) => {
        for (const o of order) await tx.banner.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } });
        await audit(tx, req, { action: 'reorder', entityType: 'banner', entityId: banner.id, entityLabel: banner.title, summary: `Digeser ${dir}` });
      });
    }
    res.redirect(303, `/admin/banner#banner-${banner.id}`);
  }),
);

bannerRouter.post(
  '/banner/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const banner = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } });
    if (!banner) throw new HttpError(404, 'Banner tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.banner.update({ where: { id: banner.id }, data: { isActive: !banner.isActive } });
      await audit(tx, req, { action: 'update', entityType: 'banner', entityId: banner.id, entityLabel: banner.title, changes: { isActive: [banner.isActive, !banner.isActive] } });
    });
    redirectWith(res, `/admin/banner#banner-${banner.id}`, 'success', `Banner ${banner.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
  }),
);

bannerRouter.post(
  '/banner/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const banner = await prisma.banner.findUnique({ where: { id: Number(req.params.id) } });
    if (!banner) throw new HttpError(404, 'Banner tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.banner.delete({ where: { id: banner.id } });
      await audit(tx, req, { action: 'delete', entityType: 'banner', entityId: banner.id, entityLabel: banner.title, changes: diff(banner, null) });
    });
    redirectWith(res, '/admin/banner', 'success', `Banner "${banner.title}" dihapus.`);
  }),
);
