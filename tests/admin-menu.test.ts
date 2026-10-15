/** CMS: menu bawah pencarian, kartu Kategori Pilihan, dan upload gambar. */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { invalidateStorefront } from '../src/modules/storefront/storefront.service.js';
import { deleteAdmins, get, loggedIn, post, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const uploaded: string[] = [];
const storeHome = async (ua = 'Mozilla/5.0 (Macintosh) Chrome/140') => {
  invalidateStorefront();
  return (await request(app).get('/').set('User-Agent', ua)).text;
};

// PNG 1×1 transparan
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

afterAll(async () => {
  await prisma.navigationItem.deleteMany({ where: { label: { startsWith: 'Uji ' } } });
  for (const url of uploaded) rmSync(join(process.cwd(), 'public', url), { force: true });
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('upload gambar', () => {
  it('menerima PNG asli, menolak file yang bukan gambar & peran tanpa akses', async () => {
    const editor = await loggedIn(app, ['EDITOR']);
    const gudang = await loggedIn(app, ['GUDANG']);
    admins.push(editor.user.id, gudang.user.id);

    const ok = await post(editor.agent, '/admin/upload').set('X-CSRF-Token', editor.csrf).set('X-Requested-With', 'fetch').set('Content-Type', 'image/png').send(PNG);
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[\w-]+\.png$/);
    uploaded.push(ok.body.url);
    expect(existsSync(join(process.cwd(), 'public', ok.body.url))).toBe(true);
    const served = await request(app).get(ok.body.url);
    expect(served.headers['x-content-type-options']).toBe('nosniff');

    const fake = await post(editor.agent, '/admin/upload')
      .set('X-CSRF-Token', editor.csrf)
      .set('X-Requested-With', 'fetch')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg onload="alert(1)"></svg>'));
    expect(fake.status).toBe(415);

    const noCsrf = await post(editor.agent, '/admin/upload').set('X-Requested-With', 'fetch').set('Content-Type', 'image/png').send(PNG);
    expect(noCsrf.status).toBe(403);

    const forbidden = await post(gudang.agent, '/admin/upload').set('X-CSRF-Token', gudang.csrf).set('X-Requested-With', 'fetch').set('Content-Type', 'image/png').send(PNG);
    expect(forbidden.status).toBe(403);
  });
});

describe('Menu & pintasan', () => {
  it('item menu baru ke kategori langsung tampil di menu bawah pencarian (desktop & mobile)', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['EDITOR']);
    admins.push(user.id);
    const buku = await prisma.category.findUniqueOrThrow({ where: { slug: 'buku' } });
    const res = await postForm(agent, '/admin/menu', csrf, { placement: 'SEARCH_MENU', label: 'Uji Buku', linkType: 'CATEGORY', categoryId: String(buku.id), isActive: 'on' });
    expect(res.status).toBe(303);
    expect(await storeHome()).toContain('<a href="/produk?category=buku">Uji Buku</a>');
    expect(await storeHome('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toContain('<a href="/produk?category=buku">Uji Buku</a>');

    const item = await prisma.navigationItem.findFirstOrThrow({ where: { label: 'Uji Buku' } });
    // paling belakang
    const max = await prisma.navigationItem.aggregate({ where: { placement: 'SEARCH_MENU' }, _max: { sortOrder: true } });
    expect(item.sortOrder).toBe(max._max.sortOrder);
    await postForm(agent, `/admin/menu/${item.id}/tampil`, csrf);
    expect(await storeHome()).not.toContain('Uji Buku');
    await postForm(agent, `/admin/menu/${item.id}/hapus`, csrf);
    expect(await prisma.navigationItem.count({ where: { id: item.id } })).toBe(0);
  });

  it('link berbahaya ditolak; kartu Kategori Pilihan butuh gambar (kecuali koleksi berikon)', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const evil = await postForm(agent, '/admin/menu', csrf, { placement: 'SEARCH_MENU', label: 'Uji Jahat', linkType: 'URL', url: 'javascript:alert(1)', isActive: 'on' });
    expect(evil.status).toBe(400);
    expect(evil.text).toContain('Link harus diawali');
    const protocolRelative = await postForm(agent, '/admin/menu', csrf, { placement: 'SEARCH_MENU', label: 'Uji Jahat', linkType: 'URL', url: '//evil.example', isActive: 'on' });
    expect(protocolRelative.status).toBe(400);

    const noImage = await postForm(agent, '/admin/menu', csrf, { placement: 'HOME_SHORTCUT', label: 'Uji Kartu', linkType: 'URL', url: '/produk', isActive: 'on' });
    expect(noImage.status).toBe(400);
    expect(noImage.text).toContain('butuh gambar');

    const withImage = await postForm(agent, '/admin/menu', csrf, {
      placement: 'HOME_SHORTCUT',
      label: 'Uji Kartu',
      linkType: 'URL',
      url: '/produk?category=buku',
      imageUrl: '/images/store-v2/cat-terbaru.png',
      isActive: 'on',
    });
    expect(withImage.status).toBe(303);
    expect(await storeHome()).toContain(
      '<a class="sv2-cat-card" href="/produk?category=buku"><img class="sv2-cat-icon" src="/images/store-v2/cat-terbaru.png" alt=""><span class="sv2-cat-label">Uji Kartu</span></a>',
    );
    const list = await get(agent, '/admin/menu');
    expect(list.text).toContain('Uji Kartu');
  });

  it('Marketing hanya bisa melihat menu', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['MARKETING']);
    admins.push(user.id);
    expect((await get(agent, '/admin/menu')).status).toBe(200);
    expect((await get(agent, '/admin/menu/baru')).status).toBe(403);
    const res = await postForm(agent, '/admin/menu', csrf, { placement: 'SEARCH_MENU', label: 'Uji Marketing', linkType: 'URL', url: '/produk', isActive: 'on' });
    expect(res.status).toBe(403);
  });
});
