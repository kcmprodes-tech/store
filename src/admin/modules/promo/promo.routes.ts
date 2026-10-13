/**
 * Kode promo. Catatan: checkout store baru memakai data ini di Tahap 3 (sekarang checkout masih
 * memakai 2 kode bawaan prototipe di store-v2.js).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { formatRupiah } from '../../../lib/format.js';
import { prisma } from '../../../lib/prisma.js';
import type { PromoCode } from '../../../generated/prisma/client.js';
import { audit, diff } from '../../audit.js';
import { canEdit, checkbox, handle, HttpError, optionalInt, parseForm, q, redirectWith, requiredInt, requirePermission } from '../../http.js';
import { fromDateTimeLocal } from '../../time.js';

export const promoRouter = Router();
promoRouter.use('/promo', requirePermission('promo', 'view'));
const editOnly = requirePermission('promo', 'edit');

const schema = z
  .object({
    code: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      z.string().min(3, 'Minimal 3 karakter.').max(40, 'Maksimal 40 karakter.').regex(/^[A-Z0-9_-]+$/, 'Hanya huruf, angka, - dan _ (tanpa spasi).'),
    ),
    type: z.enum(['FIXED', 'PERCENT']),
    value: requiredInt(1, 100_000_000, 'Nilai potongan'),
    minSpend: z.preprocess((v) => (v === '' || v == null ? 0 : v), requiredInt(0, 1_000_000_000, 'Minimal belanja')),
    maxDiscount: optionalInt(1, 100_000_000),
    quota: optionalInt(1, 10_000_000),
    startsAt: z.preprocess(fromDateTimeLocal, z.date().nullable()),
    endsAt: z.preprocess(fromDateTimeLocal, z.date().nullable()),
    isActive: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.type === 'PERCENT' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Persen maksimal 100.' });
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Waktu selesai harus setelah waktu mulai.' });
  });

export function promoStatus(p: PromoCode, now = new Date()) {
  if (!p.isActive) return { label: 'Nonaktif', tone: '' };
  if (p.endsAt && p.endsAt < now) return { label: 'Berakhir', tone: 'warning' };
  if (p.quota !== null && p.usedCount >= p.quota) return { label: 'Kuota habis', tone: 'warning' };
  if (p.startsAt && p.startsAt > now) return { label: 'Terjadwal', tone: 'info' };
  return { label: 'Aktif', tone: 'success' };
}

const discountText = (p: Pick<PromoCode, 'type' | 'value' | 'maxDiscount'>) =>
  p.type === 'PERCENT' ? `${p.value}%${p.maxDiscount ? ` (maks. ${formatRupiah(p.maxDiscount)})` : ''}` : formatRupiah(p.value);

const formPage = (data: Record<string, unknown>) => ({ active: 'promo', backHref: '/admin/promo', ...data });

promoRouter.get(
  '/promo',
  handle(async (req, res) => {
    const search = q(req.query.q).toUpperCase().slice(0, 40);
    const promos = await prisma.promoCode.findMany({
      where: search ? { code: { contains: search } } : {},
      orderBy: [{ isActive: 'desc' }, { id: 'desc' }],
    });
    await res.renderAdmin('promo/index', {
      pageTitle: 'Promo',
      active: 'promo',
      canEdit: canEdit(req, 'promo'),
      search,
      promos: promos.map((p) => ({ ...p, status: promoStatus(p), discountText: discountText(p) })),
    });
  }),
);

promoRouter.get(
  '/promo/baru',
  editOnly,
  handle(async (_req, res) => {
    await res.renderAdmin('promo/form', formPage({ pageTitle: 'Promo baru', values: { type: 'FIXED', minSpend: 0, isActive: true } }));
  }),
);

async function save(req: Request, before?: PromoCode) {
  const body = before && before.usedCount > 0 ? { ...req.body, code: before.code } : req.body;
  const parsed = parseForm(schema, body);
  const errors: Record<string, string> = parsed.ok ? {} : parsed.errors;
  if (parsed.ok) {
    const dup = await prisma.promoCode.findUnique({ where: { code: parsed.data.code } });
    if (dup && dup.id !== before?.id) errors.code = `Kode ${parsed.data.code} sudah ada.`;
  }
  if (!parsed.ok || Object.keys(errors).length) return { errors };
  const data = { ...parsed.data, maxDiscount: parsed.data.type === 'PERCENT' ? parsed.data.maxDiscount : null };
  const promo = await prisma.$transaction(async (tx) => {
    if (before) {
      const after = await tx.promoCode.update({ where: { id: before.id }, data });
      await audit(tx, req, { action: 'update', entityType: 'promo', entityId: after.id, entityLabel: after.code, changes: diff(before, after) });
      return after;
    }
    const created = await tx.promoCode.create({ data });
    await audit(tx, req, { action: 'create', entityType: 'promo', entityId: created.id, entityLabel: created.code, changes: diff(null, created) });
    return created;
  });
  return { promo };
}

promoRouter.post(
  '/promo',
  editOnly,
  handle(async (req, res) => {
    const result = await save(req);
    if ('errors' in result) return res.renderAdmin('promo/form', formPage({ pageTitle: 'Promo baru', values: req.body, errors: result.errors }), 400);
    redirectWith(res, '/admin/promo', 'success', `Promo ${result.promo!.code} dibuat.`);
  }),
);

promoRouter.get(
  '/promo/:id',
  handle(async (req, res) => {
    const promo = await prisma.promoCode.findUnique({ where: { id: Number(req.params.id) }, include: { _count: { select: { redemptions: true } } } });
    if (!promo) throw new HttpError(404, 'Promo tidak ditemukan.');
    await res.renderAdmin('promo/form', formPage({ pageTitle: promo.code, promo, status: promoStatus(promo), values: promo, readOnly: !canEdit(req, 'promo') }));
  }),
);

promoRouter.post(
  '/promo/:id',
  editOnly,
  handle(async (req, res) => {
    const promo = await prisma.promoCode.findUnique({ where: { id: Number(req.params.id) } });
    if (!promo) throw new HttpError(404, 'Promo tidak ditemukan.');
    const result = await save(req, promo);
    if ('errors' in result) return res.renderAdmin('promo/form', formPage({ pageTitle: promo.code, promo, status: promoStatus(promo), values: req.body, errors: result.errors }), 400);
    redirectWith(res, '/admin/promo', 'success', `Promo ${result.promo!.code} disimpan.`);
  }),
);

promoRouter.post(
  '/promo/:id/tampil',
  editOnly,
  handle(async (req, res) => {
    const promo = await prisma.promoCode.findUnique({ where: { id: Number(req.params.id) } });
    if (!promo) throw new HttpError(404, 'Promo tidak ditemukan.');
    await prisma.$transaction(async (tx) => {
      await tx.promoCode.update({ where: { id: promo.id }, data: { isActive: !promo.isActive } });
      await audit(tx, req, { action: 'update', entityType: 'promo', entityId: promo.id, entityLabel: promo.code, changes: { isActive: [promo.isActive, !promo.isActive] } });
    });
    redirectWith(res, '/admin/promo', 'success', `Promo ${promo.code} ${promo.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
  }),
);

promoRouter.post(
  '/promo/:id/hapus',
  editOnly,
  handle(async (req, res) => {
    const promo = await prisma.promoCode.findUnique({ where: { id: Number(req.params.id) }, include: { _count: { select: { redemptions: true } } } });
    if (!promo) throw new HttpError(404, 'Promo tidak ditemukan.');
    if (promo.usedCount > 0 || promo._count.redemptions > 0) {
      return redirectWith(res, '/admin/promo', 'error', `Promo ${promo.code} sudah pernah dipakai, jadi tidak bisa dihapus. Nonaktifkan saja.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.promoCode.delete({ where: { id: promo.id } });
      const { _count, ...plain } = promo;
      await audit(tx, req, { action: 'delete', entityType: 'promo', entityId: promo.id, entityLabel: promo.code, changes: diff(plain, null) });
    });
    redirectWith(res, '/admin/promo', 'success', `Promo ${promo.code} dihapus.`);
  }),
);
