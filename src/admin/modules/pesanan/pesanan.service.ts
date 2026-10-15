/**
 * Layanan pesanan (CMS & nanti checkout Tahap 3). Semua transisi berjalan di transaksi:
 * kunci baris pesanan (FOR UPDATE) → cek ulang status → gerakan stok per baris (urut variant_id) → riwayat + pelaku.
 *
 * Alur:
 * - Dikirim : PROCESSING → dikemas → resi → SHIPPED lewat serah terima kurir (hanya langkah ini menulis OUT)
 * - Ambil   : PROCESSING → READY_PICKUP (token QR dibuat) → COMPLETED saat diserahkan (OUT)
 * - Digital : dibayar → langsung COMPLETED (tanpa stok)
 * - Batal   : hanya sebelum SHIPPED (RELEASE); setelah dikirim → retur
 * Aksi yang diulang (dobel ketuk, job dua kali) mengembalikan { already: true }, bukan error.
 */
import { randomBytes } from 'node:crypto';
import { generateInvoiceNo } from '../../../lib/invoice.js';
import { prisma } from '../../../lib/prisma.js';
import type { Fulfillment, OrderStatus, Prisma } from '../../../generated/prisma/client.js';
import { HttpError } from '../../http.js';
import { notify } from '../../notifications.js';
import { mainLocation, moveStock } from '../stok/stok.service.js';

type Tx = Prisma.TransactionClient;
export type Actor = { email: string; id?: number | null };
export const SYSTEM: Actor = { email: 'sistem' };
export const BUYER: Actor = { email: 'pembeli' };

export const STATUS_LABELS: Record<OrderStatus, string> = {
  UNPAID: 'Belum dibayar',
  PROCESSING: 'Diproses',
  READY_PICKUP: 'Siap diambil',
  SHIPPED: 'Dikirim',
  COMPLETED: 'Selesai',
  CANCELED: 'Dibatalkan',
  EXPIRED: 'Kedaluwarsa',
};

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = { SHIPPING: 'Dikirim kurir', PICKUP: 'Ambil di tempat', DIGITAL: 'Digital' };

export const PAYMENT_DUE_HOURS = 24;
export const AUTO_COMPLETE_DAYS = 7;
export const LATE_PROCESSING_DAYS = 2;
export const PICKUP_REMINDER_DAYS = 2;
export const PICKUP_CANCEL_DAYS = 7;
export const REFUND_DAYS = 14;

const DAY = 86400_000;

export class OrderError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

const orderInclude = { items: { orderBy: { id: 'asc' } } } satisfies Prisma.OrderInclude;
type LockedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Kunci baris pesanan lalu baca ulang (status terbaru). */
async function lockOrder(tx: Tx, orderId: number): Promise<LockedOrder> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

async function addHistory(tx: Tx, orderId: number, status: OrderStatus, actor: Actor, note: string | null, at: Date) {
  await tx.orderStatusHistory.create({ data: { orderId, status, actor: actor.email, note, createdAt: at } });
}

/** Baris stok yang dilacak, urut variant_id (urutan kunci yang sama mencegah deadlock). */
const trackedLines = (order: LockedOrder) =>
  order.items.filter((i) => i.stockLocationId && i.variantId).sort((a, b) => a.variantId! - b.variantId!);

async function releaseLines(tx: Tx, order: LockedOrder, actor: Actor, at: Date) {
  for (const line of trackedLines(order)) {
    if (line.reservedQty <= 0) continue;
    await moveStock(tx, {
      variantId: line.variantId!,
      locationId: line.stockLocationId!,
      type: 'RELEASE',
      qty: line.reservedQty,
      refType: 'order',
      refId: order.invoiceNo,
      createdBy: actor.email,
      at,
    });
    await tx.orderItem.update({ where: { id: line.id }, data: { reservedQty: 0 } });
  }
}

async function shipLines(tx: Tx, order: LockedOrder, actor: Actor, at: Date) {
  for (const line of trackedLines(order)) {
    if (line.reservedQty <= 0) continue;
    await moveStock(tx, {
      variantId: line.variantId!,
      locationId: line.stockLocationId!,
      type: 'OUT',
      qty: line.reservedQty,
      refType: 'order',
      refId: order.invoiceNo,
      createdBy: actor.email,
      at,
    });
    await tx.orderItem.update({ where: { id: line.id }, data: { reservedQty: 0, shippedQty: { increment: line.reservedQty } } });
  }
}

const result = <T extends object>(order: T, already = false) => ({ order, already });

// ───────────── Membuat pesanan (dipakai seed contoh, tes, dan nanti checkout) ─────────────

export type CreateOrderInput = {
  userId: number;
  fulfillment: Fulfillment;
  items: { variantId: number; qty: number; note?: string | null }[];
  buyer: { name: string; phone: string };
  address?: Record<string, unknown> | null;
  paymentMethodCode: string;
  shippingFee?: number;
  courier?: string | null;
  at?: Date;
  /** Opsional (seed): no invoice yang sudah ditentukan. */
  invoiceNo?: string;
};

export async function createOrder(tx: Tx, input: CreateOrderInput) {
  const at = input.at ?? new Date();
  const variants = await tx.productVariant.findMany({
    where: { id: { in: input.items.map((i) => i.variantId) } },
    include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const warehouse = await mainLocation(tx);
  const pickupLocation = input.fulfillment === 'PICKUP' ? await tx.pickupLocation.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }) : null;
  const lines = input.items.map((i) => {
    const v = byId.get(i.variantId);
    if (!v) throw new HttpError(400, `SKU ${i.variantId} tidak ditemukan.`);
    const tracked = v.trackStock && input.fulfillment !== 'DIGITAL';
    return {
      variantId: v.id,
      productTitle: v.product.title,
      sku: v.sku,
      optionLabel: v.name,
      imageUrl: v.product.images[0]?.url ?? null,
      price: v.price,
      priceOriginal: v.priceOriginal,
      qty: i.qty,
      note: i.note ?? null,
      stockLocationId: tracked ? (pickupLocation?.stockLocationId ?? warehouse.id) : null,
      reservedQty: tracked ? i.qty : 0,
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const shippingFee = input.fulfillment === 'SHIPPING' ? (input.shippingFee ?? 0) : 0;
  let invoiceNo = input.invoiceNo ?? generateInvoiceNo(at);
  while (await tx.order.findUnique({ where: { invoiceNo }, select: { id: true } })) invoiceNo = generateInvoiceNo(at);
  const order = await tx.order.create({
    data: {
      invoiceNo,
      userId: input.userId,
      status: 'UNPAID',
      fulfillment: input.fulfillment,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      paymentMethodCode: input.paymentMethodCode,
      addressSnapshot: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
      courier: input.courier ?? null,
      pickupLocationId: pickupLocation?.id ?? null,
      paymentDueAt: new Date(at.getTime() + PAYMENT_DUE_HOURS * 3600_000),
      buyerName: input.buyer.name,
      buyerPhone: normalizePhone(input.buyer.phone),
      createdAt: at,
      items: { create: lines },
    },
    include: orderInclude,
  });
  for (const line of trackedLines(order)) {
    await moveStock(tx, {
      variantId: line.variantId!,
      locationId: line.stockLocationId!,
      type: 'RESERVE',
      qty: line.reservedQty,
      refType: 'order',
      refId: order.invoiceNo,
      createdBy: BUYER.email,
      at,
    });
  }
  await tx.payment.create({ data: { orderId: order.id, provider: 'xendit', methodCode: input.paymentMethodCode, amount: order.total, status: 'PENDING', createdAt: at } });
  await addHistory(tx, order.id, 'UNPAID', BUYER, null, at);
  return order;
}

// ───────────── Pembayaran ─────────────

/** Pembayaran diterima (Tahap 3: webhook Xendit; sekarang "simulasi" di CMS development). */
export async function markPaid(tx: Tx, orderId: number, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.status !== 'UNPAID') {
    if (order.paidAt) return result(order, true);
    throw new OrderError(`Pesanan ${STATUS_LABELS[order.status].toLowerCase()} tidak bisa dibayar.`);
  }
  if (order.paymentDueAt && order.paymentDueAt < at) throw new OrderError('Batas bayar sudah lewat.');
  const digital = order.fulfillment === 'DIGITAL';
  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: digital ? 'COMPLETED' : 'PROCESSING', paidAt: at, ...(digital ? { completedAt: at } : {}) },
  });
  await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: at } });
  await addHistory(tx, order.id, 'PROCESSING', actor, 'Pembayaran diterima', at);
  if (digital) {
    for (const line of order.items) {
      if (!line.variantId) continue;
      const v = await tx.productVariant.findUnique({ where: { id: line.variantId }, select: { productId: true, product: { select: { type: true } } } });
      if (v?.product.type === 'DIGITAL_VIDEO') {
        await tx.videoAccess.upsert({
          where: { userId_productId: { userId: order.userId, productId: v.productId } },
          create: { userId: order.userId, productId: v.productId, orderId: order.id, grantedAt: at },
          update: {},
        });
      }
    }
    await addHistory(tx, order.id, 'COMPLETED', SYSTEM, 'Produk digital langsung aktif', at);
  } else {
    await notify(tx, {
      type: 'order_paid',
      title: `Pesanan dibayar: ${order.invoiceNo}`,
      body: `${FULFILLMENT_LABELS[order.fulfillment]} · ${order.items.length} item`,
      url: `/admin/pesanan/${order.invoiceNo}`,
      dedupeKey: `order_paid:${order.invoiceNo}`,
    });
  }
  return result(updated);
}

// ───────────── Ambil di tempat ─────────────

export async function markReadyPickup(tx: Tx, orderId: number, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.fulfillment !== 'PICKUP') throw new OrderError('Bukan pesanan ambil di tempat.');
  if (order.status === 'READY_PICKUP') return result(order, true);
  if (order.status !== 'PROCESSING') throw new OrderError(`Pesanan ${STATUS_LABELS[order.status].toLowerCase()}.`);
  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: 'READY_PICKUP', readyAt: at, pickupToken: order.pickupToken ?? randomBytes(18).toString('base64url') },
  });
  await addHistory(tx, order.id, 'READY_PICKUP', actor, 'Pesanan siap diambil', at);
  return result(updated);
}

export async function handoverPickup(tx: Tx, orderId: number, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.fulfillment !== 'PICKUP') throw new OrderError('Bukan pesanan ambil di tempat.');
  if (order.status === 'COMPLETED' && order.pickedUpAt) return result(order, true);
  if (order.status !== 'READY_PICKUP') throw new OrderError(order.status === 'PROCESSING' ? 'Pesanan belum ditandai siap diambil.' : `Pesanan ${STATUS_LABELS[order.status].toLowerCase()}.`);
  await shipLines(tx, order, actor, at);
  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: 'COMPLETED', pickedUpAt: at, pickedUpBy: actor.email, completedAt: at },
  });
  await addHistory(tx, order.id, 'COMPLETED', actor, 'Diserahkan ke pembeli di lokasi pengambilan', at);
  return result(updated);
}

// ───────────── Kemas & kirim ─────────────

function assertShippingOpen(order: LockedOrder) {
  if (order.fulfillment !== 'SHIPPING') throw new OrderError('Bukan pesanan yang dikirim kurir.');
  if (order.status !== 'PROCESSING') throw new OrderError(`Pesanan ${STATUS_LABELS[order.status].toLowerCase()}.`);
}

/** Centang daftar kemas: jumlah item yang sudah masuk paket (0..qty). */
export async function setPackedQty(tx: Tx, orderId: number, itemId: number, packedQty: number) {
  const order = await lockOrder(tx, orderId);
  assertShippingOpen(order);
  const line = order.items.find((i) => i.id === itemId);
  if (!line) throw new HttpError(404, 'Item tidak ditemukan.');
  const qty = Math.max(0, Math.min(line.qty, packedQty));
  await tx.orderItem.update({ where: { id: line.id }, data: { packedQty: qty } });
  return { qty, max: line.qty };
}

export async function markPacked(tx: Tx, orderId: number, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.packedAt) return result(order, true);
  assertShippingOpen(order);
  const missing = order.items.filter((i) => i.packedQty < i.qty);
  if (missing.length) throw new OrderError(`Belum semua item dicentang (${missing.map((i) => i.sku).join(', ')}).`);
  const updated = await tx.order.update({ where: { id: order.id }, data: { packedAt: at, packedBy: actor.email } });
  await addHistory(tx, order.id, 'PROCESSING', actor, 'Selesai dikemas', at);
  return result(updated);
}

export async function setTracking(tx: Tx, orderId: number, input: { courier: string; trackingNo: string }, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  assertShippingOpen(order);
  if (!order.packedAt) throw new OrderError('Kemas pesanan dulu sebelum mengisi resi.');
  const trackingNo = input.trackingNo.trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(trackingNo)) throw new HttpError(400, 'No resi 6–40 karakter (huruf, angka, -).');
  const dup = await tx.order.findFirst({ where: { trackingNo, id: { not: order.id } }, select: { invoiceNo: true } });
  if (dup) throw new OrderError(`No resi sudah dipakai pesanan ${dup.invoiceNo}.`);
  const updated = await tx.order.update({ where: { id: order.id }, data: { trackingNo, courier: input.courier.trim().slice(0, 120) || order.courier } });
  if (order.trackingNo !== trackingNo) await addHistory(tx, order.id, 'PROCESSING', actor, `Resi ${trackingNo}`, at);
  return result(updated);
}

/** Serah terima ke kurir: satu-satunya jalan menuju Dikirim (stok keluar di sini). */
export async function handoverCourier(tx: Tx, orderId: number, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.status === 'SHIPPED' || (order.status === 'COMPLETED' && order.shippedAt)) return result(order, true);
  assertShippingOpen(order);
  if (!order.packedAt) throw new OrderError('Pesanan belum dikemas.');
  if (!order.trackingNo) throw new OrderError('No resi belum diisi.');
  await shipLines(tx, order, actor, at);
  const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'SHIPPED', shippedAt: at, shippedBy: actor.email } });
  await addHistory(tx, order.id, 'SHIPPED', actor, `Diserahkan ke kurir ${order.courier ?? ''} · resi ${order.trackingNo}`.trim(), at);
  return result(updated);
}

export async function completeOrder(tx: Tx, orderId: number, actor: Actor, at = new Date(), note = 'Pesanan diterima pembeli') {
  const order = await lockOrder(tx, orderId);
  if (order.status === 'COMPLETED') return result(order, true);
  if (order.status !== 'SHIPPED') throw new OrderError(`Pesanan ${STATUS_LABELS[order.status].toLowerCase()} belum bisa diselesaikan.`);
  const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: at } });
  await addHistory(tx, order.id, 'COMPLETED', actor, note, at);
  return result(updated);
}

// ───────────── Batal & kedaluwarsa ─────────────

export async function cancelOrder(tx: Tx, orderId: number, reason: string, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.status === 'CANCELED') return { ...result(order, true), refund: null };
  if (!['UNPAID', 'PROCESSING', 'READY_PICKUP'].includes(order.status)) {
    throw new OrderError(order.status === 'SHIPPED' || order.status === 'COMPLETED' ? 'Pesanan sudah dikirim/selesai — gunakan retur & refund.' : `Pesanan ${STATUS_LABELS[order.status].toLowerCase()}.`);
  }
  await releaseLines(tx, order, actor, at);
  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: 'CANCELED', canceledAt: at, cancelReason: reason.slice(0, 255), packedAt: null, packedBy: null, pickupToken: null },
  });
  await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { packedQty: 0 } });
  await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
  await addHistory(tx, order.id, 'CANCELED', actor, reason, at);
  // Sudah dibayar → dana harus dikembalikan: refund diajukan otomatis atas nama pembatal.
  let refund = null;
  if (order.paidAt) refund = await requestRefund(tx, order.id, { amount: order.total, reason: `Pesanan dibatalkan: ${reason}` }, actor, at);
  return { ...result(updated), refund };
}

/** Job: UNPAID lewat batas bayar → EXPIRED. Aman dijalankan berulang. */
export async function expireOrder(tx: Tx, orderId: number, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (order.status !== 'UNPAID' || !order.paymentDueAt || order.paymentDueAt > at) return result(order, true);
  await releaseLines(tx, order, SYSTEM, at);
  const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'EXPIRED', canceledAt: at } });
  await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  await addHistory(tx, order.id, 'EXPIRED', SYSTEM, `Tidak dibayar dalam ${PAYMENT_DUE_HOURS} jam`, at);
  return result(updated);
}

// ───────────── Refund ─────────────

export async function requestRefund(tx: Tx, orderId: number, input: { amount: number; reason: string }, actor: Actor, at = new Date()) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { refunds: true } });
  if (!order.paidAt) throw new OrderError('Pesanan belum dibayar, tidak ada dana untuk dikembalikan.');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new HttpError(400, 'Jumlah refund tidak valid.');
  const used = order.refunds.filter((r) => r.status !== 'REJECTED').reduce((n, r) => n + r.amount, 0);
  if (used + input.amount > order.total) throw new OrderError(`Total refund melebihi total pesanan (sisa ${order.total - used}).`);
  const refund = await tx.refund.create({
    data: {
      orderId: order.id,
      amount: input.amount,
      reason: input.reason.slice(0, 500),
      requestedBy: actor.email,
      requestedById: actor.id ?? null,
      requestedAt: at,
      dueAt: new Date(at.getTime() + REFUND_DAYS * DAY),
    },
  });
  await notify(tx, {
    type: 'refund_requested',
    title: `Refund diajukan: ${order.invoiceNo}`,
    body: `Rp ${refund.amount.toLocaleString('id-ID')} — ${refund.reason}`.slice(0, 500),
    url: `/admin/refund/${refund.id}`,
    dedupeKey: `refund_requested:${refund.id}`,
  });
  return refund;
}

export async function decideRefund(tx: Tx, refundId: number, approve: boolean, note: string | null, actor: Actor, at = new Date()) {
  await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId} FOR UPDATE`;
  const refund = await tx.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new HttpError(404, 'Refund tidak ditemukan.');
  const target = approve ? 'APPROVED' : 'REJECTED';
  if (refund.status === target) return { refund, already: true };
  if (refund.status !== 'REQUESTED') throw new OrderError('Refund ini sudah diputuskan.');
  if ((actor.id && refund.requestedById === actor.id) || refund.requestedBy === actor.email) {
    throw new HttpError(403, 'Refund harus disetujui orang lain, bukan yang mengajukan.');
  }
  const updated = await tx.refund.update({
    where: { id: refund.id },
    data: { status: target, decidedBy: actor.email, decidedById: actor.id ?? null, decidedAt: at, decisionNote: note?.slice(0, 500) ?? null },
  });
  return { refund: updated, already: false };
}

/** Dana sudah dikembalikan (manual sampai Xendit). Produk digital: akses video dicabut. */
export async function completeRefund(tx: Tx, refundId: number, actor: Actor, at = new Date()) {
  const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { order: { include: { refunds: true } } } });
  if (!refund) throw new HttpError(404, 'Refund tidak ditemukan.');
  if (refund.status === 'COMPLETED') return { refund, already: true };
  if (refund.status !== 'APPROVED') throw new OrderError('Refund belum disetujui.');
  const updated = await tx.refund.update({ where: { id: refund.id }, data: { status: 'COMPLETED', completedBy: actor.email, completedAt: at } });
  const refunded = refund.order.refunds.filter((r) => r.status === 'COMPLETED' || r.id === refund.id).reduce((n, r) => n + r.amount, 0);
  if (refunded >= refund.order.total) {
    await tx.payment.updateMany({ where: { orderId: refund.orderId, status: 'PAID' }, data: { status: 'REFUNDED' } });
    if (refund.order.fulfillment === 'DIGITAL') await tx.videoAccess.deleteMany({ where: { orderId: refund.orderId } });
  }
  return { refund: updated, already: false };
}

// ───────────── Retur ─────────────

export type ReturnLine = { orderItemId: number; receivedQty: number; restockQty: number };

export async function receiveReturn(tx: Tx, orderId: number, lines: ReturnLine[], note: string | null, actor: Actor, at = new Date()) {
  const order = await lockOrder(tx, orderId);
  if (!['SHIPPED', 'COMPLETED'].includes(order.status) || !order.items.some((i) => i.shippedQty > 0)) {
    throw new OrderError('Retur hanya untuk pesanan yang barangnya sudah keluar gudang.');
  }
  const valid = lines.filter((l) => l.receivedQty > 0);
  if (!valid.length) throw new HttpError(400, 'Isi jumlah barang yang diterima.');
  for (const l of valid) {
    const item = order.items.find((i) => i.id === l.orderItemId);
    if (!item) throw new HttpError(400, 'Item retur tidak ditemukan di pesanan ini.');
    if (l.receivedQty > item.shippedQty - item.returnedQty) throw new OrderError(`Retur ${item.sku} melebihi jumlah yang dikirim.`);
    if (l.restockQty < 0 || l.restockQty > l.receivedQty) throw new HttpError(400, `Jumlah masuk stok ${item.sku} tidak valid.`);
  }
  for (const l of [...valid].sort((a, b) => a.orderItemId - b.orderItemId)) {
    const item = order.items.find((i) => i.id === l.orderItemId)!;
    if (l.restockQty > 0 && item.variantId && item.stockLocationId) {
      await moveStock(tx, {
        variantId: item.variantId,
        locationId: item.stockLocationId,
        type: 'RETURN',
        qty: l.restockQty,
        refType: 'order',
        refId: order.invoiceNo,
        note: note ?? 'Retur pembeli',
        createdBy: actor.email,
        at,
      });
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { returnedQty: { increment: l.receivedQty } } });
  }
  const created = await tx.orderReturn.create({
    data: { orderId: order.id, items: valid as unknown as Prisma.InputJsonValue, note, createdBy: actor.email, createdAt: at },
  });
  const summary = valid.map((l) => `${order.items.find((i) => i.id === l.orderItemId)!.sku} ×${l.receivedQty} (${l.restockQty} masuk stok)`).join(', ');
  await addHistory(tx, order.id, order.status, actor, `Retur diterima: ${summary}`, at);
  return created;
}

// ───────────── Utilitas ─────────────

/** No HP → 62… (untuk WhatsApp & pencocokan 4 digit). */
export function normalizePhone(phone: string | null | undefined) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('0') ? `62${d.slice(1)}` : d.startsWith('62') ? d : d.startsWith('8') ? `62${d}` : d;
}

/** Jalankan transisi dalam transaksi, ulangi bila deadlock/konflik. */
export async function inOrderTx<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15_000 });
    } catch (err) {
      const msg = String((err as Error)?.message ?? '');
      const retry = /deadlock|P2034|Lock wait timeout|1213/i.test(msg) || (err as { code?: string })?.code === 'P2034';
      if (!retry || i >= attempts) throw err;
    }
  }
}

/** Hari sejak `from` (untuk badge "terlambat"). */
export function daysSince(from: Date | null | undefined, now = new Date()) {
  return from ? Math.floor((now.getTime() - from.getTime()) / DAY) : 0;
}

