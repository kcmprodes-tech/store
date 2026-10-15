/**
 * Pesanan contoh untuk mencoba CMS (pesanan, kemas, ambil di tempat, serah terima, refund) sebelum Tahap 3.
 * - Pembeli contoh: *@contoh.store.test. Pesanan hanya terlihat di CMS (halaman "Pesanan saya" store belum dari DB).
 * - Hanya memakai SKU yang tidak dipakai tes otomatis (SAMPLE_SKUS).
 * - Angka "tersedia" di store tidak berubah: stok fisik ditambah sebesar barang yang dipesan/dikirim
 *   (gerakan IN refType "contoh"), jadi reservasi & barang keluar tidak mengurangi stok yang tampil.
 * Dijalankan oleh seed.ts, atau sendiri: `npm run db:seed-orders` (menghapus pesanan contoh lama lewat gerakan kebalikan).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cancelOrder,
  completeOrder,
  createOrder,
  handoverCourier,
  handoverPickup,
  markPacked,
  markPaid,
  markReadyPickup,
  requestRefund,
  setPackedQty,
  setTracking,
  type Actor,
} from '../src/admin/modules/pesanan/pesanan.service.js';
import { mainLocation, moveStock, movementEffect } from '../src/admin/modules/stok/stok.service.js';
import { generateInvoiceNo } from '../src/lib/invoice.js';
import { createPrisma, prisma as appPrisma } from '../src/lib/prisma.js';
import type { Fulfillment } from '../src/generated/prisma/client.js';

type Db = ReturnType<typeof createPrisma>;

export const SAMPLE_DOMAIN = 'contoh.store.test';

/** SKU yang boleh dipakai pesanan contoh (tidak dipakai tes). Jaket dipilih otomatis dari STORE-APP-1006-*. */
export const SAMPLE_SKUS = ['STORE-MER-2000', 'STORE-MER-2001', 'STORE-MER-2002', 'STORE-MER-2003', 'STORE-BUK-2012', 'STORE-BUK-2014', 'STORE-BUK-2025', 'STORE-DIG-2006'];

const BUYERS = {
  sari: { name: 'Sari Wulandari', email: `sari@${SAMPLE_DOMAIN}`, phone: '081200000101' },
  budi: { name: 'Budi Santoso', email: `budi@${SAMPLE_DOMAIN}`, phone: '081200000202' },
  dewi: { name: 'Dewi Lestari', email: `dewi@${SAMPLE_DOMAIN}`, phone: '081200000303' },
};
type BuyerKey = keyof typeof BUYERS;

const address = (b: (typeof BUYERS)[BuyerKey]) => ({
  label: 'Rumah',
  recipient: b.name,
  phone: b.phone,
  province: 'DKI Jakarta',
  city: 'Jakarta Selatan',
  district: 'Kebayoran Baru',
  address: 'Jl. Contoh Raya No. 12, RT 01/RW 02',
  postalCode: '12110',
});

type Step =
  | ['pay', number]
  | ['ready', number]
  | ['pack', number]
  | ['track', number, string]
  | ['ship', number]
  | ['pickup', number]
  | ['complete', number]
  | ['cancel', number, string]
  | ['refund', number, number, string];

type Sample = { buyer: BuyerKey; fulfillment: Fulfillment; items: [string, number][]; method: string; createdHoursAgo: number; steps: Step[] };

/** Jam-yang-lalu relatif ke waktu seed. */
const SAMPLES: Sample[] = [
  { buyer: 'sari', fulfillment: 'SHIPPING', items: [['STORE-MER-2001', 1]], method: 'bca-va', createdHoursAgo: 3, steps: [] },
  { buyer: 'budi', fulfillment: 'SHIPPING', items: [['STORE-BUK-2014', 1]], method: 'qris', createdHoursAgo: 30, steps: [] }, // kedaluwarsa saat job jalan
  { buyer: 'dewi', fulfillment: 'SHIPPING', items: [['STORE-MER-2000', 1], ['STORE-BUK-2025', 1]], method: 'gopay', createdHoursAgo: 6, steps: [['pay', 5]] },
  { buyer: 'budi', fulfillment: 'SHIPPING', items: [['JAKET', 1]], method: 'ovo', createdHoursAgo: 75, steps: [['pay', 74]] }, // terlambat > 2 hari
  { buyer: 'sari', fulfillment: 'SHIPPING', items: [['STORE-MER-2002', 2]], method: 'cc', createdHoursAgo: 26, steps: [['pay', 25], ['pack', 4], ['track', 3, '011284230001234']] },
  { buyer: 'dewi', fulfillment: 'SHIPPING', items: [['STORE-MER-2003', 1]], method: 'dana', createdHoursAgo: 20, steps: [['pay', 19], ['pack', 2]] },
  { buyer: 'budi', fulfillment: 'PICKUP', items: [['STORE-BUK-2012', 1]], method: 'gopay', createdHoursAgo: 3, steps: [['pay', 2]] },
  { buyer: 'sari', fulfillment: 'PICKUP', items: [['STORE-MER-2001', 1]], method: 'qris', createdHoursAgo: 28, steps: [['pay', 27], ['ready', 24]] },
  { buyer: 'dewi', fulfillment: 'PICKUP', items: [['STORE-BUK-2014', 1]], method: 'cc', createdHoursAgo: 80, steps: [['pay', 79], ['ready', 76]] }, // belum diambil > 2 hari
  { buyer: 'budi', fulfillment: 'SHIPPING', items: [['STORE-MER-2000', 1]], method: 'shopeepay', createdHoursAgo: 60, steps: [['pay', 59], ['pack', 50], ['track', 49, '011284230005678'], ['ship', 48]] },
  { buyer: 'sari', fulfillment: 'SHIPPING', items: [['STORE-BUK-2025', 2]], method: 'gopay', createdHoursAgo: 220, steps: [['pay', 219], ['pack', 200], ['track', 199, '011284230009012'], ['ship', 196]] }, // otomatis selesai saat job jalan
  { buyer: 'dewi', fulfillment: 'SHIPPING', items: [['STORE-MER-2002', 1]], method: 'ovo', createdHoursAgo: 260, steps: [['pay', 259], ['pack', 245], ['track', 244, '011284230003456'], ['ship', 240], ['complete', 72]] },
  { buyer: 'budi', fulfillment: 'DIGITAL', items: [['STORE-DIG-2006', 1]], method: 'gopay', createdHoursAgo: 121, steps: [['pay', 120]] },
  { buyer: 'sari', fulfillment: 'SHIPPING', items: [['STORE-MER-2003', 1]], method: 'bca-va', createdHoursAgo: 50, steps: [['cancel', 48, 'Pembeli berubah pikiran']] },
  {
    buyer: 'dewi',
    fulfillment: 'SHIPPING',
    items: [['STORE-MER-2001', 1]],
    method: 'cc',
    createdHoursAgo: 170,
    steps: [['pay', 169], ['pack', 160], ['track', 159, '011284230007890'], ['ship', 150], ['complete', 100], ['refund', 24, 50000, 'Tutup tumbler retak saat diterima (foto dari pembeli via WhatsApp).']],
  },
];

async function actor(prisma: Db, email: string): Promise<Actor> {
  const user = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
  return { email, id: user?.id ?? null };
}

/** Hapus pesanan contoh: gerakan stoknya dibalik lalu dihapus, kemudian pesanannya. */
export async function clearSampleOrders(prisma: Db) {
  const orders = await prisma.order.findMany({ where: { user: { email: { endsWith: `@${SAMPLE_DOMAIN}` } } }, select: { id: true, invoiceNo: true } });
  if (!orders.length) return 0;
  const invoices = orders.map((o) => o.invoiceNo);
  await prisma.$transaction(async (tx) => {
    const movements = await tx.stockMovement.findMany({ where: { refId: { in: invoices }, refType: { in: ['order', 'contoh'] } } });
    for (const m of movements) {
      const e = movementEffect(m.type, m.qtyDelta);
      await tx.inventoryLevel.update({
        where: { variantId_locationId: { variantId: m.variantId, locationId: m.locationId } },
        data: { onHand: { decrement: e.onHand }, reserved: { decrement: e.reserved } },
      });
    }
    await tx.stockMovement.deleteMany({ where: { id: { in: movements.map((m) => m.id) } } });
    const refunds = await tx.refund.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { id: true } });
    await tx.notification.deleteMany({
      where: { OR: [...invoices.map((i) => ({ dedupeKey: { contains: i } })), ...refunds.map((r) => ({ dedupeKey: `refund_requested:${r.id}` }))] },
    });
    await tx.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  });
  return orders.length;
}

export async function seedSampleOrders(prisma: Db, now = new Date()) {
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
  const gudang = await actor(prisma, 'gudang@cms.test');
  const cs = await actor(prisma, 'cs@cms.test');
  const warehouse = await mainLocation(prisma);

  const users = Object.fromEntries(
    await Promise.all(
      (Object.keys(BUYERS) as BuyerKey[]).map(async (k) => {
        const b = BUYERS[k];
        const u = await prisma.user.upsert({ where: { email: b.email }, create: { name: b.name, email: b.email, phone: b.phone }, update: {} });
        return [k, u.id] as const;
      }),
    ),
  ) as Record<BuyerKey, number>;

  const jaket = await prisma.productVariant.findFirst({
    where: { sku: { startsWith: 'STORE-APP-1006-' }, isActive: true },
    orderBy: { inventory: { _count: 'desc' } },
    select: { sku: true },
  });
  const skuMap = new Map((await prisma.productVariant.findMany({ where: { sku: { in: [...SAMPLE_SKUS, jaket?.sku ?? ''] } }, select: { id: true, sku: true, trackStock: true } })).map((v) => [v.sku, v]));

  let count = 0;
  for (const s of SAMPLES) {
    const items = s.items
      .map(([sku, qty]) => ({ variant: skuMap.get(sku === 'JAKET' ? (jaket?.sku ?? '') : sku), qty }))
      .filter((i): i is { variant: { id: number; sku: string; trackStock: boolean }; qty: number } => Boolean(i.variant));
    if (!items.length) continue;
    const created = ago(s.createdHoursAgo);
    const leavesStock = s.steps.some(([step]) => step === 'ship' || step === 'pickup');
    const keepsReservation = !s.steps.some(([step]) => step === 'cancel') && !leavesStock;
    const buyer = BUYERS[s.buyer];
    const invoiceNo = generateInvoiceNo(created);

    await prisma.$transaction(
      async (tx) => {
        // Stok tambahan supaya angka "tersedia" di store tetap sama (pesanan contoh tidak mengurangi stok yang tampil).
        if (s.fulfillment !== 'DIGITAL' && (keepsReservation || leavesStock)) {
          for (const i of [...items].sort((a, b) => a.variant.id - b.variant.id)) {
            if (!i.variant.trackStock) continue;
            await moveStock(tx, {
              variantId: i.variant.id,
              locationId: warehouse.id,
              type: 'IN',
              qty: i.qty,
              refType: 'contoh',
              refId: invoiceNo,
              note: 'Stok tambahan pesanan contoh (seed)',
              createdBy: 'seed',
              at: created,
            });
          }
        }
        const order = await createOrder(tx, {
          invoiceNo,
          userId: users[s.buyer],
          fulfillment: s.fulfillment,
          items: items.map((i) => ({ variantId: i.variant.id, qty: i.qty })),
          buyer: { name: buyer.name, phone: buyer.phone },
          address: s.fulfillment === 'SHIPPING' ? address(buyer) : null,
          paymentMethodCode: s.method,
          shippingFee: 12000,
          courier: s.fulfillment === 'SHIPPING' ? 'JNE Premium' : null,
          at: created,
        });
        for (const step of s.steps) {
          const at = ago(step[1]);
          switch (step[0]) {
            case 'pay':
              await markPaid(tx, order.id, { email: 'xendit (simulasi)' }, at);
              break;
            case 'ready':
              await markReadyPickup(tx, order.id, gudang, at);
              break;
            case 'pack':
              for (const item of order.items) await setPackedQty(tx, order.id, item.id, item.qty);
              await markPacked(tx, order.id, gudang, at);
              break;
            case 'track':
              await setTracking(tx, order.id, { courier: 'JNE Premium', trackingNo: step[2] }, gudang, at);
              break;
            case 'ship':
              await handoverCourier(tx, order.id, gudang, at);
              break;
            case 'pickup':
              await handoverPickup(tx, order.id, gudang, at);
              break;
            case 'complete':
              await completeOrder(tx, order.id, { email: 'pembeli' }, at);
              break;
            case 'cancel':
              await cancelOrder(tx, order.id, step[2], { email: 'pembeli' }, at);
              break;
            case 'refund':
              await requestRefund(tx, order.id, { amount: step[2], reason: step[3] }, cs, at);
              break;
          }
        }
      },
      { timeout: 30_000 },
    );
    count++;
  }
  return count;
}

// Dijalankan langsung: npm run db:seed-orders
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prisma = createPrisma();
  (async () => {
    const removed = await clearSampleOrders(prisma);
    const created = await seedSampleOrders(prisma);
    console.log(`✔ Pesanan contoh: ${removed} lama dihapus, ${created} dibuat (pembeli *@${SAMPLE_DOMAIN}).`);
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => Promise.all([prisma.$disconnect(), appPrisma.$disconnect()]));
}
