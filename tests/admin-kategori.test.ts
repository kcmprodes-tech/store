/** CMS modul Kategori: CRUD, urutan, sembunyikan, hapus yang aman, hak akses, efek di store, log. */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { invalidateStorefront } from '../src/modules/storefront/storefront.service.js';
import { deleteAdmins, get, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const storeHome = async () => {
  invalidateStorefront();
  return (await request(app).get('/')).text;
};

afterAll(async () => {
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'uji-' } } });
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('Kategori', () => {
  it('Editor menambah kategori + sub; langsung tampil di menu Kategori store dan tercatat di log', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);

    const create = await postForm(agent, '/admin/kategori', csrf, { name: 'Uji Alat Tulis', slug: '', isActive: 'on' });
    expect(create.status).toBe(303);
    const parent = await prisma.category.findUniqueOrThrow({ where: { slug: 'uji-alat-tulis' } });
    expect(parent.parentId).toBeNull();

    await postForm(agent, '/admin/kategori', csrf, { name: 'Uji Pulpen', slug: 'uji-pulpen', parentId: String(parent.id), isActive: 'on' });
    const sub = await prisma.category.findUniqueOrThrow({ where: { slug: 'uji-pulpen' } });
    expect(sub.parentId).toBe(parent.id);

    const html = await storeHome();
    expect(html).toContain('data-kcat="uji-alat-tulis">Uji Alat Tulis</a>');
    expect(html).toContain('<a href="/produk?category=uji-alat-tulis&amp;sub=uji-pulpen">Uji Pulpen</a>');

    const list = await get(agent, '/admin/kategori');
    expect(list.text).toContain('Uji Alat Tulis');
    expect(await prisma.auditLog.count({ where: { entityType: 'category', entityId: String(parent.id), action: 'create' } })).toBe(1);

    // slug ganda ditolak
    const dup = await postForm(agent, '/admin/kategori', csrf, { name: 'Lain', slug: 'uji-pulpen', isActive: 'on' });
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('sudah dipakai');

    // sembunyikan → hilang dari store
    await postForm(agent, `/admin/kategori/${sub.id}/tampil`, csrf);
    expect(await storeHome()).not.toContain('Uji Pulpen');
    expect((await prisma.category.findUniqueOrThrow({ where: { id: sub.id } })).isActive).toBe(false);

    // induk tidak bisa dihapus selama punya sub; sub kosong bisa dihapus
    const blocked = await postForm(agent, `/admin/kategori/${parent.id}/hapus`, csrf);
    expect(blocked.status).toBe(303);
    expect(await prisma.category.count({ where: { id: parent.id } })).toBe(1);
    await postForm(agent, `/admin/kategori/${sub.id}/hapus`, csrf);
    await postForm(agent, `/admin/kategori/${parent.id}/hapus`, csrf);
    expect(await prisma.category.count({ where: { slug: { in: ['uji-alat-tulis', 'uji-pulpen'] } } })).toBe(0);
    expect(await storeHome()).not.toContain('Uji Alat Tulis');
  });

  it('kategori yang berisi produk tidak bisa dihapus', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const apparel = await prisma.category.findUniqueOrThrow({ where: { slug: 'apparel' } });
    const res = await postForm(agent, `/admin/kategori/${apparel.id}/hapus`, csrf);
    expect(res.status).toBe(303);
    expect(await prisma.category.count({ where: { id: apparel.id } })).toBe(1);
    const flash = decodeURIComponent(res.headers['set-cookie']!.join(';'));
    expect(flash).toContain('masih berisi');
  });

  it('mengubah slug ikut memperbarui aturan koleksi yang memakainya', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const membership = await prisma.category.findUniqueOrThrow({ where: { slug: 'membership' } });
    try {
      const res = await postForm(agent, `/admin/kategori/${membership.id}`, csrf, {
        name: membership.name,
        slug: 'uji-langganan',
        landingCollectionId: String(membership.landingCollectionId ?? ''),
        isActive: 'on',
      });
      expect(res.status).toBe(303);
      const collection = await prisma.collection.findUniqueOrThrow({ where: { key: 'membership' } });
      expect(collection.rules).toEqual({ kcat: 'uji-langganan' });
      const page = await request(app).get('/koleksi/membership');
      expect(page.text.match(/class="product-card"/g)?.length).toBeGreaterThan(0);
    } finally {
      await postForm(agent, `/admin/kategori/${membership.id}`, csrf, {
        name: membership.name,
        slug: 'membership',
        landingCollectionId: String(membership.landingCollectionId ?? ''),
        isActive: 'on',
      });
    }
    expect((await prisma.collection.findUniqueOrThrow({ where: { key: 'membership' } })).rules).toEqual({ kcat: 'membership' });
  });

  it('urutan naik/turun mengubah urutan di store', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const buku = await prisma.category.findUniqueOrThrow({ where: { slug: 'buku' } });
    const before = await prisma.category.findMany({ where: { parentId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    try {
      await postForm(agent, `/admin/kategori/${buku.id}/urutan`, csrf, { arah: 'naik' });
      const html = await storeHome();
      expect(html.indexOf('data-kcat="buku"')).toBeLessThan(html.indexOf('data-kcat="merchandise"'));
      expect(html).toContain('<li><a class="sv2k-cat is-active" href="/produk?category=buku" data-kcat="buku">Buku</a></li>');
    } finally {
      for (const c of before) await prisma.category.update({ where: { id: c.id }, data: { sortOrder: c.sortOrder } });
      invalidateStorefront();
    }
  });

  it('hak akses: Marketing hanya melihat, Gudang tidak boleh membuka', async () => {
    const marketing = await loggedIn(app, ['MARKETING']);
    const gudang = await loggedIn(app, ['GUDANG']);
    admins.push(marketing.user.id, gudang.user.id);

    const view = await get(marketing.agent, '/admin/kategori');
    expect(view.status).toBe(200);
    expect(view.text).not.toContain('Kategori baru');
    const write = await postForm(marketing.agent, '/admin/kategori', marketing.csrf, { name: 'Uji Dilarang', slug: 'uji-dilarang' });
    expect(write.status).toBe(403);
    expect(await prisma.category.count({ where: { slug: 'uji-dilarang' } })).toBe(0);

    expect((await get(gudang.agent, '/admin/kategori')).status).toBe(403);
    const dash = await get(gudang.agent, '/admin');
    expect(dash.text).not.toContain('href="/admin/kategori"');
    expect(dash.text).toContain('href="/admin/stok"');
  });
});
