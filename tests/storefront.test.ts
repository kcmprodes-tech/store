/**
 * Bagian store yang diatur dari database (dan nanti dari CMS): menu di bawah pencarian, menu Kategori,
 * kartu Kategori Pilihan, dan seksi produk. Butuh MySQL dev yang sudah di-seed.
 * Setiap tes mengembalikan data seperti semula di `finally`.
 */
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { invalidateStorefront } from '../src/modules/storefront/storefront.service.js';

const app = createApp();
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

const get = (path: string, ua = DESKTOP_UA) => request(app).get(path).set('User-Agent', ua);
const cardIds = (html: string) => [...new Set([...html.matchAll(/data-select-product="([^"]+)"/g)].map((m) => m[1]))];
const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));

afterEach(() => invalidateStorefront());
afterAll(async () => {
  await prisma.$disconnect();
});

describe('menu di bawah pencarian', () => {
  it('dirender dari navigation_items, urut & hanya yang aktif (desktop & mobile)', async () => {
    const item = await prisma.navigationItem.findFirstOrThrow({ where: { placement: 'SEARCH_MENU', label: 'Event' } });
    try {
      for (const ua of [DESKTOP_UA, MOBILE_UA]) {
        const nav = between((await get('/', ua)).text, 'aria-label="Navigasi Store"', '</nav>') || between((await get('/', ua)).text, 'aria-label="Kategori toko"', '</nav>');
        expect([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(['Terlaris', 'Rekomendasi', 'Merchandise', 'Video premium', 'Event', 'Membership']);
      }
      await prisma.navigationItem.update({ where: { id: item.id }, data: { isActive: false } });
      invalidateStorefront();
      for (const ua of [DESKTOP_UA, MOBILE_UA]) {
        const html = (await get('/', ua)).text;
        expect(html).not.toContain('<a href="/koleksi/event">Event</a>');
      }
    } finally {
      await prisma.navigationItem.update({ where: { id: item.id }, data: { isActive: true } });
    }
  });

  it('item ke koleksi nonaktif tidak ditampilkan', async () => {
    const collection = await prisma.collection.findUniqueOrThrow({ where: { key: 'video-premium' } });
    try {
      await prisma.collection.update({ where: { id: collection.id }, data: { isActive: false } });
      invalidateStorefront();
      expect((await get('/')).text).not.toContain('<a href="/koleksi/video-premium">Video premium</a>');
      expect((await get('/koleksi/video-premium')).status).toBe(404);
    } finally {
      await prisma.collection.update({ where: { id: collection.id }, data: { isActive: true } });
    }
  });
});

describe('menu Kategori', () => {
  it('kategori & sub baru langsung muncul di mega menu dan dropdown pencarian', async () => {
    const parent = await prisma.category.create({ data: { slug: 'test-koleksi-kantor', name: 'Tes Kantor', sortOrder: 99 } });
    const sub = await prisma.category.create({ data: { slug: 'test-pulpen', name: 'Tes Pulpen', parentId: parent.id } });
    try {
      invalidateStorefront();
      for (const ua of [DESKTOP_UA, MOBILE_UA]) {
        const html = (await get('/', ua)).text;
        expect(html).toContain('<li><a class="sv2k-cat" href="/produk?category=test-koleksi-kantor" data-kcat="test-koleksi-kantor">Tes Kantor</a></li>');
        expect(html).toContain('<a href="/produk?category=test-koleksi-kantor&amp;sub=test-pulpen">Tes Pulpen</a>');
      }
      const search = (await get('/cari?q=kaos')).text;
      expect(search).toContain('<a class="search-kategori-option" href="/cari?category=test-koleksi-kantor" data-search-category="test-koleksi-kantor">Tes Kantor</a>');
      // Label untuk filter store-v2.js
      const json = /<script type="application\/json" data-store-categories>([\s\S]*?)<\/script>/.exec((await get('/produk')).text)?.[1];
      expect(JSON.parse(json!).sub['test-pulpen']).toBe('Tes Pulpen');

      // Disembunyikan: hilang dari menu & dropdown, produknya tetap bisa dibuka lewat URL
      await prisma.category.update({ where: { id: parent.id }, data: { isActive: false } });
      invalidateStorefront();
      const hidden = (await get('/')).text;
      expect(hidden).not.toContain('data-kcat="test-koleksi-kantor"');
      expect(hidden).not.toContain('Tes Pulpen');
      expect((await get('/cari?q=kaos')).text).not.toContain('data-search-category="test-koleksi-kantor"');
    } finally {
      await prisma.category.delete({ where: { id: sub.id } });
      await prisma.category.delete({ where: { id: parent.id } });
    }
  });

  it('kategori pertama aktif; kategori tanpa sub menampilkan pesan kosong; Membership ke koleksi', async () => {
    const html = (await get('/')).text;
    expect(html).toContain('<li><a class="sv2k-cat is-active" href="/produk?category=merchandise" data-kcat="merchandise">Merchandise</a></li>');
    expect(html).toContain('<li><a class="sv2k-cat" href="/koleksi/membership" data-kcat="membership">Membership</a></li>');
    expect(html).toMatch(/data-ksub="membership" hidden>\s*<p class="sv2k-sub-title">Membership<\/p>\s*<p class="sv2k-empty">Tidak ada sub-kategori.<\/p>/);
  });
});

describe('Kategori Pilihan & seksi produk beranda', () => {
  it('kartu Kategori Pilihan dari database', async () => {
    const html = (await get('/', MOBILE_UA)).text;
    const grid = between(html, '<div class="sv2-cat-grid">', '</section>');
    expect([...grid.matchAll(/sv2-cat-label">([^<]+)</g)].map((m) => m[1])).toEqual([
      'Diskon Spesial', 'Rekomendasi', 'Terbaru', 'Merchandise', 'Membership', 'Event',
    ]);
    expect(grid).toContain('<a class="sv2-cat-card" href="/koleksi/diskon"><img class="sv2-cat-icon" src="/images/store-v2/cat-diskon-spesial.png" alt="">');
  });

  it('seksi baru berbasis aturan: judul, jumlah, urutan, Lihat semua ke /seksi/:key', async () => {
    const section = await prisma.homeSection.create({
      data: {
        key: 'test-apparel-terlaris',
        title: 'Tes Apparel Terlaris',
        sortOrder: 0, // sama dengan "Terlaris" → urutan berikutnya ditentukan id (seksi baru di belakangnya)
        source: 'RULE',
        rules: { kcat: 'merchandise', ksub: 'apparel', sort: 'terlaris' },
        productLimit: 3,
        seeAllType: 'SECTION_PAGE',
      },
    });
    try {
      const html = (await get('/')).text;
      const block = between(html, '<h2>Tes Apparel Terlaris</h2>', '</section>');
      expect(block).toContain('<a class="font-semibold text-[#0f79c6]" href="/seksi/test-apparel-terlaris">Lihat Semua</a>');
      const ids = cardIds(block);
      expect(ids).toHaveLength(3);
      const sold = await prisma.product.findMany({ where: { slug: { in: ids } }, select: { slug: true, soldCount: true } });
      const bySlug = new Map(sold.map((p) => [p.slug, p.soldCount]));
      expect(ids.map((id) => bySlug.get(id)!)).toEqual([...ids.map((id) => bySlug.get(id)!)].sort((a, b) => b - a));
      // urutan seksi: setelah "Terlaris", sebelum "Rekomendasi untukmu" (sortOrder 1)
      expect(html.indexOf('<h2>Terlaris</h2>')).toBeLessThan(html.indexOf('<h2>Tes Apparel Terlaris</h2>'));
      expect(html.indexOf('<h2>Tes Apparel Terlaris</h2>')).toBeLessThan(html.indexOf('<h2>Rekomendasi untukmu</h2>'));

      const page = await get('/seksi/test-apparel-terlaris');
      expect(page.status).toBe(200);
      expect(page.text).toContain('<h1 data-tab-title>Tes Apparel Terlaris</h1>');
      expect(page.text).not.toContain('data-tab-icon');
      expect(cardIds(page.text)).toHaveLength(9);

      await prisma.homeSection.update({ where: { id: section.id }, data: { isActive: false } });
      expect((await get('/')).text).not.toContain('Tes Apparel Terlaris');
      expect((await get('/seksi/test-apparel-terlaris')).status).toBe(404);
    } finally {
      await prisma.homeSection.delete({ where: { id: section.id } });
    }
  });

  it('seksi disembunyikan hilang; jumlah produk mengikuti product_limit', async () => {
    const baru = await prisma.homeSection.findUniqueOrThrow({ where: { key: 'baru' } });
    try {
      await prisma.homeSection.update({ where: { id: baru.id }, data: { productLimit: 8 } });
      let html = (await get('/')).text;
      expect(cardIds(between(html, '<h2>Baru di store</h2>', '</section>'))).toHaveLength(8);
      expect(html).toContain('<div class="sv2-section-more"><a class="btn btn-secondary sv2-more-btn" href="/koleksi/terbaru">Lihat semua</a></div>');

      await prisma.homeSection.update({ where: { id: baru.id }, data: { isActive: false } });
      html = (await get('/')).text;
      expect(html).not.toContain('<h2>Baru di store</h2>');
      expect(html).not.toContain('sv2-section-more');
    } finally {
      await prisma.homeSection.update({ where: { id: baru.id }, data: { productLimit: baru.productLimit, isActive: true } });
    }
  });

  it('Produk terkait diambil dari seksi PRODUCT_RELATED, bukan tampil di beranda', async () => {
    const home = (await get('/')).text;
    expect(home).not.toContain('Produk terkait');
    const cart = (await get('/keranjang')).text;
    expect(cardIds(cart)).toHaveLength(8);
  });
});
