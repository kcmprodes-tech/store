/**
 * Job berkala CMS (dijadwalkan di server.ts; di tes dipanggil langsung dengan `now`).
 * Semua langkah aman diulang: transisi memeriksa status terbaru, notifikasi memakai dedupe.
 */
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { notify } from './notifications.js';
import {
  AUTO_COMPLETE_DAYS,
  completeOrder,
  expireOrder,
  inOrderTx,
  LATE_PROCESSING_DAYS,
  PICKUP_REMINDER_DAYS,
  SYSTEM,
} from './modules/pesanan/pesanan.service.js';

const DAY = 86400_000;

/** `scope` membatasi pesanan yang diproses (dipakai tes supaya tidak menyentuh pesanan contoh). */
export async function runJobs(now = new Date(), scope: Prisma.OrderWhereInput = {}) {
  const summary = { expired: 0, completed: 0, lateNotified: 0, pickupNotified: 0 };

  // UNPAID lewat batas bayar → EXPIRED (stok dilepas)
  const unpaid = await prisma.order.findMany({ where: { ...scope, status: 'UNPAID', paymentDueAt: { lt: now } }, select: { id: true } });
  for (const o of unpaid) {
    const r = await inOrderTx((tx) => expireOrder(tx, o.id, now));
    if (!r.already) summary.expired++;
  }

  // Dikirim lebih dari 7 hari → Selesai otomatis
  const shipped = await prisma.order.findMany({
    where: { ...scope, status: 'SHIPPED', shippedAt: { lt: new Date(now.getTime() - AUTO_COMPLETE_DAYS * DAY) } },
    select: { id: true },
  });
  for (const o of shipped) {
    const r = await inOrderTx((tx) => completeOrder(tx, o.id, SYSTEM, now, `Otomatis selesai ${AUTO_COMPLETE_DAYS} hari setelah dikirim`));
    if (!r.already) summary.completed++;
  }

  // Diproses lebih dari 2 hari → notifikasi (sekali per pesanan)
  const late = await prisma.order.findMany({
    where: { ...scope, status: 'PROCESSING', paidAt: { lt: new Date(now.getTime() - LATE_PROCESSING_DAYS * DAY) } },
    select: { invoiceNo: true, fulfillment: true },
  });
  for (const o of late) {
    summary.lateNotified += await notify(prisma, {
      type: 'order_late',
      title: `Terlambat diproses: ${o.invoiceNo}`,
      body: `Sudah lebih dari ${LATE_PROCESSING_DAYS} hari sejak dibayar.`,
      url: `/admin/pesanan/${o.invoiceNo}`,
      dedupeKey: `order_late:${o.invoiceNo}`,
    });
  }

  // Siap diambil lebih dari 2 hari → pengingat (sekali per pesanan)
  const waiting = await prisma.order.findMany({
    where: { ...scope, status: 'READY_PICKUP', readyAt: { lt: new Date(now.getTime() - PICKUP_REMINDER_DAYS * DAY) } },
    select: { invoiceNo: true },
  });
  for (const o of waiting) {
    summary.pickupNotified += await notify(prisma, {
      type: 'pickup_waiting',
      title: `Belum diambil: ${o.invoiceNo}`,
      body: `Siap diambil lebih dari ${PICKUP_REMINDER_DAYS} hari. Hubungi pembeli.`,
      url: `/admin/pesanan/${o.invoiceNo}`,
      dedupeKey: `pickup_waiting:${o.invoiceNo}`,
    });
  }

  // Bersihkan challenge passkey kedaluwarsa
  await prisma.adminAuthChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  return summary;
}

let timer: NodeJS.Timeout | null = null;

/** Jalankan job tiap `intervalMs` (default 10 menit). Dipanggil dari server.ts, bukan dari createApp(). */
export function scheduleJobs(intervalMs = 10 * 60_000) {
  const tick = () => {
    runJobs().catch((err) => console.error('[jobs]', err));
  };
  setTimeout(tick, 15_000);
  timer = setInterval(tick, intervalMs);
  timer.unref();
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
