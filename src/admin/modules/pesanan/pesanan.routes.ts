/**
 * Modul Pesanan: daftar per tahap kerja, detail + aksi sesuai peran & status, foto paket/retur (privat),
 * label kirim, dan layar serah terima dari QR pengambilan (/admin/ambil/<token>).
 * Semua aksi lewat pesanan.service (transaksi + kunci baris) dan dicatat di log perubahan.
 */
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express, { Router, type Request, type Response } from 'express';
import { MAX_IMAGE_BYTES, privatePath, savePrivateImage, sniffImage } from '../../../adapters/storage/local.js';
import { isProd } from '../../../config/env.js';
import { formatRupiah } from '../../../lib/format.js';
import { INVOICE_PATTERN } from '../../../lib/invoice.js';
import { prisma } from '../../../lib/prisma.js';
import type { Fulfillment, OrderStatus, Prisma } from '../../../generated/prisma/client.js';
import { audit } from '../../audit.js';
import { code128Svg, pickupUrl, qrSvg } from '../../codes.js';
import { handle, HttpError, pageParam, q, redirectWith, requirePermission } from '../../http.js';
import { actionMap, canDo, type Action } from '../../permissions.js';
import { formatDateTime } from '../../time.js';
import { resetLowStockCache } from '../stok/stok.service.js';
import {
  cancelOrder,
  completeOrder,
  handoverCourier,
  handoverPickup,
  inOrderTx,
  LATE_PROCESSING_DAYS,
  markPacked,
  markPaid,
  markReadyPickup,
  PICKUP_CANCEL_DAYS,
  receiveReturn,
  requestRefund,
  setPackedQty,
  setTracking,
  type Actor,
} from './pesanan.service.js';
import {
  addressOf,
  orderSearchWhere,
  autoCompleteAt,
  displayPhone,
  fulfillmentInfo,
  lateOf,
  phoneLast4,
  refundBadge,
  stageOf,
  statusBadge,
  waTemplates,
} from './pesanan.view.js';

type Tx = Prisma.TransactionClient;

export const pesananRouter = Router();
pesananRouter.use(['/pesanan', '/berkas', '/ambil'], requirePermission('pesanan', 'view'));

const PER_PAGE = 30;
const DAY = 86400_000;

export const COURIERS = ['JNE', 'J&T Express', 'SiCepat', 'AnterAja', 'Pos Indonesia', 'GoSend', 'GrabExpress', 'Kurir toko'];
export const REFUND_REASONS = ['Barang rusak', 'Barang tidak sesuai', 'Barang kurang', 'Pesanan dibatalkan', 'Lainnya'];
export const CANCEL_REASONS = ['Permintaan pembeli', 'Stok habis', 'Alamat tidak terjangkau', 'Tidak diambil', 'Lainnya'];

// ───────────── Daftar ─────────────

// Urutan tab: Semua paling kiri; tab default saat halaman dibuka tetap "Perlu diproses".
const TABS = {
  semua: { label: 'Semua', status: null },
  proses: { label: 'Perlu diproses', status: ['PROCESSING'] },
  siap: { label: 'Siap diambil', status: ['READY_PICKUP'] },
  dikirim: { label: 'Dikirim', status: ['SHIPPED'] },
  'belum-bayar': { label: 'Belum dibayar', status: ['UNPAID'] },
  selesai: { label: 'Selesai', status: ['COMPLETED'] },
  batal: { label: 'Batal', status: ['CANCELED', 'EXPIRED'] },
} as const satisfies Record<string, { label: string; status: readonly OrderStatus[] | null }>;
type TabKey = keyof typeof TABS;

const FULFILLMENT_FILTERS: Record<string, Fulfillment> = { kirim: 'SHIPPING', ambil: 'PICKUP', digital: 'DIGITAL' };

const ORDER_BY: Record<TabKey, Prisma.OrderOrderByWithRelationInput[]> = {
  proses: [{ paidAt: 'asc' }, { id: 'asc' }],
  siap: [{ readyAt: 'asc' }, { id: 'asc' }],
  dikirim: [{ shippedAt: 'desc' }, { id: 'desc' }],
  'belum-bayar': [{ paymentDueAt: 'asc' }, { id: 'asc' }],
  selesai: [{ completedAt: 'desc' }, { id: 'desc' }],
  batal: [{ canceledAt: 'desc' }, { id: 'desc' }],
  semua: [{ createdAt: 'desc' }, { id: 'desc' }],
};

const listSelect = {
  id: true,
  invoiceNo: true,
  status: true,
  fulfillment: true,
  total: true,
  buyerName: true,
  paidAt: true,
  packedAt: true,
  trackingNo: true,
  courier: true,
  readyAt: true,
  shippedAt: true,
  completedAt: true,
  canceledAt: true,
  paymentDueAt: true,
  createdAt: true,
  items: { select: { productTitle: true, qty: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.OrderSelect;

const WHEN: Record<TabKey, [string, keyof Prisma.OrderGetPayload<{ select: typeof listSelect }>]> = {
  proses: ['Dibayar', 'paidAt'],
  siap: ['Siap sejak', 'readyAt'],
  dikirim: ['Dikirim', 'shippedAt'],
  'belum-bayar': ['Batas bayar', 'paymentDueAt'],
  selesai: ['Selesai', 'completedAt'],
  batal: ['Dibatalkan', 'canceledAt'],
  semua: ['Dibuat', 'createdAt'],
};

pesananRouter.get(
  '/pesanan',
  handle(async (req, res) => {
    const tab: TabKey = (q(req.query.status) in TABS ? q(req.query.status) : 'proses') as TabKey;
    const search = q(req.query.q).slice(0, 100);
    const cara = q(req.query.cara) in FULFILLMENT_FILTERS ? q(req.query.cara) : '';
    const late = req.query.terlambat === '1';
    const page = pageParam(req.query.hal);
    const now = new Date();

    const base: Prisma.OrderWhereInput = { ...orderSearchWhere(search), ...(cara ? { fulfillment: FULFILLMENT_FILTERS[cara] } : {}) };
    const statuses = TABS[tab].status;
    const where: Prisma.OrderWhereInput = {
      ...base,
      ...(statuses ? { status: { in: [...statuses] } } : {}),
      ...(late ? { status: 'PROCESSING', paidAt: { lt: new Date(now.getTime() - LATE_PROCESSING_DAYS * DAY) } } : {}),
    };
    const [grouped, total, orders] = await Promise.all([
      prisma.order.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.order.count({ where }),
      prisma.order.findMany({ where, orderBy: ORDER_BY[tab], skip: (page - 1) * PER_PAGE, take: PER_PAGE, select: listSelect }),
    ]);
    const countOf = (list: readonly OrderStatus[] | null) =>
      grouped.filter((g) => !list || list.includes(g.status)).reduce((n, g) => n + g._count._all, 0);

    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const link = (patch: Record<string, string | number | null>) => {
      const s = new URLSearchParams();
      const merged: Record<string, string | number | null> = { status: tab, q: search, cara, terlambat: late ? '1' : null, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v !== null && v !== '' && !(k === 'status' && v === 'proses')) s.set(k, String(v));
      return `/admin/pesanan${s.toString() ? `?${s}` : ''}`;
    };
    const [whenLabel, whenField] = WHEN[tab];
    await res.renderAdmin('pesanan/index', {
      pageTitle: 'Pesanan',
      active: 'pesanan',
      tabs: (Object.keys(TABS) as TabKey[]).map((key) => ({
        key,
        label: TABS[key].label,
        count: countOf(TABS[key].status),
        active: key === tab,
        href: link({ status: key, hal: null, terlambat: null }),
      })),
      filters: { q: search, cara, status: tab, terlambat: late },
      fulfillmentOptions: [
        { value: '', label: 'Semua cara kirim' },
        { value: 'kirim', label: 'Dikirim kurir' },
        { value: 'ambil', label: 'Ambil di tempat' },
        { value: 'digital', label: 'Digital' },
      ],
      clearLateHref: late ? link({ terlambat: null, hal: null }) : null,
      rows: orders.map((o) => ({
        invoiceNo: o.invoiceNo,
        buyerName: o.buyerName ?? '—',
        summary: o.items[0] ? `${o.items[0].productTitle}${o.items.length > 1 ? ` +${o.items.length - 1} lainnya` : ''}` : '—',
        qty: o.items.reduce((n, i) => n + i.qty, 0),
        total: o.total,
        fulfillment: fulfillmentInfo(o.fulfillment),
        status: statusBadge(o),
        stage: stageOf(o),
        late: lateOf(o, now),
        whenLabel,
        when: o[whenField] as Date | null,
        trackingNo: o.trackingNo,
      })),
      total,
      page,
      pages,
      prevHref: page > 1 ? link({ hal: page - 1 }) : null,
      nextHref: page < pages ? link({ hal: page + 1 }) : null,
    });
  }),
);

// ───────────── Detail ─────────────

const detailInclude = {
  items: { orderBy: { id: 'asc' }, include: { variant: { select: { productId: true } } } },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  payments: { orderBy: { id: 'asc' } },
  pickupLocation: true,
  attachments: { orderBy: { id: 'asc' } },
  refunds: { orderBy: { id: 'asc' } },
  returns: { orderBy: { id: 'asc' } },
  user: { select: { email: true, name: true } },
} satisfies Prisma.OrderInclude;

async function findOrder(invoice: unknown) {
  const invoiceNo = String(invoice ?? '').toUpperCase();
  if (!INVOICE_PATTERN.test(invoiceNo)) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  const order = await prisma.order.findUnique({ where: { invoiceNo }, include: detailInclude });
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  return order;
}
type DetailOrder = Awaited<ReturnType<typeof findOrder>>;

const refundedTotal = (o: DetailOrder) => o.refunds.filter((r) => r.status !== 'REJECTED').reduce((n, r) => n + r.amount, 0);

/** Aksi yang boleh dilakukan akun ini pada pesanan ini (peran × status). */
function actionsFor(req: Request, o: DetailOrder) {
  const roles = req.admin!.roles;
  const fulfil = canDo(roles, 'order.fulfil');
  const open = o.status === 'PROCESSING';
  const shipping = o.fulfillment === 'SHIPPING';
  const remaining = o.total - refundedTotal(o);
  return {
    simulatePay: !isProd && canDo(roles, 'order.simulate') && o.status === 'UNPAID',
    pack: fulfil && shipping && open && !o.packedAt,
    tracking: fulfil && shipping && open && Boolean(o.packedAt),
    handoverCourier: fulfil && shipping && open && Boolean(o.packedAt && o.trackingNo),
    readyPickup: fulfil && o.fulfillment === 'PICKUP' && open,
    handoverPickup: fulfil && o.status === 'READY_PICKUP',
    complete: canDo(roles, 'order.complete') && o.status === 'SHIPPED',
    cancel: canDo(roles, 'order.cancel') && ['UNPAID', 'PROCESSING', 'READY_PICKUP'].includes(o.status),
    refund: canDo(roles, 'refund.request') && Boolean(o.paidAt) && remaining > 0 && ['SHIPPED', 'COMPLETED', 'CANCELED'].includes(o.status),
    retur: fulfil && ['SHIPPED', 'COMPLETED'].includes(o.status) && o.items.some((i) => i.shippedQty > i.returnedQty),
    photo: fulfil && o.fulfillment !== 'DIGITAL' && !['UNPAID', 'EXPIRED'].includes(o.status),
    label: fulfil && shipping && ['PROCESSING', 'SHIPPED'].includes(o.status),
    contact: canDo(roles, 'order.contact') && Boolean(o.buyerPhone),
    remaining,
  };
}

async function detailView(req: Request, o: DetailOrder) {
  const actions = actionsFor(req, o);
  const method = o.paymentMethodCode ? await prisma.paymentMethod.findUnique({ where: { code: o.paymentMethodCode }, select: { name: true } }) : null;
  const now = new Date();
  return {
    pageTitle: o.invoiceNo,
    active: 'pesanan',
    backHref: '/admin/pesanan',
    scripts: ['/cms/pesanan.js'],
    o,
    can: actionMap(req.admin!.roles),
    actions,
    status: statusBadge(o),
    stage: stageOf(o),
    late: lateOf(o, now),
    fulfillment: fulfillmentInfo(o.fulfillment),
    address: addressOf(o.addressSnapshot),
    phone: displayPhone(o.buyerPhone),
    paymentMethod: method?.name ?? o.paymentMethodCode,
    autoCompleteAt: autoCompleteAt(o),
    pickupCancelFrom: o.readyAt ? new Date(o.readyAt.getTime() + PICKUP_CANCEL_DAYS * DAY) : null,
    pickupQr: o.status === 'READY_PICKUP' && o.pickupToken && actions.handoverPickup ? qrSvg(pickupUrl(o.pickupToken)) : null,
    items: o.items.map((i) => ({ ...i, lineTotal: i.price * i.qty, returnable: i.shippedQty - i.returnedQty, productId: i.variant?.productId ?? null })),
    itemCount: o.items.reduce((n, i) => n + i.qty, 0),
    history: [...o.history].reverse().map((h) => ({ ...h, badge: statusBadge(h) })),
    photos: o.attachments.map((a) => ({ id: a.id, kind: a.kind === 'PACKAGE' ? 'Foto paket' : 'Foto retur', createdBy: a.createdBy, createdAt: a.createdAt })),
    refunds: o.refunds.map((r) => ({ ...r, badge: refundBadge(r.status), overdue: ['REQUESTED', 'APPROVED'].includes(r.status) && r.dueAt < now })),
    returns: o.returns.map((r) => ({ ...r, lines: (r.items as { orderItemId: number; receivedQty: number; restockQty: number }[]).map((l) => ({ ...l, sku: o.items.find((i) => i.id === l.orderItemId)?.sku ?? '?' })) })),
    whatsapp: actions.contact ? waTemplates(o) : [],
    couriers: COURIERS,
    refundReasons: REFUND_REASONS,
    cancelReasons: CANCEL_REASONS,
    isDev: !isProd,
  };
}

pesananRouter.get(
  '/pesanan/:invoice',
  handle(async (req, res) => {
    const order = await findOrder(req.params.invoice);
    if (order.invoiceNo !== req.params.invoice) return res.redirect(301, `/admin/pesanan/${order.invoiceNo}`);
    await res.renderAdmin('pesanan/detail', await detailView(req, order));
  }),
);

// ───────────── Aksi ─────────────

const actorOf = (req: Request): Actor => ({ email: req.admin!.email, id: req.admin!.id });
const wantsJson = (req: Request) => req.get('x-requested-with') === 'fetch';

type ActionResult = { already?: boolean; message: string; summary?: string; redirect?: string; flash?: 'error' | 'info' };

/**
 * Jalankan aksi pesanan: cek hak akses aksi → transaksi (layanan + log perubahan) → kembali ke detail dengan pesan.
 * Error bisnis (409/400/403) ditampilkan sebagai pesan, bukan halaman error.
 */
async function runAction(req: Request, res: Response, action: Action, auditAction: string, run: (tx: Tx, order: DetailOrder, actor: Actor) => Promise<ActionResult>) {
  if (!canDo(req.admin!.roles, action)) throw new HttpError(403, 'Peran Anda tidak bisa melakukan aksi ini.');
  const order = await findOrder(req.params.invoice);
  const back = `/admin/pesanan/${order.invoiceNo}`;
  let out: ActionResult;
  try {
    out = await inOrderTx(async (tx) => {
      const r = await run(tx, order, actorOf(req));
      if (!r.already) {
        await audit(tx, req, { action: auditAction, entityType: 'order', entityId: order.invoiceNo, entityLabel: order.invoiceNo, summary: r.summary ?? r.message });
      }
      return r;
    });
  } catch (err) {
    if (err instanceof HttpError && err.status < 500 && err.status !== 404) {
      if (wantsJson(req)) return res.status(err.status).json({ error: err.message });
      return redirectWith(res, back, 'error', err.message);
    }
    throw err;
  }
  resetLowStockCache();
  if (wantsJson(req)) return res.json({ ok: true, already: Boolean(out.already), message: out.message });
  redirectWith(res, out.redirect ?? back, out.flash ?? (out.already ? 'info' : 'success'), out.message);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

pesananRouter.post(
  '/pesanan/:invoice/bayar-simulasi',
  handle(async (req, res) => {
    if (isProd) throw new HttpError(404, 'Halaman tidak ditemukan.');
    await runAction(req, res, 'order.simulate', 'order.pay', async (tx, o, actor) => {
      const r = await markPaid(tx, o.id, { ...actor, email: `${actor.email} (simulasi)` });
      return { already: r.already, message: r.already ? 'Pesanan sudah dibayar.' : 'Pembayaran disimulasikan: pesanan masuk Perlu diproses.' };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/kemas',
  handle(async (req, res) => {
    // Checkbox name="packed" value="<id item>": satu nilai (string) atau beberapa (array).
    const checked = new Set(([] as unknown[]).concat(req.body?.packed ?? []).map((v) => Number(v)));
    await runAction(req, res, 'order.fulfil', 'order.pack', async (tx, o, actor) => {
      if (o.packedAt) return { already: true, message: 'Pesanan sudah dikemas.' };
      for (const item of o.items) await setPackedQty(tx, o.id, item.id, checked.has(item.id) ? item.qty : 0);
      const missing = o.items.filter((i) => !checked.has(i.id));
      // Centang yang sudah ada tetap tersimpan walau belum lengkap.
      if (missing.length) return { already: true, flash: 'error', message: `Centangan disimpan. Belum dicentang: ${missing.map((i) => i.sku).join(', ')}.` };
      const r = await markPacked(tx, o.id, actor);
      return { already: r.already, message: 'Selesai dikemas. Isi no resi berikutnya.' };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/resi',
  handle(async (req, res) => {
    const courier = text(req.body?.courier, 120);
    const trackingNo = text(req.body?.trackingNo, 80);
    await runAction(req, res, 'order.fulfil', 'order.tracking', async (tx, o, actor) => {
      if (!courier) throw new HttpError(400, 'Pilih kurir.');
      if (!trackingNo) throw new HttpError(400, 'Isi no resi.');
      const r = await setTracking(tx, o.id, { courier, trackingNo }, actor);
      return { message: `Resi ${r.order.trackingNo} disimpan. Pesanan siap diserahkan ke kurir.` };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/serahkan-kurir',
  handle(async (req, res) => {
    await runAction(req, res, 'order.fulfil', 'order.ship', async (tx, o, actor) => {
      const r = await handoverCourier(tx, o.id, actor);
      return { already: r.already, message: r.already ? 'Pesanan sudah diserahkan ke kurir.' : 'Diserahkan ke kurir. Status: Dikirim.' };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/siap-diambil',
  handle(async (req, res) => {
    await runAction(req, res, 'order.fulfil', 'order.ready', async (tx, o, actor) => {
      const r = await markReadyPickup(tx, o.id, actor);
      return { already: r.already, message: r.already ? 'Pesanan sudah siap diambil.' : 'Pesanan siap diambil. Kabari pembeli lewat WhatsApp.' };
    });
  }),
);

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Serahkan ke pembeli: wajib QR pengambilan (token) atau 4 digit terakhir HP pembeli. */
pesananRouter.post(
  '/pesanan/:invoice/serahkan-pembeli',
  handle(async (req, res) => {
    const token = text(req.body?.token, 80);
    const last4 = text(req.body?.phone4, 4);
    await runAction(req, res, 'order.fulfil', 'order.pickup', async (tx, o, actor) => {
      if (o.status === 'COMPLETED' && o.pickedUpAt) {
        return { already: true, message: `Sudah diambil pada ${formatDateTime(o.pickedUpAt)} (diserahkan oleh ${o.pickedUpBy}).` };
      }
      const byToken = Boolean(token && o.pickupToken && sameSecret(token, o.pickupToken));
      if (!byToken) {
        const expected = phoneLast4(o.buyerPhone);
        if (!/^\d{4}$/.test(last4)) throw new HttpError(400, 'Isi 4 digit terakhir no HP pembeli.');
        if (!expected || !sameSecret(last4, expected)) throw new HttpError(400, '4 digit terakhir no HP tidak cocok. Periksa lagi identitas pembeli.');
      }
      const r = await handoverPickup(tx, o.id, actor);
      return {
        already: r.already,
        message: r.already ? 'Pesanan sudah diambil.' : 'Pesanan diserahkan ke pembeli. Status: Selesai.',
        summary: `Diserahkan ke pembeli (${byToken ? 'QR' : '4 digit HP'})`,
      };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/selesai',
  handle(async (req, res) => {
    await runAction(req, res, 'order.complete', 'order.complete', async (tx, o, actor) => {
      const r = await completeOrder(tx, o.id, actor, new Date(), 'Ditandai selesai oleh CS (pembeli sudah menerima)');
      return { already: r.already, message: r.already ? 'Pesanan sudah selesai.' : 'Pesanan ditandai selesai.' };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/batal',
  handle(async (req, res) => {
    const reason = text(req.body?.reason, 80);
    const detail = text(req.body?.detail, 160);
    await runAction(req, res, 'order.cancel', 'order.cancel', async (tx, o, actor) => {
      if (!CANCEL_REASONS.includes(reason)) throw new HttpError(400, 'Pilih alasan pembatalan.');
      if (reason === 'Lainnya' && !detail) throw new HttpError(400, 'Jelaskan alasan pembatalan.');
      const full = detail ? `${reason}: ${detail}` : reason;
      const r = await cancelOrder(tx, o.id, full, actor);
      if (r.already) return { already: true, message: 'Pesanan sudah dibatalkan.' };
      return {
        message: r.refund ? `Pesanan dibatalkan. Refund ${formatRupiah(r.refund.amount)} diajukan dan menunggu persetujuan Finance.` : 'Pesanan dibatalkan. Stok yang dipesan dilepas.',
        summary: `Dibatalkan: ${full}`,
      };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/refund',
  handle(async (req, res) => {
    const amount = Number(String(req.body?.amount ?? '').replace(/[^\d]/g, ''));
    const reason = text(req.body?.reason, 80);
    const detail = text(req.body?.detail, 400);
    await runAction(req, res, 'refund.request', 'refund.request', async (tx, o, actor) => {
      if (!REFUND_REASONS.includes(reason)) throw new HttpError(400, 'Pilih alasan refund.');
      if (reason === 'Lainnya' && !detail) throw new HttpError(400, 'Jelaskan alasan refund.');
      const r = await requestRefund(tx, o.id, { amount, reason: detail ? `${reason}: ${detail}` : reason }, actor);
      return { message: `Refund ${formatRupiah(r.amount)} diajukan. Menunggu persetujuan Finance.`, summary: `Refund ${formatRupiah(r.amount)} diajukan` };
    });
  }),
);

pesananRouter.post(
  '/pesanan/:invoice/retur',
  handle(async (req, res) => {
    const raw = req.body?.retur && typeof req.body.retur === 'object' ? (req.body.retur as Record<string, { received?: string; restock?: string }>) : {};
    // Kunci "id<n>" (bukan angka saja) supaya parser form tidak mengubahnya jadi array.
    const lines = Object.entries(raw).map(([key, v]) => ({ orderItemId: Number(key.replace(/^id/, '')), receivedQty: Number(v?.received || 0), restockQty: Number(v?.restock || 0) }));
    const note = text(req.body?.note, 500) || null;
    await runAction(req, res, 'order.fulfil', 'order.return', async (tx, o, actor) => {
      if (lines.some((l) => !Number.isInteger(l.receivedQty) || !Number.isInteger(l.restockQty) || l.receivedQty < 0)) throw new HttpError(400, 'Jumlah retur tidak valid.');
      const r = await receiveReturn(tx, o.id, lines, note, actor);
      const items = r.items as { receivedQty: number; restockQty: number }[];
      const received = items.reduce((n, l) => n + l.receivedQty, 0);
      const restock = items.reduce((n, l) => n + l.restockQty, 0);
      return { message: `Retur dicatat: ${received} barang diterima, ${restock} masuk stok lagi.` };
    });
  }),
);

// ───────────── Foto paket & retur (privat) ─────────────

pesananRouter.post(
  '/pesanan/:invoice/foto',
  (req, _res, next) => (canDo(req.admin!.roles, 'order.fulfil') ? next() : next(new HttpError(403, 'Peran Anda tidak bisa mengunggah foto pesanan.'))),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
  handle(async (req, res) => {
    const order = await findOrder(req.params.invoice);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(415, 'Format foto harus JPG, PNG, atau WebP.');
    const type = sniffImage(req.body);
    if (!type) throw new HttpError(415, 'File ini bukan foto JPG, PNG, atau WebP.');
    const kind = req.query.jenis === 'retur' ? 'RETURN' : 'PACKAGE';
    const path = await savePrivateImage(req.body, type);
    const attachment = await prisma.$transaction(async (tx) => {
      const a = await tx.orderAttachment.create({
        data: { orderId: order.id, kind, path, mime: type.mime, sizeBytes: req.body.length, createdBy: req.admin!.email },
      });
      await audit(tx, req, { action: 'order.photo', entityType: 'order', entityId: order.invoiceNo, entityLabel: order.invoiceNo, summary: kind === 'PACKAGE' ? 'Foto paket' : 'Foto retur' });
      return a;
    });
    res.status(201).json({ id: attachment.id, url: `/admin/berkas/${attachment.id}` });
  }),
);

pesananRouter.get(
  '/berkas/:id',
  handle(async (req, res) => {
    const a = await prisma.orderAttachment.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!a) throw new HttpError(404, 'File tidak ditemukan.');
    let buf: Buffer;
    try {
      buf = await readFile(privatePath(a.path));
    } catch {
      throw new HttpError(404, 'File tidak ditemukan.');
    }
    res.set('Cache-Control', 'private, no-store').type(a.mime).send(buf);
  }),
);

// ───────────── Label kirim (cetak 100×150 mm) ─────────────

pesananRouter.get(
  '/pesanan/:invoice/label',
  handle(async (req, res) => {
    if (!canDo(req.admin!.roles, 'order.fulfil')) throw new HttpError(403, 'Peran Anda tidak bisa mencetak label.');
    const o = await findOrder(req.params.invoice);
    if (o.fulfillment !== 'SHIPPING') throw new HttpError(404, 'Label kirim hanya untuk pesanan yang dikirim kurir.');
    const sender = await prisma.pickupLocation.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
    await res.renderAdmin('pesanan/label', {
      layout: 'print',
      pageTitle: `Label ${o.invoiceNo}`,
      o,
      address: addressOf(o.addressSnapshot),
      phone: displayPhone(o.buyerPhone),
      sender,
      invoiceQr: qrSvg(o.invoiceNo),
      invoiceBarcode: code128Svg(o.invoiceNo),
      trackingBarcode: o.trackingNo ? code128Svg(o.trackingNo) : null,
      itemCount: o.items.reduce((n, i) => n + i.qty, 0),
    });
  }),
);

// ───────────── QR pengambilan: /admin/ambil/<token> ─────────────

pesananRouter.get(
  '/ambil/:token',
  handle(async (req, res) => {
    const token = String(req.params.token ?? '');
    const order = /^[\w-]{16,80}$/.test(token) ? await prisma.order.findUnique({ where: { pickupToken: token }, select: { invoiceNo: true } }) : null;
    if (!order) {
      // Token dihapus saat batal; setelah diambil token tetap ada, jadi scan ulang menampilkan "sudah diambil".
      return res.renderAdmin('pesanan/ambil', { pageTitle: 'Ambil pesanan', active: 'pesanan', backHref: '/admin/pesanan', invalid: true }, 404);
    }
    const o = await findOrder(order.invoiceNo);
    await res.renderAdmin('pesanan/ambil', {
      pageTitle: 'Ambil pesanan',
      active: 'pesanan',
      backHref: `/admin/pesanan/${o.invoiceNo}`,
      o,
      token,
      canHandover: canDo(req.admin!.roles, 'order.fulfil') && o.status === 'READY_PICKUP',
      status: statusBadge(o),
      itemCount: o.items.reduce((n, i) => n + i.qty, 0),
      pickedUp: o.status === 'COMPLETED' && o.pickedUpAt ? { at: o.pickedUpAt, by: o.pickedUpBy } : null,
    });
  }),
);
