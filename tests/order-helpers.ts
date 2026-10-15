/**
 * Utilitas tes pesanan: produk DRAFT sementara (tidak tampil di store) + pembeli uji + pesanan lewat layanan sungguhan.
 * cleanupOrders() menghapus semuanya lagi, termasuk mutasi stok, notifikasi, dan file foto privat.
 */
import { rm } from 'node:fs/promises';
import { privatePath } from '../src/adapters/storage/local.js';
import { createOrder, inOrderTx, markPaid, SYSTEM, type CreateOrderInput } from '../src/admin/modules/pesanan/pesanan.service.js';
import { mainLocation, moveStock, movementEffect } from '../src/admin/modules/stok/stok.service.js';
import { prisma } from '../src/lib/prisma.js';
import type { Fulfillment, ProductType } from '../src/generated/prisma/client.js';

const created = { products: [] as number[], users: [] as number[] };
let seq = 0;
const tag = () => `uji-psn-${Date.now().toString(36)}-${++seq}`;

export async function createTestProduct(opts: { type?: ProductType; stock?: number; variants?: number } = {}) {
  const slug = tag();
  const type = opts.type ?? 'PHYSICAL';
  const product = await prisma.product.create({
    data: {
      slug,
      title: `Produk ${slug}`,
      type,
      status: 'DRAFT',
      variants: {
        create: Array.from({ length: opts.variants ?? 2 }, (_, i) => ({
          sku: `${slug}-${i}`.toUpperCase(),
          name: `Varian ${i + 1}`,
          price: 25000 * (i + 1),
          trackStock: type === 'PHYSICAL',
          lowStockThreshold: 0,
          sortOrder: i,
        })),
      },
    },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });
  created.products.push(product.id);
  const stock = opts.stock ?? 10;
  if (type === 'PHYSICAL' && stock > 0) {
    await prisma.$transaction(async (tx) => {
      const loc = await mainLocation(tx);
      for (const v of product.variants) {
        await moveStock(tx, { variantId: v.id, locationId: loc.id, type: 'IN', qty: stock, refType: 'uji', refId: slug, createdBy: 'tes' });
      }
    });
  }
  return product;
}

export async function createBuyer(phone = '081234565678') {
  const slug = tag();
  const user = await prisma.user.create({ data: { name: `Pembeli ${slug}`, email: `${slug}@uji.store.test`, phone } });
  created.users.push(user.id);
  return user;
}

type OrderOpts = {
  fulfillment?: Fulfillment;
  items: { variantId: number; qty: number }[];
  paid?: boolean;
  phone?: string;
  at?: Date;
};

/** Pesanan baru lewat createOrder (RESERVE), opsional langsung dibayar. */
export async function createTestOrder(opts: OrderOpts) {
  const buyer = await createBuyer(opts.phone);
  const fulfillment = opts.fulfillment ?? 'SHIPPING';
  const input: CreateOrderInput = {
    userId: buyer.id,
    fulfillment,
    items: opts.items,
    buyer: { name: buyer.name, phone: buyer.phone! },
    address: fulfillment === 'SHIPPING' ? { recipient: buyer.name, phone: buyer.phone, address: 'Jl. Uji No. 1', city: 'Jakarta Barat', province: 'DKI Jakarta', postalCode: '11480' } : null,
    paymentMethodCode: 'bca-va',
    shippingFee: fulfillment === 'SHIPPING' ? 10000 : 0,
    courier: fulfillment === 'SHIPPING' ? 'JNE' : null,
    at: opts.at,
  };
  const order = await inOrderTx((tx) => createOrder(tx, input));
  if (opts.paid) await inOrderTx((tx) => markPaid(tx, order.id, SYSTEM, opts.at));
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: 'asc' } } } });
}

/** Stok varian (gudang utama). */
export async function levelOf(variantId: number) {
  const lv = await prisma.inventoryLevel.findFirst({ where: { variantId } });
  return { onHand: lv?.onHand ?? 0, reserved: lv?.reserved ?? 0 };
}

/** Rekonsiliasi: fisik & dipesan harus sama dengan jumlah efek seluruh mutasi di buku besar. */
export async function ledgerOf(variantId: number) {
  const movements = await prisma.stockMovement.findMany({ where: { variantId } });
  return movements.reduce(
    (acc, m) => {
      const e = movementEffect(m.type, m.qtyDelta);
      return { onHand: acc.onHand + e.onHand, reserved: acc.reserved + e.reserved };
    },
    { onHand: 0, reserved: 0 },
  );
}

export async function cleanupOrders() {
  const orders = await prisma.order.findMany({ where: { userId: { in: created.users } }, select: { id: true, invoiceNo: true }, orderBy: { id: 'asc' } });
  const invoices = orders.map((o) => o.invoiceNo);
  const refunds = await prisma.refund.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { id: true } });
  const files = await prisma.orderAttachment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { path: true } });
  for (const f of files) await rm(privatePath(f.path), { force: true });
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { url: { in: invoices.map((i) => `/admin/pesanan/${i}`) } },
        { url: { in: refunds.map((r) => `/admin/refund/${r.id}`) } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: 'order', entityId: { in: invoices } }, { entityType: 'refund', entityId: { in: refunds.map((r) => String(r.id)) } }] } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  const variants = await prisma.productVariant.findMany({ where: { productId: { in: created.products } }, select: { id: true } });
  const ids = variants.map((v) => v.id);
  await prisma.notification.deleteMany({ where: { OR: ids.map((id) => ({ dedupeKey: { startsWith: `stock_low:${id}:` } })) } });
  await prisma.stockMovement.deleteMany({ where: { variantId: { in: ids } } });
  await prisma.inventoryLevel.deleteMany({ where: { variantId: { in: ids } } });
  await prisma.videoAccess.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.product.deleteMany({ where: { id: { in: created.products } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  created.products = [];
  created.users = [];
}
