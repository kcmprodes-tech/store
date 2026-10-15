/** Dashboard CMS: satu halaman, widget mengikuti hak akses akun. */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { handle, q } from '../../http.js';
import { canDo, permissionMap } from '../../permissions.js';
import { fulfillmentInfo, statusBadge } from '../pesanan/pesanan.view.js';
import { lowStockCount, lowStockItems } from '../stok/stok.service.js';
import { PERIODS, salesBreakdown, salesChart, salesKpis, type PeriodKey } from './sales.js';

export const dashboardRouter = Router();

type Tone = 'success' | 'info' | 'warning' | 'error';
type BreakdownItem = { label: string; count: number; tone: Tone; href: string; title?: string };

type SummaryCard = {
  key: string;
  label: string;
  icon: string;
  value: number;
  viewHref: string;
  viewLabel: string;
  newHref?: string;
  newLabel?: string;
  /** Rincian status bertitik warna, dibuka lewat caret di sebelah angka (kartu Pesanan). */
  breakdown?: BreakdownItem[];
};

/** Rincian pesanan per status untuk popover di kartu Pesanan. */
async function orderBreakdown(): Promise<{ total: number; items: BreakdownItem[] }> {
  const rows = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  return {
    total: rows.reduce((n, r) => n + r._count._all, 0),
    items: [
      { label: 'Belum dibayar', count: count('UNPAID'), tone: 'warning', href: '/admin/pesanan?status=belum-bayar' },
      {
        label: 'Dibayar',
        count: count('PROCESSING', 'READY_PICKUP', 'SHIPPED'),
        tone: 'info',
        href: '/admin/pesanan?status=proses',
        title: 'Sudah dibayar: sedang diproses, siap diambil, atau dikirim',
      },
      { label: 'Selesai', count: count('COMPLETED'), tone: 'success', href: '/admin/pesanan?status=selesai' },
      { label: 'Batal', count: count('CANCELED', 'EXPIRED'), tone: 'error', href: '/admin/pesanan?status=batal', title: 'Dibatalkan atau kedaluwarsa' },
    ],
  };
}

/**
 * Kartu ringkasan per modul di atas dashboard (desain Figma "Store-kompascom" node 233:1131 / 252:4778):
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
  ];
  const cards: Promise<SummaryCard>[] = defs
    .filter((d) => d.show)
    .map(async ({ show: _show, count, ...d }) => ({ ...d, value: await count(), viewLabel: 'Lihat semua' }));
  if (perms.pesanan.view) {
    // Desain menampilkan "+" juga di kartu Pesanan, tetapi pesanan hanya dibuat dari checkout store — tanpa tombol tambah.
    cards.push(
      orderBreakdown().then(({ total, items }) => ({
        key: 'pesanan',
        label: 'Pesanan',
        icon: 'receipt',
        value: total,
        viewHref: '/admin/pesanan?status=semua',
        viewLabel: 'Lihat semua',
        breakdown: items,
      })),
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
    const showSales = canDo(admin.roles, 'sales.view');
    const period: PeriodKey = (q(req.query.periode) in PERIODS ? q(req.query.periode) : 'bulan') as PeriodKey;
    // Tab aktif: ?tab=penjualan (juga dipakai tautan periode penjualan); default ringkasan
    const salesTab = showSales && q(req.query.tab) === 'penjualan';

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
      perms.stok.view ? lowStockItems(5) : [],
      perms.stok.view ? lowStockCount() : 0,
      showSales ? salesKpis(now) : null,
      showSales ? salesChart(period, now) : null,
      showSales ? salesBreakdown(period, now) : null,
    ]);

    await res.renderAdmin('dashboard', {
      pageTitle: 'Dashboard',
      wideMain: true,
      greeting: true,
      active: 'dasbor',
      salesTab,
      overviewLabel: perms.pesanan.view ? 'Pesanan' : 'Ringkasan',
      cards,
      recentOrders: recentOrders.map((o) => ({ ...o, status: statusBadge(o), fulfillment: fulfillmentInfo(o.fulfillment) })),
      scheduled: scheduled.map((p) => ({ ...p, isScheduled: p.status === 'PUBLISHED' })),
      lowStock,
      lowCount,
      sales: showSales
        ? {
            kpis: kpis!.map((k) => ({ ...k, active: k.key === period, href: `/admin?tab=penjualan&periode=${k.key}` })),
            period,
            periodLabel: PERIODS[period].label,
            chart,
            breakdown,
          }
        : null,
    });
  }),
);
