/**
 * Refund: CS mengajukan (dari detail pesanan), Finance/Admin lain memutuskan, lalu menandai dana sudah dikembalikan.
 * /admin/refund/:id?aksi=setujui|tolak = layar konfirmasi satu tombol (tautan dari notifikasi).
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { Prisma, RefundStatus } from '../../../generated/prisma/client.js';
import { audit } from '../../audit.js';
import { handle, HttpError, pageParam, q, redirectWith, requirePermission } from '../../http.js';
import { can, canDo } from '../../permissions.js';
import { formatRupiah } from '../../../lib/format.js';
import { completeRefund, decideRefund, inOrderTx } from './pesanan.service.js';
import { displayPhone, fulfillmentInfo, refundBadge, statusBadge } from './pesanan.view.js';

export const refundRouter = Router();
refundRouter.use('/refund', requirePermission('refund', 'view'));

const PER_PAGE = 30;

// Urutan tab: Semua paling kiri; tab default tetap "Menunggu keputusan".
const TABS = {
  semua: { label: 'Semua', status: null },
  menunggu: { label: 'Menunggu keputusan', status: ['REQUESTED'] },
  disetujui: { label: 'Perlu dibayar', status: ['APPROVED'] },
  selesai: { label: 'Selesai', status: ['COMPLETED'] },
  ditolak: { label: 'Ditolak', status: ['REJECTED'] },
} as const satisfies Record<string, { label: string; status: readonly RefundStatus[] | null }>;
type TabKey = keyof typeof TABS;

refundRouter.get(
  '/refund',
  handle(async (req, res) => {
    const tab: TabKey = (q(req.query.status) in TABS ? q(req.query.status) : 'menunggu') as TabKey;
    const search = q(req.query.q).slice(0, 100);
    const page = pageParam(req.query.hal);
    const now = new Date();
    const base: Prisma.RefundWhereInput = search
      ? { order: { OR: [{ invoiceNo: { contains: search.toUpperCase() } }, { buyerName: { contains: search } }] } }
      : {};
    const statuses = TABS[tab].status;
    const where: Prisma.RefundWhereInput = { ...base, ...(statuses ? { status: { in: [...statuses] } } : {}) };
    const [grouped, total, refunds] = await Promise.all([
      prisma.refund.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.refund.count({ where }),
      prisma.refund.findMany({
        where,
        orderBy: tab === 'menunggu' || tab === 'disetujui' ? [{ dueAt: 'asc' }, { id: 'asc' }] : [{ id: 'desc' }],
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
        include: { order: { select: { invoiceNo: true, buyerName: true, total: true, fulfillment: true } } },
      }),
    ]);
    const countOf = (list: readonly RefundStatus[] | null) => grouped.filter((g) => !list || list.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const link = (patch: Record<string, string | number | null>) => {
      const s = new URLSearchParams();
      const merged: Record<string, string | number | null> = { status: tab, q: search, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v !== null && v !== '' && !(k === 'status' && v === 'menunggu')) s.set(k, String(v));
      return `/admin/refund${s.toString() ? `?${s}` : ''}`;
    };
    await res.renderAdmin('refund/index', {
      pageTitle: 'Refund',
      active: 'refund',
      tabs: (Object.keys(TABS) as TabKey[]).map((key) => ({ key, label: TABS[key].label, count: countOf(TABS[key].status), active: key === tab, href: link({ status: key, hal: null }) })),
      filters: { q: search, status: tab },
      rows: refunds.map((r) => ({
        ...r,
        badge: refundBadge(r.status),
        overdue: ['REQUESTED', 'APPROVED'].includes(r.status) && r.dueAt < now,
        fulfillment: fulfillmentInfo(r.order.fulfillment),
      })),
      total,
      page,
      pages,
      prevHref: page > 1 ? link({ hal: page - 1 }) : null,
      nextHref: page < pages ? link({ hal: page + 1 }) : null,
    });
  }),
);

async function findRefund(id: unknown) {
  const refund = await prisma.refund.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      order: {
        include: {
          items: { orderBy: { id: 'asc' } },
          refunds: { orderBy: { id: 'asc' } },
          payments: { orderBy: { id: 'asc' } },
        },
      },
    },
  });
  if (!refund) throw new HttpError(404, 'Refund tidak ditemukan.');
  return refund;
}

refundRouter.get(
  '/refund/:id',
  handle(async (req, res) => {
    const r = await findRefund(req.params.id);
    const roles = req.admin!.roles;
    const decider = canDo(roles, 'refund.decide');
    const ownRequest = r.requestedById === req.admin!.id || r.requestedBy === req.admin!.email;
    const intent = req.query.aksi === 'setujui' || req.query.aksi === 'tolak' ? req.query.aksi : null;
    const others = r.order.refunds.filter((x) => x.id !== r.id);
    await res.renderAdmin('refund/detail', {
      pageTitle: `Refund ${r.order.invoiceNo}`,
      active: 'refund',
      backHref: '/admin/refund',
      r,
      badge: refundBadge(r.status),
      orderStatus: statusBadge(r.order),
      fulfillment: fulfillmentInfo(r.order.fulfillment),
      phone: displayPhone(r.order.buyerPhone),
      overdue: ['REQUESTED', 'APPROVED'].includes(r.status) && r.dueAt < new Date(),
      canOpenOrder: can(roles, 'pesanan', 'view'),
      canDecide: decider && r.status === 'REQUESTED' && !ownRequest,
      ownRequest: decider && r.status === 'REQUESTED' && ownRequest,
      canComplete: decider && r.status === 'APPROVED',
      intent: decider && r.status === 'REQUESTED' && !ownRequest ? intent : null,
      others: others.map((x) => ({ ...x, badge: refundBadge(x.status) })),
      refundedOther: others.filter((x) => x.status !== 'REJECTED').reduce((n, x) => n + x.amount, 0),
    });
  }),
);

async function runRefund(req: Request, res: Response, fn: (tx: Prisma.TransactionClient, id: number) => Promise<{ already: boolean; message: string; audit: string; summary: string }>) {
  if (!canDo(req.admin!.roles, 'refund.decide')) throw new HttpError(403, 'Hanya Finance atau Admin yang bisa memutuskan refund.');
  const r = await findRefund(req.params.id);
  const back = `/admin/refund/${r.id}`;
  try {
    const out = await inOrderTx(async (tx) => {
      const result = await fn(tx, r.id);
      if (!result.already) {
        await audit(tx, req, { action: result.audit, entityType: 'refund', entityId: r.id, entityLabel: `${r.order.invoiceNo} · ${formatRupiah(r.amount)}`, summary: result.summary });
      }
      return result;
    });
    redirectWith(res, back, out.already ? 'info' : 'success', out.message);
  } catch (err) {
    if (err instanceof HttpError && err.status < 500 && err.status !== 404) return redirectWith(res, back, 'error', err.message);
    throw err;
  }
}

refundRouter.post(
  '/refund/:id/putuskan',
  handle(async (req, res) => {
    const approve = req.body?.keputusan === 'setujui';
    if (!approve && req.body?.keputusan !== 'tolak') throw new HttpError(400, 'Keputusan tidak valid.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    await runRefund(req, res, async (tx, id) => {
      if (!approve && !note) throw new HttpError(400, 'Tulis alasan penolakan (akan disampaikan CS ke pembeli).');
      const { refund, already } = await decideRefund(tx, id, approve, note || null, { email: req.admin!.email, id: req.admin!.id });
      return {
        already,
        audit: approve ? 'refund.approve' : 'refund.reject',
        summary: `${approve ? 'Disetujui' : 'Ditolak'}${note ? `: ${note}` : ''}`,
        message: already
          ? `Refund sudah ${approve ? 'disetujui' : 'ditolak'}.`
          : approve
            ? `Refund ${formatRupiah(refund.amount)} disetujui. Kirim dananya, lalu tandai "Dana sudah dikembalikan".`
            : 'Refund ditolak. CS akan mengabari pembeli.',
      };
    });
  }),
);

refundRouter.post(
  '/refund/:id/selesai',
  handle(async (req, res) => {
    await runRefund(req, res, async (tx, id) => {
      const { refund, already } = await completeRefund(tx, id, { email: req.admin!.email, id: req.admin!.id });
      return { already, audit: 'refund.complete', summary: 'Dana dikembalikan', message: already ? 'Refund sudah selesai.' : `Dana ${formatRupiah(refund.amount)} ditandai sudah dikembalikan.` };
    });
  }),
);
