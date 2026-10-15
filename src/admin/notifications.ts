/**
 * Notifikasi CMS. Ditulis sebagai notifikasi di aplikasi (lonceng) di dalam transaksi kejadiannya;
 * Web Push dikirim terpisah setelah commit (lihat push.ts). Dedupe lewat indeks unik (admin_user_id, dedupe_key).
 */
import type { AdminRole, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';

export const NOTIFICATION_TYPES = {
  order_paid: { label: 'Pesanan dibayar', desc: 'Pesanan baru siap diproses', roles: ['ADMIN', 'CS', 'GUDANG'] },
  order_late: { label: 'Pesanan terlambat diproses', desc: 'Diproses lebih dari 2 hari', roles: ['ADMIN', 'CS', 'GUDANG'] },
  pickup_waiting: { label: 'Pesanan belum diambil', desc: 'Siap diambil lebih dari 2 hari', roles: ['ADMIN', 'CS', 'GUDANG'] },
  refund_requested: { label: 'Permintaan refund', desc: 'Menunggu persetujuan', roles: ['ADMIN', 'FINANCE'] },
  stock_low: { label: 'Stok menipis', desc: 'SKU melewati ambang stok', roles: ['ADMIN', 'GUDANG'] },
} as const satisfies Record<string, { label: string; desc: string; roles: AdminRole[] }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type NotificationPrefs = {
  types: Partial<Record<NotificationType, boolean>>;
  /** Jam tenang WIB "HH:MM"; push tidak dikirim di rentang ini (notifikasi tetap masuk ke lonceng). */
  quietStart: string | null;
  quietEnd: string | null;
};

export function parsePrefs(value: unknown): NotificationPrefs {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const types = (v.types && typeof v.types === 'object' ? v.types : {}) as Record<string, unknown>;
  const time = (t: unknown) => (typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);
  return {
    types: Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, types[k] !== false])) as NotificationPrefs['types'],
    quietStart: time(v.quietStart),
    quietEnd: time(v.quietEnd),
  };
}

/** Apakah `at` (Date) ada di jam tenang WIB. Rentang boleh melewati tengah malam (mis. 21:00–07:00). */
export function inQuietHours(prefs: NotificationPrefs, at = new Date()) {
  if (!prefs.quietStart || !prefs.quietEnd || prefs.quietStart === prefs.quietEnd) return false;
  const wib = new Date(at.getTime() + 7 * 3600_000);
  const minutes = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = toMin(prefs.quietStart);
  const end = toMin(prefs.quietEnd);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  /** Kunci kejadian, mis. "order_late:SKC-…" — notifikasi yang sama tidak dibuat dua kali per orang. */
  dedupeKey: string;
};

type Db = Prisma.TransactionClient | typeof prisma;

/** Buat notifikasi di aplikasi untuk semua akun aktif yang perannya cocok & tidak mematikan jenis ini. */
export async function notify(db: Db, input: NotifyInput) {
  const roles = NOTIFICATION_TYPES[input.type].roles as readonly AdminRole[];
  const users = await db.adminUser.findMany({
    where: { isActive: true, roles: { some: { role: { in: [...roles] } } } },
    select: { id: true, notificationPrefs: true },
  });
  const recipients = users.filter((u) => parsePrefs(u.notificationPrefs).types[input.type] !== false);
  if (!recipients.length) return 0;
  const result = await db.notification.createMany({
    data: recipients.map((u) => ({
      adminUserId: u.id,
      type: input.type,
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 500),
      url: input.url.slice(0, 255),
      dedupeKey: input.dedupeKey.slice(0, 120),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export function unreadCount(adminUserId: number) {
  return prisma.notification.count({ where: { adminUserId, readAt: null } });
}
