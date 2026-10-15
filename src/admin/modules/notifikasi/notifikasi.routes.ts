/** Kotak masuk (lonceng di bar atas): notifikasi di aplikasi milik akun yang login. */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { handle, redirectWith } from '../../http.js';
import { NOTIFICATION_TYPES, type NotificationType } from '../../notifications.js';

export const notifikasiRouter = Router();

const LIMIT = 50;

notifikasiRouter.get(
  '/notifikasi',
  handle(async (req, res) => {
    const adminUserId = req.admin!.id;
    const items = await prisma.notification.findMany({
      where: { adminUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true },
    });
    await res.renderAdmin('notifikasi/index', {
      pageTitle: 'Kotak masuk',
      active: 'notifikasi',
      items: items.map((n) => ({
        ...n,
        typeLabel: NOTIFICATION_TYPES[n.type as NotificationType]?.label ?? 'Notifikasi',
        unread: !n.readAt,
      })),
      limit: LIMIT,
    });
  }),
);

// Membuka notifikasi: tandai dibaca lalu ke halaman tujuannya (hanya tujuan di dalam /admin)
notifikasiRouter.get(
  '/notifikasi/:id/buka',
  handle(async (req, res) => {
    const id = Number(req.params.id);
    const n = Number.isInteger(id) ? await prisma.notification.findFirst({ where: { id, adminUserId: req.admin!.id } }) : null;
    if (!n) return redirectWith(res, '/admin/notifikasi', 'error', 'Notifikasi tidak ditemukan.');
    if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    res.redirect(303, /^\/admin(\/|$)/.test(n.url) && !n.url.startsWith('//') ? n.url : '/admin/notifikasi');
  }),
);

notifikasiRouter.post(
  '/notifikasi/baca-semua',
  handle(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { adminUserId: req.admin!.id, readAt: null },
      data: { readAt: new Date() },
    });
    redirectWith(res, '/admin/notifikasi', 'success', count ? `${count} notifikasi ditandai sudah dibaca.` : 'Semua notifikasi sudah dibaca.');
  }),
);
