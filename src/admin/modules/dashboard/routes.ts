/** Dashboard CMS: satu halaman, widget mengikuti hak akses akun. */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { ACTION_LABELS, ENTITY_LABELS } from '../../audit.js';
import { handle } from '../../http.js';
import { permissionMap } from '../../permissions.js';
import { formatRupiah } from '../../../lib/format.js';
import { promoStatus } from '../promo/promo.routes.js';
import { fulfillmentInfo, statusBadge } from '../pesanan/pesanan.view.js';
import { lowStockCount, lowStockItems } from '../stok/stok.service.js';

export const dashboardRouter = Router();

type Tone = 'success' | 'warning' | 'info' | 'plain';
type Dot = { label: string; count: number; tone: Tone; href: string; title?: string };
type SummaryCard = {
  key: string;
  label: string;
  icon: string;
  value: number;
  sub?: string;
  subTitle?: string;
  dots: Dot[];
  viewHref: string;
  viewLabel: string;
  newHref?: string;
  newLabel?: string;
};

/** Kartu ringkasan per modul di atas dashboard (angka total + rincian status + tombol), sesuai hak akses. */
async function summaryCards(perms: ReturnType<typeof permissionMap>, now: Date): Promise<SummaryCard[]> {
  const cards: Promise<SummaryCard>[] = [];

  if (perms.produk.view) {
    cards.push(
      Promise.all([
        prisma.product.count({ where: { status: 'PUBLISHED', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] } }),
        prisma.product.count({ where: { status: 'PUBLISHED', publishedAt: { gt: now } } }),
        prisma.product.count({ where: { status: 'DRAFT' } }),
        // Unggulan = dipilih manual di seksi beranda yang sedang tampil
        prisma.homeSectionItem.findMany({
          where: { section: { isActive: true, source: 'MANUAL' }, product: { status: { not: 'ARCHIVED' } } },
          distinct: ['productId'],
          select: { productId: true },
        }),
      ]).then(([live, scheduled, draft, featured]) => ({
        key: 'produk',
        label: 'Produk',
        icon: 'package',
        value: live + scheduled + draft,
        dots: [
          { label: 'tayang', count: live, tone: 'success' as Tone, href: '/admin/produk?status=tayang' },
          ...(scheduled ? [{ label: 'terjadwal', count: scheduled, tone: 'info' as Tone, href: '/admin/produk?status=terjadwal' }] : []),
          { label: 'draft', count: draft, tone: 'plain' as Tone, href: '/admin/produk?status=draft' },
          { label: 'unggulan', count: featured.length, tone: 'warning' as Tone, href: '/admin/seksi', title: 'Dipilih manual di seksi beranda yang tampil' },
        ],
        viewHref: '/admin/produk',
        viewLabel: 'Lihat semua',
        ...(perms.produk.edit ? { newHref: '/admin/produk/baru', newLabel: 'Produk baru' } : {}),
      })),
    );
  }

  if (perms.kategori.view) {
    cards.push(
      prisma.category.groupBy({ by: ['isActive'], _count: { _all: true } }).then((rows) => {
        const active = rows.find((r) => r.isActive)?._count._all ?? 0;
        const inactive = rows.find((r) => !r.isActive)?._count._all ?? 0;
        return {
          key: 'kategori',
          label: 'Kategori',
          icon: 'tree-structure',
          value: active + inactive,
          dots: [
            { label: 'aktif', count: active, tone: 'success' as Tone, href: '/admin/kategori' },
            { label: 'nonaktif', count: inactive, tone: 'plain' as Tone, href: '/admin/kategori', title: 'Disembunyikan dari menu & filter store' },
          ],
          viewHref: '/admin/kategori',
          viewLabel: 'Lihat semua',
          ...(perms.kategori.edit ? { newHref: '/admin/kategori/baru', newLabel: 'Kategori baru' } : {}),
        };
      }),
    );
  }

  if (perms.promo.view) {
    cards.push(
      prisma.promoCode.findMany().then((promos) => {
        const labels = promos.map((p) => promoStatus(p, now).label);
        const valid = labels.filter((l) => l === 'Aktif').length;
        const scheduled = labels.filter((l) => l === 'Terjadwal').length;
        return {
          key: 'promo',
          label: 'Promo',
          icon: 'ticket',
          value: promos.length,
          dots: [
            { label: 'berlaku sekarang', count: valid, tone: 'success' as Tone, href: '/admin/promo' },
            ...(scheduled ? [{ label: 'terjadwal', count: scheduled, tone: 'info' as Tone, href: '/admin/promo' }] : []),
            { label: 'nonaktif / berakhir', count: promos.length - valid - scheduled, tone: 'plain' as Tone, href: '/admin/promo', title: 'Nonaktif, sudah berakhir, atau kuota habis' },
          ],
          viewHref: '/admin/promo',
          viewLabel: 'Lihat semua',
          ...(perms.promo.edit ? { newHref: '/admin/promo/baru', newLabel: 'Promo baru' } : {}),
        };
      }),
    );
  }

  if (perms.pesanan.view) {
    cards.push(
      Promise.all([
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.order.aggregate({ where: { paidAt: { not: null } }, _sum: { total: true } }),
        prisma.refund.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      ]).then(([rows, paid, refunded]) => {
        const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
        const revenue = (paid._sum.total ?? 0) - (refunded._sum.amount ?? 0);
        return {
          key: 'pesanan',
          label: 'Pesanan',
          icon: 'receipt',
          value: count('UNPAID', 'PROCESSING', 'READY_PICKUP', 'SHIPPED', 'COMPLETED', 'CANCELED', 'EXPIRED'),
          sub: `${formatRupiah(revenue)} pendapatan`,
          subTitle: 'Total pesanan yang sudah dibayar, dikurangi refund yang sudah dikirim',
          dots: [
            { label: 'belum dibayar', count: count('UNPAID'), tone: 'warning' as Tone, href: '/admin/pesanan?status=belum-bayar' },
            { label: 'dibayar', count: count('PROCESSING', 'READY_PICKUP', 'SHIPPED'), tone: 'info' as Tone, href: '/admin/pesanan', title: 'Sudah dibayar, sedang diproses / siap diambil / dikirim' },
            { label: 'selesai', count: count('COMPLETED'), tone: 'success' as Tone, href: '/admin/pesanan?status=selesai' },
            { label: 'batal', count: count('CANCELED', 'EXPIRED'), tone: 'plain' as Tone, href: '/admin/pesanan?status=batal', title: 'Dibatalkan atau kedaluwarsa' },
          ],
          viewHref: '/admin/pesanan?status=semua',
          viewLabel: 'Lihat semua pesanan',
        };
      }),
    );
  }

  return Promise.all(cards);
}

dashboardRouter.get(
  '/',
  handle(async (req, res) => {
    const admin = req.admin!;
    const perms = permissionMap(admin.roles);
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86400_000);

    const [cards, recentOrders, scheduled, lowStock, lowCount, promos, changes] = await Promise.all([
      summaryCards(perms, now),
      perms.pesanan.view
        ? prisma.order.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 5,
            select: { invoiceNo: true, status: true, fulfillment: true, total: true, buyerName: true, createdAt: true, _count: { select: { items: true } } },
          })
        : [],
      // Draft & terjadwal hanya untuk peran tanpa akses pesanan (Editor, Marketing)
      perms.produk.view && !perms.pesanan.view
        ? prisma.product.findMany({
            where: { OR: [{ status: 'DRAFT' }, { status: 'PUBLISHED', publishedAt: { gt: now } }] },
            orderBy: [{ updatedAt: 'desc' }],
            take: 5,
            select: { id: true, title: true, status: true, publishedAt: true, updatedAt: true },
          })
        : [],
      perms.stok.view ? lowStockItems(6) : [],
      perms.stok.view ? lowStockCount() : 0,
      perms.promo.view
        ? prisma.promoCode.findMany({
            where: { isActive: true, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            orderBy: [{ endsAt: 'asc' }, { code: 'asc' }],
            take: 6,
          })
        : [],
      prisma.auditLog.findMany({
        where: perms.pengguna.view ? { action: { notIn: ['login', 'logout'] } } : { adminUserId: admin.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    await res.renderAdmin('dashboard', {
      pageTitle: 'Dashboard',
      wideMain: true,
      active: 'dasbor',
      cards,
      recentOrders: recentOrders.map((o) => ({ ...o, status: statusBadge(o), fulfillment: fulfillmentInfo(o.fulfillment) })),
      scheduled: scheduled.map((p) => ({ ...p, isScheduled: p.status === 'PUBLISHED' })),
      lowStock,
      lowCount,
      promos: promos.map((p) => ({
        ...p,
        endingSoon: Boolean(p.endsAt && p.endsAt <= weekAhead),
        notStarted: Boolean(p.startsAt && p.startsAt > now),
        quotaLeft: p.quota === null ? null : Math.max(0, p.quota - p.usedCount),
      })),
      changes: changes.map((c) => ({
        ...c,
        actionLabel: ACTION_LABELS[c.action] ?? c.action,
        entityName: ENTITY_LABELS[c.entityType] ?? c.entityType,
      })),
      changesAll: perms.pengguna.view,
    });
  }),
);
