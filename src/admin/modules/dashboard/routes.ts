/** Dasbor CMS: satu halaman, widget mengikuti hak akses akun. */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { ACTION_LABELS, ENTITY_LABELS } from '../../audit.js';
import { handle } from '../../http.js';
import { permissionMap } from '../../permissions.js';
import { lowStockCount, lowStockItems } from '../stok/stok.service.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  handle(async (req, res) => {
    const admin = req.admin!;
    const perms = permissionMap(admin.roles);
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86400_000);

    const [productStats, scheduled, lowStock, lowCount, promos, changes] = await Promise.all([
      perms.produk.view
        ? Promise.all([
            prisma.product.count({ where: { status: 'PUBLISHED', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] } }),
            prisma.product.count({ where: { status: 'DRAFT' } }),
            prisma.product.count({ where: { status: 'PUBLISHED', publishedAt: { gt: now } } }),
          ]).then(([live, draft, upcoming]) => ({ live, draft, upcoming }))
        : null,
      perms.produk.view
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
      pageTitle: 'Dasbor',
      active: 'dasbor',
      productStats,
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
