/** CMS modul Stok: barang masuk, penyesuaian (termasuk di bawah jumlah dipesan), riwayat, hak akses. */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { deleteAdmins, get, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const SKU = 'STORE-PESTABOLA-634812-BUNDLING-PLUS';

async function level() {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: SKU } });
  const lv = await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } });
  return { variant, lv };
}

const startedAt = new Date();
const original = await level();

afterAll(async () => {
  // Kembalikan stok & hapus mutasi yang dibuat tes
  await prisma.stockMovement.deleteMany({ where: { variantId: original.variant.id, createdAt: { gte: startedAt } } });
  await prisma.inventoryLevel.update({
    where: { variantId_locationId: { variantId: original.variant.id, locationId: original.lv.locationId } },
    data: { onHand: original.lv.onHand, reserved: original.lv.reserved },
  });
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('Stok', () => {
  it('Gudang mencatat barang masuk: stok fisik naik, mutasi IN & log tercatat, store ikut berubah', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['GUDANG']);
    admins.push(user.id);
    const { variant, lv } = await level();
    const res = await postForm(agent, '/admin/stok/masuk', csrf, { rows: [{ variantId: variant.id, qty: '10' }], refId: 'SJ-UJI-001', note: 'kiriman uji' });
    expect(res.status).toBe(303);
    const after = await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(after.onHand).toBe(lv.onHand + 10);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: variant.id, refId: 'SJ-UJI-001' } });
    expect(movement).toMatchObject({ type: 'IN', qtyDelta: 10, refType: 'barang-masuk', note: 'kiriman uji', createdBy: user.email });
    expect(await prisma.auditLog.count({ where: { adminUserId: user.id, action: 'stock.in' } })).toBe(1);
    const page = await request(app).get('/produk/source-18').set('User-Agent', 'Mozilla/5.0 (Macintosh) Chrome/140');
    expect(page.text).toContain(`data-product-format="Bundling Plus" data-price="99000" data-price-original="125000" data-discount="21" data-stock="${after.onHand - after.reserved}"`);

    const history = await get(agent, `/admin/stok/riwayat?varian=${variant.id}`);
    expect(history.text).toContain('SJ-UJI-001');
  });

  it('barang masuk: jumlah tidak valid & SKU dobel ditolak', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['GUDANG']);
    admins.push(user.id);
    const { variant } = await level();
    const zero = await postForm(agent, '/admin/stok/masuk', csrf, { rows: [{ variantId: variant.id, qty: '0' }] });
    expect(zero.status).toBe(400);
    expect(zero.text).toContain('Jumlah harus 1–100.000.');
    const dup = await postForm(agent, '/admin/stok/masuk', csrf, { rows: [{ variantId: variant.id, qty: '1' }, { variantId: variant.id, qty: '2' }] });
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('SKU yang dobel');
  });

  it('penyesuaian "set jumlah fisik" menghitung selisih; di bawah jumlah dipesan butuh konfirmasi', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['GUDANG']);
    admins.push(user.id);
    const { variant, lv } = await level();
    await prisma.inventoryLevel.update({ where: { variantId_locationId: { variantId: variant.id, locationId: lv.locationId } }, data: { reserved: 5 } });

    const noReason = await postForm(agent, '/admin/stok/penyesuaian', csrf, { variantId: variant.id, mode: 'set', qty: '20' });
    expect(noReason.status).toBe(400);
    expect(noReason.text).toContain('Pilih alasan penyesuaian.');

    const ok = await postForm(agent, '/admin/stok/penyesuaian', csrf, { variantId: variant.id, mode: 'set', qty: '20', reason: 'Hitung ulang (opname)', note: 'opname uji' });
    expect(ok.status).toBe(303);
    let now = await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(now.onHand).toBe(20);
    const adj = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: variant.id, type: 'ADJUST' }, orderBy: { id: 'desc' } });
    expect(adj.note).toBe('Hitung ulang (opname) — opname uji');

    const minus = await postForm(agent, '/admin/stok/penyesuaian', csrf, { variantId: variant.id, mode: 'delta', qty: '-25', reason: 'Rusak' });
    expect(minus.status).toBe(400);
    expect(minus.text).toContain('tidak boleh minus');

    const below = await postForm(agent, '/admin/stok/penyesuaian', csrf, { variantId: variant.id, mode: 'delta', qty: '-17', reason: 'Hilang' });
    expect(below.status).toBe(409);
    expect(below.text).toContain('lebih kecil dari jumlah yang sedang dipesan');
    expect((await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } })).onHand).toBe(20);

    const confirmed = await postForm(agent, '/admin/stok/penyesuaian', csrf, { variantId: variant.id, mode: 'delta', qty: '-17', reason: 'Hilang', confirmBelowReserved: 'on' });
    expect(confirmed.status).toBe(303);
    now = await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(now.onHand).toBe(3);
  });

  it('daftar stok: filter menipis/habis dan pencarian SKU', async () => {
    const { user, agent } = await loggedIn(app, ['CS']);
    admins.push(user.id);
    const list = await get(agent, '/admin/stok?status=habis&q=pestabola');
    expect(list.status).toBe(200);
    expect(list.text).toContain('STORE-PESTABOLA-634812-BASIC');
    expect(list.text).not.toContain('Barang masuk</a>'); // CS hanya melihat
  });

  it('hak akses: CS hanya melihat, Marketing tidak boleh membuka stok', async () => {
    const cs = await loggedIn(app, ['CS']);
    const marketing = await loggedIn(app, ['MARKETING']);
    admins.push(cs.user.id, marketing.user.id);
    const { variant } = await level();
    expect((await postForm(cs.agent, '/admin/stok/masuk', cs.csrf, { rows: [{ variantId: variant.id, qty: '1' }] })).status).toBe(403);
    expect((await get(cs.agent, '/admin/stok/masuk')).status).toBe(403);
    expect((await get(marketing.agent, '/admin/stok')).status).toBe(403);
    expect((await get(marketing.agent, '/admin')).text).not.toContain('href="/admin/stok"');
  });
});
