/** CMS pencarian global: saran per modul sesuai hak akses, no invoice/resi langsung terbuka, halaman hasil. */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { deleteAdmins, get, loggedIn } from './admin-helpers.js';
import { cleanupOrders, createTestOrder, createTestProduct } from './order-helpers.js';

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

type Group = { key: string; total: number; items: { title: string; href: string }[] };

describe('Pencarian global', () => {
  it('saran per modul: produk lewat SKU & judul, pesanan lewat 4 digit HP; kata kunci < 2 huruf diabaikan', async () => {
    const product = await createTestProduct({ variants: 1 });
    const order = await createTestOrder({ items: [{ variantId: product.variants[0]!.id, qty: 1 }], paid: true, phone: '081277778642' });
    const { agent } = await as(['ADMIN']);

    const bySku = await get(agent, `/admin/api/cari?q=${encodeURIComponent(product.variants[0]!.sku.toLowerCase())}`);
    expect(bySku.status).toBe(200);
    const produk = (bySku.body.groups as Group[]).find((g) => g.key === 'produk')!;
    expect(produk.items[0]).toMatchObject({ title: product.title, href: `/admin/produk/${product.id}` });

    const byPhone = await get(agent, '/admin/api/cari?q=8642');
    const pesanan = (byPhone.body.groups as Group[]).find((g) => g.key === 'pesanan')!;
    expect(pesanan.items.map((i) => i.title)).toContain(order.invoiceNo);

    const short = await get(agent, '/admin/api/cari?q=k');
    expect(short.body).toMatchObject({ q: '', groups: [] });
  });

  it('hasil mengikuti hak akses: Editor tidak melihat pesanan & promo, Gudang tidak melihat promo & pengguna', async () => {
    const product = await createTestProduct({ variants: 1 });
    const order = await createTestOrder({ items: [{ variantId: product.variants[0]!.id, qty: 1 }] });
    const editor = await as(['EDITOR']);
    const e = await get(editor.agent, `/admin/api/cari?q=${order.invoiceNo}`);
    expect((e.body.groups as Group[]).some((g) => g.key === 'pesanan')).toBe(false);
    expect(e.body.direct).toBeNull();
    const promoAsEditor = await get(editor.agent, '/admin/api/cari?q=payday');
    expect((promoAsEditor.body.groups as Group[]).some((g) => g.key === 'promo')).toBe(false);

    const gudang = await as(['GUDANG']);
    const g = await get(gudang.agent, `/admin/api/cari?q=${encodeURIComponent('cms.test')}`);
    expect((g.body.groups as Group[]).some((x) => x.key === 'pengguna')).toBe(false);
    const admin = await as(['ADMIN']);
    const a = await get(admin.agent, `/admin/api/cari?q=${encodeURIComponent(admin.user.email)}`);
    expect((a.body.groups as Group[]).find((x) => x.key === 'pengguna')?.items[0]?.href).toBe(`/admin/pengguna/${admin.user.id}`);
  });

  it('no invoice lengkap (huruf kecil pun) & no resi langsung membuka pesanan; halaman hasil menandai kata kunci', async () => {
    const product = await createTestProduct({ variants: 1 });
    const order = await createTestOrder({ items: [{ variantId: product.variants[0]!.id, qty: 1 }], paid: true });
    await prisma.order.update({ where: { id: order.id }, data: { trackingNo: 'JNECARI00123' } });
    const { agent } = await as(['CS']);

    const byInvoice = await get(agent, `/admin/cari?q=${order.invoiceNo.toLowerCase()}`);
    expect(byInvoice.status).toBe(303);
    expect(byInvoice.headers.location).toBe(`/admin/pesanan/${order.invoiceNo}`);
    const byResi = await get(agent, '/admin/cari?q=jnecari00123');
    expect(byResi.headers.location).toBe(`/admin/pesanan/${order.invoiceNo}`);

    const page = await get(agent, `/admin/cari?q=${encodeURIComponent(product.title.slice(0, 12))}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<mark>');
    expect(page.text).toContain(`href="/admin/produk/${product.id}"`);

    const empty = await get(agent, '/admin/cari?q=zzzz-tidak-ada-zzzz');
    expect(empty.text).toContain('Tidak ada hasil');
    const tooShort = await get(agent, '/admin/cari?q=a');
    expect(tooShort.text).toContain('Ketik minimal 2 karakter');
  });

  it('dashboard menampilkan kotak cari', async () => {
    const { agent } = await as(['MARKETING']);
    const res = await get(agent, '/admin');
    expect(res.text).toContain('data-global-search');
    expect(res.text).toContain('action="/admin/cari"');
  });
});
