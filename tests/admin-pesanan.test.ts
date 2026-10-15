/**
 * CMS Pesanan & Refund: transisi + efek stok per baris, idempoten, hak akses per aksi, refund oleh orang berbeda,
 * retur, ambil di tempat (4 digit HP / QR), foto privat, job dengan `now`, dan rekonsiliasi buku besar stok.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runJobs } from '../src/admin/jobs.js';
import { cancelOrder, handoverCourier, inOrderTx, markPacked, markReadyPickup, requestRefund, setPackedQty, setTracking, SYSTEM } from '../src/admin/modules/pesanan/pesanan.service.js';
import { prisma } from '../src/lib/prisma.js';
import { agent, deleteAdmins, get, HOST, loggedIn, ORIGIN, postForm } from './admin-helpers.js';
import { cleanupOrders, createTestOrder, createTestProduct, ledgerOf, levelOf } from './order-helpers.js';

const app = createApp();
const admins: number[] = [];

afterAll(async () => {
  await cleanupOrders();
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

async function as(roles: Parameters<typeof loggedIn>[1]) {
  const session = await loggedIn(app, roles);
  admins.push(session.user.id);
  return session;
}

const flashOf = (res: { headers: Record<string, unknown> }) => {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []);
  const raw = cookies.find((c) => c.startsWith('skc_admin_flash='));
  return raw ? (JSON.parse(decodeURIComponent(raw.split(';')[0]!.slice('skc_admin_flash='.length))) as { type: string; message: string }) : null;
};

const order = (id: number) => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });

/** Dikemas + resi lewat layanan (untuk tes yang fokus ke langkah sesudahnya). */
async function packAndTrack(id: number, trackingNo: string) {
  const o = await order(id);
  await inOrderTx(async (tx) => {
    for (const i of o.items) await setPackedQty(tx, id, i.id, i.qty);
    await markPacked(tx, id, SYSTEM);
    await setTracking(tx, id, { courier: 'JNE', trackingNo }, SYSTEM);
  });
}

describe('Pesanan dikirim kurir', () => {
  it('dibayar → reservasi per baris; Gudang kemas → resi → serah terima: OUT sekali, idempoten, tercatat', async () => {
    const p = await createTestProduct({ stock: 10 });
    const [a, b] = p.variants;
    const o = await createTestOrder({ items: [{ variantId: a!.id, qty: 2 }, { variantId: b!.id, qty: 1 }], paid: true });
    expect(o.status).toBe('PROCESSING');
    expect(o.items.map((i) => i.reservedQty)).toEqual([2, 1]);
    expect(await levelOf(a!.id)).toEqual({ onHand: 10, reserved: 2 });

    const { user, agent: g, csrf } = await as(['GUDANG']);
    const list = await get(g, '/admin/pesanan');
    expect(list.status).toBe(200);
    expect(list.text).toContain(o.invoiceNo);
    expect(list.text).toContain('Perlu dikemas');

    // Baru satu barang dicentang → belum dikemas, centangan disimpan
    const partial = await postForm(g, `/admin/pesanan/${o.invoiceNo}/kemas`, csrf, { packed: [String(o.items[0]!.id)] });
    expect(partial.status).toBe(303);
    expect(flashOf(partial)).toMatchObject({ type: 'error' });
    expect((await order(o.id)).packedAt).toBeNull();
    expect((await order(o.id)).items.map((i) => i.packedQty)).toEqual([2, 0]);

    const packed = await postForm(g, `/admin/pesanan/${o.invoiceNo}/kemas`, csrf, { packed: o.items.map((i) => String(i.id)) });
    expect(flashOf(packed)).toMatchObject({ type: 'success' });
    expect((await order(o.id)).packedBy).toBe(user.email);

    // Serah terima sebelum resi ditolak
    const early = await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-kurir`, csrf);
    expect(flashOf(early)?.message).toContain('resi');

    const badResi = await postForm(g, `/admin/pesanan/${o.invoiceNo}/resi`, csrf, { courier: 'JNE', trackingNo: 'ab' });
    expect(flashOf(badResi)).toMatchObject({ type: 'error' });
    await postForm(g, `/admin/pesanan/${o.invoiceNo}/resi`, csrf, { courier: 'JNE', trackingNo: 'jne-uji-0001' });
    expect((await order(o.id)).trackingNo).toBe('JNE-UJI-0001');

    const ship = await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-kurir`, csrf);
    expect(flashOf(ship)).toMatchObject({ type: 'success' });
    const shipped = await order(o.id);
    expect(shipped).toMatchObject({ status: 'SHIPPED', shippedBy: user.email });
    expect(shipped.items.map((i) => [i.reservedQty, i.shippedQty])).toEqual([[0, 2], [0, 1]]);
    expect(await levelOf(a!.id)).toEqual({ onHand: 8, reserved: 0 });

    // Dobel ketuk: sukses "sudah", tidak ada OUT kedua
    const again = await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-kurir`, csrf);
    expect(flashOf(again)).toMatchObject({ type: 'info' });
    expect(await prisma.stockMovement.count({ where: { refType: 'order', refId: o.invoiceNo, type: 'OUT' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityType: 'order', entityId: o.invoiceNo, action: 'order.ship' } })).toBe(1);

    // Rekonsiliasi buku besar
    for (const v of [a!, b!]) expect(await levelOf(v.id)).toEqual(await ledgerOf(v.id));

    // Label kirim berisi barcode resi & invoice
    const label = await get(g, `/admin/pesanan/${o.invoiceNo}/label`);
    expect(label.status).toBe(200);
    expect(label.text).toContain('JNE-UJI-0001');
    expect(label.text).toContain('<svg');
  });

  it('hak akses per aksi: CS tidak bisa kemas, Gudang tidak bisa batal/refund, Editor tidak bisa membuka pesanan', async () => {
    const p = await createTestProduct();
    const o = await createTestOrder({ items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true });
    const cs = await as(['CS']);
    expect((await postForm(cs.agent, `/admin/pesanan/${o.invoiceNo}/kemas`, cs.csrf, { packed: [String(o.items[0]!.id)] })).status).toBe(403);
    const gudang = await as(['GUDANG']);
    expect((await postForm(gudang.agent, `/admin/pesanan/${o.invoiceNo}/batal`, gudang.csrf, { reason: 'Stok habis' })).status).toBe(403);
    expect((await get(gudang.agent, '/admin/refund')).status).toBe(403);
    const finance = await as(['FINANCE']);
    const view = await get(finance.agent, `/admin/pesanan/${o.invoiceNo}`);
    expect(view.status).toBe(200);
    expect(view.text).not.toContain('Selesai dikemas');
    expect(view.text).not.toContain('Batalkan pesanan');
    const editor = await as(['EDITOR']);
    expect((await get(editor.agent, '/admin/pesanan')).status).toBe(403);
    expect((await get(editor.agent, `/admin/pesanan/${o.invoiceNo}`)).status).toBe(403);
    // Simulasi bayar hanya Admin
    const unpaid = await createTestOrder({ items: [{ variantId: p.variants[1]!.id, qty: 1 }] });
    expect((await postForm(cs.agent, `/admin/pesanan/${unpaid.invoiceNo}/bayar-simulasi`, cs.csrf)).status).toBe(403);
    const admin = await as(['ADMIN']);
    await postForm(admin.agent, `/admin/pesanan/${unpaid.invoiceNo}/bayar-simulasi`, admin.csrf);
    expect((await order(unpaid.id)).status).toBe('PROCESSING');
  });

  it('pencarian: 4 digit terakhir HP, no invoice, dan filter terlambat', async () => {
    const p = await createTestProduct();
    const o = await createTestOrder({ items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true, phone: '081299997321' });
    const { agent: cs } = await as(['CS']);
    expect((await get(cs, '/admin/pesanan?status=semua&q=7321')).text).toContain(o.invoiceNo);
    expect((await get(cs, `/admin/pesanan?status=semua&q=${o.invoiceNo.toLowerCase()}`)).text).toContain(o.invoiceNo);
    expect((await get(cs, '/admin/pesanan?terlambat=1')).text).not.toContain(o.invoiceNo);
    await prisma.order.update({ where: { id: o.id }, data: { paidAt: new Date(Date.now() - 3 * 86400_000) } });
    const late = await get(cs, '/admin/pesanan?terlambat=1');
    expect(late.text).toContain(o.invoiceNo);
    expect(late.text).toContain('Terlambat 3 hari');
  });
});

describe('Ambil di tempat', () => {
  it('siap diambil → serahkan dengan 4 digit HP (salah ditolak) → Selesai + OUT; scan QR ulang: sudah diambil', async () => {
    const p = await createTestProduct();
    const v = p.variants[0]!;
    const o = await createTestOrder({ fulfillment: 'PICKUP', items: [{ variantId: v.id, qty: 3 }], paid: true, phone: '081211114455' });
    const { agent: g, csrf, user } = await as(['GUDANG']);
    await postForm(g, `/admin/pesanan/${o.invoiceNo}/siap-diambil`, csrf);
    const ready = await order(o.id);
    expect(ready.status).toBe('READY_PICKUP');
    expect(ready.pickupToken).toMatch(/^[\w-]{24}$/);

    const detail = await get(g, `/admin/pesanan/${o.invoiceNo}`);
    expect(detail.text).toContain('4 digit terakhir no HP pembeli');
    expect(detail.text).toContain('https://wa.me/6281211114455?text&#x3D;Halo');

    const wrong = await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-pembeli`, csrf, { phone4: '0000' });
    expect(flashOf(wrong)?.message).toContain('tidak cocok');
    expect((await order(o.id)).status).toBe('READY_PICKUP');

    await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-pembeli`, csrf, { phone4: '4455' });
    const done = await order(o.id);
    expect(done).toMatchObject({ status: 'COMPLETED', pickedUpBy: user.email });
    expect(await levelOf(v.id)).toEqual({ onHand: 7, reserved: 0 });

    const rescan = await get(g, `/admin/ambil/${ready.pickupToken}`);
    expect(rescan.status).toBe(200);
    expect(rescan.text).toContain('Sudah diambil');
    expect((await get(g, '/admin/ambil/token-palsu-yang-tidak-ada')).status).toBe(404);
  });

  it('QR pengambilan: token benar langsung menyerahkan tanpa 4 digit', async () => {
    const p = await createTestProduct();
    const o = await createTestOrder({ fulfillment: 'PICKUP', items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true });
    await inOrderTx((tx) => markReadyPickup(tx, o.id, SYSTEM));
    const { pickupToken } = await order(o.id);
    const { agent: g, csrf } = await as(['GUDANG']);
    const page = await get(g, `/admin/ambil/${pickupToken}`);
    expect(page.text).toContain('Serahkan ke pembeli');
    await postForm(g, `/admin/pesanan/${o.invoiceNo}/serahkan-pembeli`, csrf, { token: pickupToken });
    expect((await order(o.id)).status).toBe('COMPLETED');
  });
});

describe('Batal, refund, retur', () => {
  it('CS membatalkan setelah dikemas: RELEASE, tanda kemas dihapus, refund penuh diajukan; pengaju tidak bisa memutuskan', async () => {
    const p = await createTestProduct();
    const v = p.variants[0]!;
    const o = await createTestOrder({ items: [{ variantId: v.id, qty: 2 }], paid: true });
    await packAndTrack(o.id, 'JNE-BATAL-01');
    const cs = await as(['CS']);
    const res = await postForm(cs.agent, `/admin/pesanan/${o.invoiceNo}/batal`, cs.csrf, { reason: 'Permintaan pembeli' });
    expect(flashOf(res)?.message).toContain('Refund');
    const canceled = await order(o.id);
    expect(canceled).toMatchObject({ status: 'CANCELED', packedAt: null, cancelReason: 'Permintaan pembeli' });
    expect(canceled.items[0]!.packedQty).toBe(0);
    expect(await levelOf(v.id)).toEqual({ onHand: 10, reserved: 0 });

    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: o.id } });
    expect(refund).toMatchObject({ amount: o.total, status: 'REQUESTED', requestedBy: cs.user.email });
    expect(await prisma.notification.count({ where: { type: 'refund_requested', url: `/admin/refund/${refund.id}` } })).toBeGreaterThan(0);

    // CS hanya boleh melihat refund, bukan memutuskan
    expect((await postForm(cs.agent, `/admin/refund/${refund.id}/putuskan`, cs.csrf, { keputusan: 'setujui' })).status).toBe(403);
    // Admin yang juga mengajukan tidak boleh memutuskan refund-nya sendiri
    const admin = await as(['ADMIN']);
    const own = await createTestOrder({ items: [{ variantId: p.variants[1]!.id, qty: 1 }], paid: true });
    await packAndTrack(own.id, 'JNE-OWN-0001');
    await inOrderTx((tx) => handoverCourier(tx, own.id, SYSTEM));
    await postForm(admin.agent, `/admin/pesanan/${own.invoiceNo}/refund`, admin.csrf, { amount: '10.000', reason: 'Barang rusak' });
    const ownRefund = await prisma.refund.findFirstOrThrow({ where: { orderId: own.id } });
    const self = await postForm(admin.agent, `/admin/refund/${ownRefund.id}/putuskan`, admin.csrf, { keputusan: 'setujui' });
    expect(flashOf(self)?.message).toContain('orang lain');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: ownRefund.id } })).status).toBe('REQUESTED');

    // Finance: tolak wajib alasan; setujui → selesai → pembayaran REFUNDED
    const fin = await as(['FINANCE']);
    const intent = await get(fin.agent, `/admin/refund/${refund.id}?aksi=setujui`);
    expect(intent.text).toContain('Setujui refund ini?');
    const noReason = await postForm(fin.agent, `/admin/refund/${refund.id}/putuskan`, fin.csrf, { keputusan: 'tolak' });
    expect(flashOf(noReason)).toMatchObject({ type: 'error' });
    await postForm(fin.agent, `/admin/refund/${refund.id}/putuskan`, fin.csrf, { keputusan: 'setujui' });
    await postForm(fin.agent, `/admin/refund/${refund.id}/selesai`, fin.csrf);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('COMPLETED');
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } })).status).toBe('REFUNDED');
    expect(await prisma.auditLog.count({ where: { entityType: 'refund', entityId: String(refund.id) } })).toBe(2);
  });

  it('pesanan dikirim tidak bisa dibatalkan; total refund tidak boleh melebihi total pesanan', async () => {
    const p = await createTestProduct();
    const o = await createTestOrder({ items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true });
    await packAndTrack(o.id, 'JNE-LIMIT-01');
    await inOrderTx((tx) => handoverCourier(tx, o.id, SYSTEM));
    await expect(inOrderTx((tx) => cancelOrder(tx, o.id, 'x', SYSTEM))).rejects.toThrow(/retur/);
    const cs = await as(['CS']);
    const over = await postForm(cs.agent, `/admin/pesanan/${o.invoiceNo}/refund`, cs.csrf, { amount: String(o.total + 1), reason: 'Barang rusak' });
    expect(flashOf(over)?.message).toContain('melebihi');
    await inOrderTx((tx) => requestRefund(tx, o.id, { amount: o.total - 1000, reason: 'Sebagian' }, SYSTEM));
    await expect(inOrderTx((tx) => requestRefund(tx, o.id, { amount: 2000, reason: 'Lagi' }, SYSTEM))).rejects.toThrow(/melebihi/);
  });

  it('retur sebagian: hanya yang layak masuk stok lagi; retur melebihi jumlah dikirim ditolak', async () => {
    const p = await createTestProduct();
    const v = p.variants[0]!;
    const o = await createTestOrder({ items: [{ variantId: v.id, qty: 3 }], paid: true });
    await packAndTrack(o.id, 'JNE-RETUR-01');
    await inOrderTx((tx) => handoverCourier(tx, o.id, SYSTEM));
    expect(await levelOf(v.id)).toEqual({ onHand: 7, reserved: 0 });
    const { agent: g, csrf } = await as(['GUDANG']);
    const itemId = o.items[0]!.id;
    const res = await postForm(g, `/admin/pesanan/${o.invoiceNo}/retur`, csrf, { retur: { [`id${itemId}`]: { received: '2', restock: '1' } }, note: '1 rusak' });
    expect(flashOf(res)?.message).toContain('2 barang diterima, 1 masuk stok');
    expect(await levelOf(v.id)).toEqual({ onHand: 8, reserved: 0 });
    expect((await order(o.id)).items[0]!.returnedQty).toBe(2);
    const tooMany = await postForm(g, `/admin/pesanan/${o.invoiceNo}/retur`, csrf, { retur: { [`id${itemId}`]: { received: '2', restock: '0' } } });
    expect(flashOf(tooMany)?.message).toContain('melebihi');
    expect(await levelOf(v.id)).toEqual(await ledgerOf(v.id));
  });
});

describe('Foto privat, digital, job', () => {
  it('foto paket tersimpan privat: hanya bisa dibuka setelah login', async () => {
    const p = await createTestProduct();
    const o = await createTestOrder({ items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true });
    const { agent: g, csrf } = await as(['GUDANG']);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const up = await g
      .post(`/admin/pesanan/${o.invoiceNo}/foto?jenis=paket`)
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .set('X-Requested-With', 'fetch')
      .set('Content-Type', 'image/jpeg')
      .send(jpeg);
    expect(up.status).toBe(201);
    const file = await get(g, up.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['cache-control']).toContain('no-store');
    const anon = await agent(app).get(up.body.url).set('Host', HOST);
    expect(anon.status).toBe(303);
    const att = await prisma.orderAttachment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(att.path).toMatch(/^orders\/\d{4}\/\d{2}\//);
    // Bukan gambar → ditolak
    const fake = await g.post(`/admin/pesanan/${o.invoiceNo}/foto`).set('Host', HOST).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).set('X-Requested-With', 'fetch').set('Content-Type', 'image/png').send(Buffer.from('bukan gambar'));
    expect(fake.status).toBe(415);
  });

  it('produk digital: dibayar langsung Selesai tanpa mutasi stok', async () => {
    const p = await createTestProduct({ type: 'DIGITAL_VIDEO', variants: 1 });
    const o = await createTestOrder({ fulfillment: 'DIGITAL', items: [{ variantId: p.variants[0]!.id, qty: 1 }], paid: true });
    expect(o.status).toBe('COMPLETED');
    expect(o.items[0]).toMatchObject({ stockLocationId: null, reservedQty: 0 });
    expect(await prisma.stockMovement.count({ where: { refId: o.invoiceNo } })).toBe(0);
    expect(await prisma.videoAccess.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('job: belum dibayar > 24 jam kedaluwarsa (stok dilepas), dikirim > 7 hari selesai otomatis; aman diulang', async () => {
    const p = await createTestProduct();
    const v = p.variants[0]!;
    const unpaid = await createTestOrder({ items: [{ variantId: v.id, qty: 4 }] });
    const shippedOrder = await createTestOrder({ items: [{ variantId: p.variants[1]!.id, qty: 1 }], paid: true });
    await packAndTrack(shippedOrder.id, 'JNE-JOB-0001');
    await inOrderTx((tx) => handoverCourier(tx, shippedOrder.id, SYSTEM));
    expect(await levelOf(v.id)).toEqual({ onHand: 10, reserved: 4 });

    const scope = { id: { in: [unpaid.id, shippedOrder.id] } };
    const later = new Date(Date.now() + 8 * 86400_000);
    const first = await runJobs(later, scope);
    expect(first).toMatchObject({ expired: 1, completed: 1 });
    expect((await order(unpaid.id)).status).toBe('EXPIRED');
    expect((await order(shippedOrder.id)).status).toBe('COMPLETED');
    expect(await levelOf(v.id)).toEqual({ onHand: 10, reserved: 0 });
    const second = await runJobs(later, scope);
    expect(second).toMatchObject({ expired: 0, completed: 0 });
    expect(await prisma.stockMovement.count({ where: { refId: unpaid.invoiceNo, type: 'RELEASE' } })).toBe(1);
  });
});
