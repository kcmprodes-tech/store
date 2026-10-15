/** Dashboard CMS: satu halaman, widget mengikuti hak akses akun. */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { handle, q } from '../../http.js';
import { canDo, permissionMap } from '../../permissions.js';
import { fulfillmentInfo, statusBadge } from '../pesanan/pesanan.view.js';
import { lowStockCount, lowStockItems } from '../stok/stok.service.js';
import { PERIODS, salesBreakdown, salesChart, salesKpis, type PeriodKey } from './sales.js';

export const dashboardRouter = Router();

type SummaryCard = {
  key: string;
  label: string;
  icon: string;
  value: number;
  viewHref: string;
  viewLabel: string;
  newHref?: string;
  newLabel?: string;
};

/**
 * Kartu ringkasan per modul di atas dashboard (desain Figma "Store-kompascom" node 252:4778):
 * label, angka total, ikon, lalu "Lihat semua ›" + tombol tambah. Mengikuti hak akses.
 */
async function summaryCards(perms: ReturnType<typeof permissionMap>): Promise<SummaryCard[]> {
  const defs: { key: string; show: boolean; label: string; icon: string; count: () => Promise<number>; viewHref: string; newHref?: string; newLabel?: string }[] = [
    {
      key: 'produk',
      show: perms.produk.view,
      label: 'Produk',
      icon: 'package',
      count: () => prisma.product.count({ where: { status: { not: 'ARCHIVED' } } }),
      viewHref: '/admin/produk',
      ...(perms.produk.edit ? { newHref: '/admin/produk/baru', newLabel: 'Produk baru' } : {}),
    },
    {
      key: 'kategori',
      show: perms.kategori.view,
      label: 'Kategori',
      icon: 'tree-structure',
      count: () => prisma.category.count(),
      viewHref: '/admin/kategori',
      ...(perms.kategori.edit ? { newHref: '/admin/kategori/baru', newLabel: 'Kategori baru' } : {}),
    },
    {
      key: 'promo',
      show: perms.promo.view,
      label: 'Promo',
      icon: 'ticket',
      count: () => prisma.promoCode.count(),
      viewHref: '/admin/promo',
      ...(perms.promo.edit ? { newHref: '/admin/promo/baru', newLabel: 'Promo baru' } : {}),
    },
    {
      key: 'pesanan',
      show: perms.pesanan.view,
      label: 'Pesanan',
      icon: 'receipt',
      count: () => prisma.order.count(),
      viewHref: '/admin/pesanan?status=semua',
    },
  ];
  return Promise.all(
    defs
      .filter((d) => d.show)
      .map(async ({ show: _show, count, ...d }) => ({ ...d, value: await count(), viewLabel: 'Lihat semua' })),
  );
}

dashboardRouter.get(
  '/',
  handle(async (req, res) => {
    const admin = req.admin!;
    const perms = permissionMap(admin.roles);
    const now = new Date();
    const showSales = canDo(admin.roles, 'sales.view');
    const period: PeriodKey = (q(req.query.periode) in PERIODS ? q(req.query.periode) : 'bulan') as PeriodKey;

    const [cards, recentOrders, scheduled, lowStock, lowCount, kpis, chart, breakdown] = await Promise.all([
      summaryCards(perms),
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
      showSales ? salesKpis(now) : null,
      showSales ? salesChart(period, now) : null,
      showSales ? salesBreakdown(period, now) : null,
    ]);

    await res.renderAdmin('dashboard', {
      pageTitle: 'Dashboard',
      wideMain: true,
      flatCards: true,
      active: 'dasbor',
      cards,
      recentOrders: recentOrders.map((o) => ({ ...o, status: statusBadge(o), fulfillment: fulfillmentInfo(o.fulfillment) })),
      scheduled: scheduled.map((p) => ({ ...p, isScheduled: p.status === 'PUBLISHED' })),
      lowStock,
      lowCount,
      sales: showSales
        ? {
            kpis: kpis!.map((k) => ({ ...k, active: k.key === period, href: `/admin?periode=${k.key}#penjualan` })),
            period,
            periodLabel: PERIODS[period].label,
            chart,
            breakdown,
          }
        : null,
    });
  }),
);
