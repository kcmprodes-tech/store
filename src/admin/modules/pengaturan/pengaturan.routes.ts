/** Pengaturan store (Admin): nomor WhatsApp, ambang stok menipis default; info proteksi paket. */
import { Router } from 'express';
import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import { getSettings } from '../../../lib/settings.js';
import { invalidateStorefront } from '../../../modules/storefront/storefront.service.js';
import { audit } from '../../audit.js';
import { handle, redirectWith, requirePermission } from '../../http.js';
import { DEFAULT_LOW_STOCK, resetLowStockCache } from '../stok/stok.service.js';

export const pengaturanRouter = Router();
pengaturanRouter.use('/pengaturan', requirePermission('pengaturan', 'edit'));

const KEYS = ['whatsapp_number', 'low_stock_threshold_default', 'protection_fee', 'protection_fee_enabled'] as const;

/** Nomor WhatsApp → format 62… (terima 08…, +62…, spasi & tanda hubung). Kosong = pakai .env. */
export function normalizeWhatsapp(input: string): { value: string } | { error: string } {
  const digits = input.replace(/[\s\-().+]/g, '');
  if (!digits) return { value: '' };
  if (!/^\d+$/.test(digits)) return { error: 'Nomor hanya boleh angka.' };
  const n = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
  if (!/^62[1-9]\d{7,12}$/.test(n)) return { error: 'Format nomor Indonesia: 62 lalu 9–13 digit, mis. 6281234567890.' };
  return { value: n };
}

async function current() {
  const s = await getSettings([...KEYS]);
  const fromSettings = String(s.whatsapp_number ?? '').replace(/\D/g, '');
  return {
    whatsapp: fromSettings,
    whatsappEffective: fromSettings || env.whatsappNumber,
    whatsappFromEnv: !fromSettings && Boolean(env.whatsappNumber),
    lowStock: Number.isInteger(Number(s.low_stock_threshold_default)) ? Number(s.low_stock_threshold_default) : DEFAULT_LOW_STOCK,
    protectionFee: Number(s.protection_fee ?? 0),
    protectionEnabled: s.protection_fee_enabled === true,
  };
}

pengaturanRouter.get(
  '/pengaturan',
  handle(async (_req, res) => {
    const values = await current();
    await res.renderAdmin('pengaturan/index', { pageTitle: 'Pengaturan', active: 'pengaturan', values, settings: values });
  }),
);

pengaturanRouter.post(
  '/pengaturan',
  handle(async (req, res) => {
    const before = await current();
    const errors: Record<string, string> = {};
    const wa = normalizeWhatsapp(String(req.body?.whatsapp ?? ''));
    if ('error' in wa) errors.whatsapp = wa.error;
    const lowStock = Number(String(req.body?.lowStock ?? '').trim());
    if (!Number.isInteger(lowStock) || lowStock < 0 || lowStock > 1000) errors.lowStock = 'Isi angka 0–1000.';
    if (Object.keys(errors).length) {
      return res.renderAdmin('pengaturan/index', { pageTitle: 'Pengaturan', active: 'pengaturan', values: { ...before, ...req.body }, settings: before, errors }, 400);
    }
    const whatsapp = 'value' in wa ? wa.value : '';
    await prisma.$transaction(async (tx) => {
      if (whatsapp) await tx.setting.upsert({ where: { key: 'whatsapp_number' }, create: { key: 'whatsapp_number', value: whatsapp }, update: { value: whatsapp } });
      else await tx.setting.deleteMany({ where: { key: 'whatsapp_number' } });
      await tx.setting.upsert({ where: { key: 'low_stock_threshold_default' }, create: { key: 'low_stock_threshold_default', value: lowStock }, update: { value: lowStock } });
      const changes: Record<string, [unknown, unknown]> = {};
      if (before.whatsapp !== whatsapp) changes.whatsapp_number = [before.whatsapp || null, whatsapp || null];
      if (before.lowStock !== lowStock) changes.low_stock_threshold_default = [before.lowStock, lowStock];
      if (Object.keys(changes).length) await audit(tx, req, { action: 'update', entityType: 'setting', entityLabel: 'Pengaturan store', changes });
    });
    invalidateStorefront();
    resetLowStockCache();
    redirectWith(res, '/admin/pengaturan', 'success', 'Pengaturan disimpan dan langsung berlaku di store.');
  }),
);
