/** CMS modul Produk & varian: simpan tanpa merusak data, opsi & SKU, validasi, status/jadwal, hapus aman. */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { editInclude, toFormValues } from '../src/admin/modules/produk/produk.service.js';
import { toDateTimeLocal } from '../src/admin/time.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { deleteAdmins, get, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const DESKTOP = 'Mozilla/5.0 (Macintosh) Chrome/140';
const store = (path: string) => request(app).get(path).set('User-Agent', DESKTOP);

/** Body form seperti yang dikirim browser untuk produk di database. */
async function formBody(productId: number) {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: editInclude });
  const v = toFormValues(p);
  return {
    title: v.title,
    slug: v.slug,
    type: v.type,
    categoryId: v.categoryId ?? '',
    label: v.label ?? '',
    sku: v.sku ?? '',
    status: v.status,
    publishedAt: toDateTimeLocal(v.publishedAt),
    externalUrl: v.externalUrl ?? '',
    priceSuffix: v.priceSuffix ?? '',
    weightGram: v.weightGram ?? '',
    description: v.description ?? '',
    optionMode: v.optionMode,
    specs: v.specs,
    images: v.images,
    optVarian: v.optVarian,
    optWarna: v.optWarna,
    optUkuran: v.optUkuran,
    variants: v.variants.map((x) => ({
      id: x.id,
      sku: x.sku,
      price: x.price,
      priceOriginal: x.priceOriginal,
      isActive: x.isActive ? 'on' : undefined,
      trackStock: x.trackStock ? 'on' : undefined,
      lowStockThreshold: x.lowStockThreshold,
      imageIndex: x.imageIndex,
      varian: x.varian,
      warna: x.warna,
      ukuran: x.ukuran,
    })),
    video: v.video,
  };
}

const stockMatrix = async (slug: string) => {
  const html = (await store(`/produk/${slug}`)).text;
  const json = /<script type="application\/json" data-apparel-data>([\s\S]*?)<\/script>/.exec(html)?.[1];
  return JSON.parse(json!)[0].stock as Record<string, Record<string, number>>;
};

afterAll(async () => {
  await prisma.product.deleteMany({ where: { slug: { startsWith: 'uji-' } } });
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('Produk', () => {
  it('menyimpan produk apparel tanpa perubahan tidak mengubah SKU, stok, dan foto', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'kaos-gaspol-paguyuban-cap-orang-dalam' }, include: editInclude });
    const before = await stockMatrix(product.slug);
    const res = await postForm(agent, `/admin/produk/${product.id}`, csrf, await formBody(product.id));
    expect(res.status).toBe(303);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: editInclude });
    expect(after.variants.map((v) => [v.id, v.sku, v.price, v.isActive])).toEqual(product.variants.map((v) => [v.id, v.sku, v.price, v.isActive]));
    expect(after.images.map((i) => [i.url, i.optionValueId])).toEqual(product.images.map((i) => [i.url, i.optionValueId]));
    expect(await stockMatrix(product.slug)).toEqual(before);
  });

  it('ganti nama warna mempertahankan SKU & stoknya', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'kaos-gaspol-paguyuban-cap-orang-dalam' }, include: editInclude });
    const body = await formBody(product.id);
    const rename = (from: string, to: string) => {
      body.optWarna = body.optWarna.map((w) => (w.value === from ? { ...w, value: to } : w));
      body.variants = body.variants.map((v) => (v.warna === from ? { ...v, warna: to } : v));
      body.images = body.images.map((i) => (i.color === from ? { ...i, color: to } : i));
    };
    const before = await stockMatrix(product.slug);
    try {
      rename('Putih', 'Putih Tulang');
      expect((await postForm(agent, `/admin/produk/${product.id}`, csrf, body)).status).toBe(303);
      const after = await stockMatrix(product.slug);
      expect(after['Putih Tulang']).toEqual(before['Putih']);
      const ids = (await prisma.productVariant.findMany({ where: { productId: product.id }, select: { id: true } })).map((v) => v.id).sort();
      expect(ids).toEqual(product.variants.map((v) => v.id).sort());
    } finally {
      rename('Putih Tulang', 'Putih');
      await postForm(agent, `/admin/produk/${product.id}`, csrf, body);
    }
    expect(await stockMatrix(product.slug)).toEqual(before);
  });

  it('produk baru dengan varian: tayang di store, stok 0, log tercatat', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const buku = await prisma.category.findUniqueOrThrow({ where: { slug: 'novel' } });
    const res = await postForm(agent, '/admin/produk', csrf, {
      title: 'Uji Novel Edisi Spesial',
      slug: '',
      type: 'PHYSICAL',
      categoryId: String(buku.id),
      sku: 'UJI-NOVEL',
      status: 'PUBLISHED',
      publishedAt: '',
      description: '<p>Novel <strong>bagus</strong></p><script>alert(1)</script><a href="javascript:alert(1)">klik</a>',
      optionMode: 'VARIAN',
      specs: [{ label: 'Penulis', value: 'Uji Penulis' }],
      images: [{ url: '/images/store-v2/product-pesta-bola-premium.png', alt: '' }],
      optVarian: [{ value: 'Softcover' }, { value: 'Hardcover' }],
      variants: [
        { sku: 'uji-novel-soft', price: '89000', priceOriginal: '', isActive: 'on', trackStock: 'on', varian: 'Softcover' },
        { sku: 'UJI-NOVEL-HARD', price: '129000', priceOriginal: '150000', isActive: 'on', trackStock: 'on', varian: 'Hardcover' },
      ],
    });
    expect(res.status).toBe(303);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'uji-novel-edisi-spesial' }, include: editInclude });
    expect(product.publishedAt).not.toBeNull();
    expect(product.description).toBe('<p>Novel <strong>bagus</strong></p>klik');
    expect(product.specs).toEqual(['Penulis: Uji Penulis']);
    expect(product.variants.map((v) => [v.sku, v.name, v.price, v.priceOriginal])).toEqual([
      ['UJI-NOVEL-SOFT', 'Softcover', 89000, null],
      ['UJI-NOVEL-HARD', 'Hardcover', 129000, 150000],
    ]);
    const page = await store('/produk/uji-novel-edisi-spesial');
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-product-format="Softcover" data-price="89000"');
    expect(page.text).toContain('data-stock="0"');
    expect(await prisma.auditLog.count({ where: { entityType: 'product', entityId: String(product.id), action: 'create' } })).toBe(1);

    // Belum pernah punya stok/pesanan → boleh dihapus
    const del = await postForm(agent, `/admin/produk/${product.id}/hapus`, csrf);
    expect(del.status).toBe(303);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(0);
  });

  it('validasi: SKU dipakai produk lain, harga coret ≤ harga, produk tayang tanpa foto', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const taken = await prisma.productVariant.findFirstOrThrow({ where: { sku: 'STORE-PESTABOLA-634812-BASIC' } });
    const res = await postForm(agent, '/admin/produk', csrf, {
      title: 'Uji Salah',
      slug: 'uji-salah',
      type: 'PHYSICAL',
      status: 'PUBLISHED',
      optionMode: 'NONE',
      variants: [{ sku: taken.sku, price: '50000', priceOriginal: '40000', isActive: 'on', trackStock: 'on' }],
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('sudah dipakai');
    expect(res.text).toContain('Harga coret harus lebih besar dari harga jual.');
    expect(res.text).toContain('Produk tayang butuh minimal satu foto.');
    expect(await prisma.product.count({ where: { slug: 'uji-salah' } })).toBe(0);
  });

  it('SKU yang dihapus dari form: punya riwayat stok → dinonaktifkan, bukan dihapus', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'source-18' }, include: editInclude });
    const original = await formBody(product.id);
    const premiumMax = product.variants.find((v) => v.name === 'Premium MAX')!;
    try {
      const body = structuredClone(original);
      body.optVarian = body.optVarian.filter((o) => o.value !== 'Premium MAX');
      body.variants = body.variants.filter((v) => v.varian !== 'Premium MAX');
      expect((await postForm(agent, `/admin/produk/${product.id}`, csrf, body)).status).toBe(303);
      const kept = await prisma.productVariant.findUniqueOrThrow({ where: { id: premiumMax.id } });
      expect(kept.isActive).toBe(false);
      expect(await prisma.stockMovement.count({ where: { variantId: premiumMax.id } })).toBeGreaterThan(0);
      const page = await store('/produk/source-18');
      expect(page.text).not.toContain('data-product-format="Premium MAX"');
    } finally {
      await postForm(agent, `/admin/produk/${product.id}`, csrf, original);
      await prisma.productVariant.update({ where: { id: premiumMax.id }, data: { isActive: true, sortOrder: premiumMax.sortOrder } });
      const opt = await prisma.productOption.findFirstOrThrow({ where: { productId: product.id, name: 'Varian' } });
      const value = await prisma.productOptionValue.upsert({
        where: { optionId_value: { optionId: opt.id, value: 'Premium MAX' } },
        create: { optionId: opt.id, value: 'Premium MAX', sortOrder: 3 },
        update: {},
      });
      await prisma.variantOptionValue.upsert({
        where: { variantId_optionValueId: { variantId: premiumMax.id, optionValueId: value.id } },
        create: { variantId: premiumMax.id, optionValueId: value.id },
        update: {},
      });
    }
    expect((await store('/produk/source-18')).text).toContain('data-product-format="Premium MAX"');
  });

  it('jadwal tayang & arsip: produk terjadwal/arsip tidak tampil; produk berriwayat tidak bisa dihapus', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'source-18' } });
    const original = await formBody(product.id);
    try {
      const body = { ...structuredClone(original), publishedAt: toDateTimeLocal(new Date(Date.now() + 3 * 86400_000)) };
      await postForm(agent, `/admin/produk/${product.id}`, csrf, body);
      expect((await store('/produk/source-18')).status).toBe(404);
      const list = await get(agent, '/admin/produk?status=terjadwal');
      expect(list.text).toContain(product.title.slice(0, 20));

      const preview = await get(agent, `/admin/produk/${product.id}/pratinjau`).set('User-Agent', DESKTOP);
      expect(preview.status).toBe(200);
      expect(preview.headers['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(preview.text).toContain('data-product-format="Basic"');
    } finally {
      await postForm(agent, `/admin/produk/${product.id}`, csrf, original);
    }
    expect((await store('/produk/source-18')).status).toBe(200);

    await postForm(agent, `/admin/produk/${product.id}/arsip`, csrf);
    expect((await store('/produk/source-18')).status).toBe(404);
    await postForm(agent, `/admin/produk/${product.id}/arsip`, csrf); // kembali ke draft
    await prisma.product.update({ where: { id: product.id }, data: { status: 'PUBLISHED' } });
    expect((await store('/produk/source-18')).status).toBe(200);

    const del = await postForm(agent, `/admin/produk/${product.id}/hapus`, csrf);
    expect(del.status).toBe(303);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });

  it('hak akses: Marketing & Gudang hanya melihat produk', async () => {
    const marketing = await loggedIn(app, ['MARKETING']);
    const gudang = await loggedIn(app, ['GUDANG']);
    admins.push(marketing.user.id, gudang.user.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'source-18' } });
    const list = await get(marketing.agent, '/admin/produk?q=pesta');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Bundling Pesta Bola');
    expect(list.text).not.toContain('Produk baru');
    const form = await get(gudang.agent, `/admin/produk/${product.id}`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('<fieldset class="plain-fieldset grid grid-main-side" disabled>');
    expect((await postForm(marketing.agent, `/admin/produk/${product.id}`, marketing.csrf, await formBody(product.id))).status).toBe(403);
    expect((await get(gudang.agent, '/admin/produk/baru')).status).toBe(403);
  });
});
