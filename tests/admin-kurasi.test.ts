/** CMS: banner hero, seksi produk beranda, dan koleksi — termasuk efeknya di store. */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { toDateTimeLocal } from '../src/admin/time.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { invalidateStorefront } from '../src/modules/storefront/storefront.service.js';
import { deleteAdmins, get, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const DESKTOP = 'Mozilla/5.0 (Macintosh) Chrome/140';
const store = async (path = '/') => {
  invalidateStorefront();
  return request(app).get(path).set('User-Agent', DESKTOP);
};
const cardIds = (html: string) => [...new Set([...html.matchAll(/data-select-product="([^"]+)"/g)].map((m) => m[1]))];
const slugsOf = async (ids: number[]) => (await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).map((p) => p.slug);

afterAll(async () => {
  await prisma.banner.deleteMany({ where: { title: { startsWith: 'Uji ' } } });
  await prisma.homeSection.deleteMany({ where: { key: { startsWith: 'uji-' } } });
  await prisma.navigationItem.deleteMany({ where: { label: { startsWith: 'Uji ' } } });
  await prisma.collection.deleteMany({ where: { key: { startsWith: 'uji-' } } });
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('Banner hero', () => {
  it('Marketing menambah banner terjadwal: belum tampil sampai waktunya', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['MARKETING']);
    admins.push(user.id);
    const tomorrow = toDateTimeLocal(new Date(Date.now() + 86400_000));
    const res = await postForm(agent, '/admin/banner', csrf, {
      title: 'Uji Banner Besok',
      imageUrl: '/images/store-v2/hero-tshirt-terbaru.jpg',
      href: '/koleksi/diskon',
      startsAt: tomorrow,
      isActive: 'on',
    });
    expect(res.status).toBe(303);
    expect((await store()).text).not.toContain('Uji Banner Besok');

    const banner = await prisma.banner.findFirstOrThrow({ where: { title: 'Uji Banner Besok' } });
    expect(toDateTimeLocal(banner.startsAt)).toBe(tomorrow); // disimpan sebagai jam WIB
    await postForm(agent, `/admin/banner/${banner.id}`, csrf, { title: 'Uji Banner Besok', imageUrl: banner.imageUrl, href: '/koleksi/diskon', startsAt: '', isActive: 'on' });
    expect((await store()).text).toContain('aria-label="Uji Banner Besok"');

    const list = await get(agent, '/admin/banner');
    expect(list.text).toContain('Uji Banner Besok');
  });

  it('validasi: gambar wajib, link berbahaya ditolak, selesai harus setelah mulai', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const res = await postForm(agent, '/admin/banner', csrf, {
      title: 'Uji Banner Salah',
      imageUrl: '',
      href: 'javascript:alert(1)',
      startsAt: '2026-11-02T10:00',
      endsAt: '2026-11-01T10:00',
      isActive: 'on',
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Gambar desktop wajib diisi.');
    expect(res.text).toContain('Link harus diawali');
    expect(res.text).toContain('Waktu selesai harus setelah waktu mulai.');
  });
});

describe('Seksi produk', () => {
  it('seksi baru otomatis (aturan) tampil di beranda dengan halaman Lihat semua sendiri', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['MARKETING']);
    admins.push(user.id);
    const res = await postForm(agent, '/admin/seksi', csrf, {
      title: 'Uji Kaos Pilihan',
      key: '',
      placement: 'HOME',
      source: 'RULE',
      ruleCategory: 'merchandise/apparel',
      ruleSort: 'terbaru',
      productLimit: '4',
      seeAllType: 'SECTION_PAGE',
      showMoreButton: 'on',
      isActive: 'on',
    });
    expect(res.status).toBe(303);
    const section = await prisma.homeSection.findUniqueOrThrow({ where: { key: 'uji-kaos-pilihan' } });
    expect(section.rules).toEqual({ kcat: 'merchandise', ksub: 'apparel' });

    const html = (await store()).text;
    const block = html.slice(html.indexOf('<h2>Uji Kaos Pilihan</h2>'), html.indexOf('</section>', html.indexOf('<h2>Uji Kaos Pilihan</h2>')));
    expect(cardIds(block)).toHaveLength(4);
    expect(block).toContain('href="/seksi/uji-kaos-pilihan">Lihat Semua</a>');
    expect(block).toContain('<a class="btn btn-secondary sv2-more-btn" href="/seksi/uji-kaos-pilihan">Lihat semua</a>');
    // seksi baru di paling bawah
    expect(html.indexOf('<h2>Baru di store</h2>')).toBeLessThan(html.indexOf('<h2>Uji Kaos Pilihan</h2>'));
    expect(cardIds((await store('/seksi/uji-kaos-pilihan')).text)).toHaveLength(9);
  });

  it('seksi manual: urutan produk mengikuti pemilih; tanpa produk ditolak', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const empty = await postForm(agent, '/admin/seksi', csrf, { title: 'Uji Kosong', key: 'uji-kosong', placement: 'HOME', source: 'MANUAL', productIds: '', productLimit: '4', seeAllType: 'NONE', isActive: 'on' });
    expect(empty.status).toBe(400);
    expect(empty.text).toContain('Pilih minimal satu produk.');

    const ids = (await prisma.product.findMany({ where: { status: 'PUBLISHED' }, orderBy: { id: 'desc' }, take: 3, select: { id: true } })).map((p) => p.id);
    const res = await postForm(agent, '/admin/seksi', csrf, {
      title: 'Uji Manual',
      key: 'uji-manual',
      placement: 'HOME',
      source: 'MANUAL',
      productIds: ids.join(','),
      productLimit: '4',
      seeAllType: 'NONE',
      isActive: 'on',
    });
    expect(res.status).toBe(303);
    const html = (await store()).text;
    const start = html.indexOf('<h2>Uji Manual</h2>');
    const block = html.slice(start, html.indexOf('</section>', start));
    expect(cardIds(block)).toEqual(await slugsOf(ids));
    expect(block).not.toContain('Lihat Semua');
  });

  it('4 seksi bawaan tidak dikunci: judul bisa diubah dan seksi bisa disembunyikan', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const rekomendasi = await prisma.homeSection.findUniqueOrThrow({ where: { key: 'rekomendasi' }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    try {
      const res = await postForm(agent, `/admin/seksi/${rekomendasi.id}`, csrf, {
        title: 'Pilihan Redaksi',
        key: 'rekomendasi',
        placement: 'HOME',
        source: 'MANUAL',
        productIds: rekomendasi.items.map((i) => i.productId).join(','),
        productLimit: '4',
        seeAllType: 'COLLECTION',
        seeAllCollectionId: String(rekomendasi.seeAllCollectionId),
        isActive: 'on',
      });
      expect(res.status).toBe(303);
      let html = (await store()).text;
      expect(html).toContain('<h2>Pilihan Redaksi</h2>');
      expect(html).not.toContain('<h2>Rekomendasi untukmu</h2>');

      await postForm(agent, `/admin/seksi/${rekomendasi.id}/tampil`, csrf);
      html = (await store()).text;
      expect(html).not.toContain('<h2>Pilihan Redaksi</h2>');
      expect(await prisma.auditLog.count({ where: { entityType: 'home_section', entityId: String(rekomendasi.id) } })).toBeGreaterThanOrEqual(2);
    } finally {
      await prisma.homeSection.update({ where: { id: rekomendasi.id }, data: { title: rekomendasi.title, isActive: true } });
    }
    expect((await store()).text).toContain('<h2>Rekomendasi untukmu</h2>');
  });
});

describe('Koleksi', () => {
  it('koleksi baru "hanya kurasi": halaman berisi produk pilihan sesuai urutan; nonaktif → 404 & menu disembunyikan', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const ids = (await prisma.product.findMany({ where: { status: 'PUBLISHED' }, orderBy: { id: 'asc' }, take: 2, select: { id: true } })).map((p) => p.id).reverse();
    const res = await postForm(agent, '/admin/koleksi', csrf, { title: 'Uji Hadiah', key: '', icon: '/images/store-v2/cat-terbaru.png', mode: 'ONLY', productIds: ids.join(','), isActive: 'on' });
    expect(res.status).toBe(303);
    const page = await store('/koleksi/uji-hadiah');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<h1 data-tab-title>Uji Hadiah</h1>');
    expect(cardIds(page.text)).toEqual(await slugsOf(ids));

    const collection = await prisma.collection.findUniqueOrThrow({ where: { key: 'uji-hadiah' } });
    await postForm(agent, '/admin/menu', csrf, { placement: 'SEARCH_MENU', label: 'Uji Hadiah', linkType: 'COLLECTION', collectionId: String(collection.id), isActive: 'on' });
    expect((await store()).text).toContain('<a href="/koleksi/uji-hadiah">Uji Hadiah</a>');

    // tidak bisa dihapus selama dipakai menu
    await postForm(agent, `/admin/koleksi/${collection.id}/hapus`, csrf);
    expect(await prisma.collection.count({ where: { id: collection.id } })).toBe(1);

    await postForm(agent, `/admin/koleksi/${collection.id}/tampil`, csrf);
    expect((await store('/koleksi/uji-hadiah')).status).toBe(404);
    expect((await store()).text).not.toContain('Uji Hadiah');
  });

  it('Marketing hanya melihat koleksi; API pencarian produk butuh login', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['MARKETING']);
    admins.push(user.id);
    expect((await get(agent, '/admin/koleksi')).status).toBe(200);
    expect((await postForm(agent, '/admin/koleksi', csrf, { title: 'Uji Dilarang', key: 'uji-dilarang', mode: 'MIXED', isActive: 'on' })).status).toBe(403);

    const found = await get(agent, '/admin/api/produk?q=kaos').set('Accept', 'application/json');
    expect(found.status).toBe(200);
    expect(found.body.items.length).toBeGreaterThan(0);
    expect(found.body.items[0]).toHaveProperty('title');
    expect((await request(app).get('/admin/api/produk?q=kaos').set('Accept', 'application/json')).status).toBe(401);
  });
});
