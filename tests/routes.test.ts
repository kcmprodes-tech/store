/**
 * Tes integrasi storefront. Butuh MySQL dev yang sudah di-seed (`npm run db:seed`).
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = createApp();
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

const APPAREL = 'kaos-hitam-ekslusif-kompascom-sandang-pangan-papan-kebenaran';
const VIDEO = 'hamzah-muhammad-bangun-gangguanmu-dengan-membaca-beginu-5-tahun';

const PAGES = [
  '/',
  '/produk',
  '/produk?category=merchandise&sub=apparel',
  '/koleksi/terlaris',
  '/koleksi/diskon',
  '/cari?q=kaos',
  '/cari?q=tidak-ada-hasil',
  '/produk/source-18',
  `/produk/${APPAREL}`,
  `/produk/${VIDEO}`,
  '/wishlist',
  '/keranjang',
  '/checkout',
  '/pembayaran',
  '/pembayaran/SKC-260626-H7Q4MP',
  '/pembayaran/berhasil',
  '/pembayaran/SKC-260626-H7Q4MP/berhasil',
  '/pesanan',
  '/pesanan/SKC-260626-H7Q4MP',
  '/pesanan/diambil',
  '/pesanan/SKC-260626-H7Q4MP/diambil',
  '/akun',
];

afterAll(async () => {
  await prisma.$disconnect();
});

describe('semua halaman bisa dibuka', () => {
  for (const [platform, ua, marker] of [
    ['desktop', DESKTOP_UA, 'store-v2-header'],
    ['mobile', MOBILE_UA, 'sv2m-header'],
  ] as const) {
    it.each(PAGES)(`${platform} %s → 200 dengan template ${platform}`, async (path) => {
      const res = await request(app).get(path).set('User-Agent', ua);
      expect(res.status).toBe(200);
      expect(res.text).toContain(marker);
      expect(res.text).not.toMatch(/href="[a-z-]+\.html/); // tidak ada link prototipe yang tersisa
    });
  }
});

describe('data dari database', () => {
  it('beranda menampilkan seksi kurasi', async () => {
    const res = await request(app).get('/').set('User-Agent', DESKTOP_UA);
    expect(res.text.match(/class="product-card"/g)?.length).toBe(24); // 4 + 4 + 4 + 12
  });

  it('detail produk bervarian merender chip dari product_variants', async () => {
    const res = await request(app).get('/produk/source-18').set('User-Agent', DESKTOP_UA);
    expect(res.text.match(/data-product-format="/g)?.length).toBe(4);
    expect(res.text).toContain('data-product-format="Basic" data-price="50000" data-price-original="100000" data-discount="50" data-stock="0"');
    // Detail Produk: label | : | nilai (titik dua sejajar)
    expect(res.text).toContain('<span class="pdp-spec-label">SKU</span><span class="pdp-spec-sep">:</span><span class="pdp-spec-value">STORE-PESTABOLA-634812</span>');
    expect(res.text).toContain('<span class="pdp-spec-full">Termasuk akses Kompas Digital Premium</span>');
  });

  it('detail apparel membawa matriks stok tersedia per warna × ukuran', async () => {
    const res = await request(app).get(`/produk/${APPAREL}`).set('User-Agent', DESKTOP_UA);
    const json = /<script type="application\/json" data-apparel-data>([\s\S]*?)<\/script>/.exec(res.text)?.[1];
    const [product] = JSON.parse(json!);
    expect(product.id).toBe(APPAREL);
    expect(product.stock.Grey.XXXL).toBe(0);
    expect(product.stock.Hitam.S).toBe(5);
    expect(product.price_disc).toBe('120.000');
  });

  it('perubahan stok di database langsung terlihat di halaman', async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'STORE-PESTABOLA-634812-BUNDLING-PLUS' } });
    const level = await prisma.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id } });
    try {
      await prisma.inventoryLevel.update({
        where: { variantId_locationId: { variantId: variant.id, locationId: level.locationId } },
        data: { reserved: 4 },
      });
      const res = await request(app).get('/produk/source-18').set('User-Agent', DESKTOP_UA);
      expect(res.text).toContain('data-product-format="Bundling Plus" data-price="99000" data-price-original="125000" data-discount="21" data-stock="20"');
    } finally {
      await prisma.inventoryLevel.update({
        where: { variantId_locationId: { variantId: variant.id, locationId: level.locationId } },
        data: { reserved: level.reserved },
      });
    }
  });

  it('filter kategori & pencarian', async () => {
    const apparel = await request(app).get('/produk?category=merchandise&sub=apparel').set('User-Agent', DESKTOP_UA);
    expect(apparel.text.match(/class="product-card"/g)?.length).toBe(9);
    const search = await request(app).get('/cari?q=kaos').set('User-Agent', DESKTOP_UA);
    expect(search.text).toContain('Kaos Hitam Ekslusif');
  });

  it('koleksi merender judul & ikon dari database dan menandai mode filter server', async () => {
    const res = await request(app).get('/koleksi/diskon').set('User-Agent', DESKTOP_UA);
    expect(res.text).toContain('data-tab-server="diskon"');
    expect(res.text).toContain('<h1 data-tab-title>Diskon Spesial</h1>');
    expect(res.text).toContain('src="/images/store-v2/cat-diskon-spesial.png"');
    const missing = await request(app).get('/koleksi/tidak-ada');
    expect(missing.status).toBe(404);
  });

  it('koleksi Terbaru = produk tayang 30 hari terakhir, urut waktu tayang terbaru', async () => {
    const ids = (html: string) => [...new Set([...html.matchAll(/data-select-product="([^"]+)"/g)].map((m) => m[1]))];
    const since = new Date(Date.now() - 30 * 86400_000);
    const expected = await prisma.product.findMany({
      where: { status: 'PUBLISHED', publishedAt: { gte: since, lte: new Date() } },
      orderBy: { publishedAt: 'desc' },
      select: { slug: true },
    });
    const res = await request(app).get('/koleksi/terbaru').set('User-Agent', DESKTOP_UA);
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(res.text)).toEqual(expected.map((p) => p.slug));

    // produk lama yang baru ditayangkan ulang langsung muncul paling atas
    const old = await prisma.product.findFirstOrThrow({ where: { publishedAt: { lt: since } }, orderBy: { publishedAt: 'desc' } });
    try {
      await prisma.product.update({ where: { id: old.id }, data: { publishedAt: new Date(Date.now() - 60_000) } });
      const again = await request(app).get('/koleksi/terbaru').set('User-Agent', DESKTOP_UA);
      expect(ids(again.text)[0]).toBe(old.slug);
    } finally {
      await prisma.product.update({ where: { id: old.id }, data: { publishedAt: old.publishedAt } });
    }
  });

  it('produk dengan jadwal tayang di masa depan belum tampil', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'source-18' } });
    try {
      await prisma.product.update({ where: { id: product.id }, data: { publishedAt: new Date(Date.now() + 86400_000) } });
      expect((await request(app).get('/produk/source-18')).status).toBe(404);
      const list = await request(app).get('/produk').set('User-Agent', DESKTOP_UA);
      expect(list.text).not.toContain('data-select-product="source-18"');
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { publishedAt: product.publishedAt } });
    }
  });

  it('kartu pesanan Dikirim punya tombol "Pesanan selesai"', async () => {
    for (const ua of [DESKTOP_UA, MOBILE_UA]) {
      const res = await request(app).get('/akun').set('User-Agent', ua);
      expect(res.text).toMatch(/status=shipped">Detail pesanan<\/a><button class="btn btn-primary" type="button" data-order-complete>Pesanan selesai<\/button>/);
    }
  });

  it('proteksi paket disembunyikan dulu, dan tampil lagi kalau diaktifkan di pengaturan', async () => {
    const hidden = await request(app).get('/checkout').set('User-Agent', DESKTOP_UA);
    expect(hidden.text).not.toContain('Proteksi paket');
    expect(hidden.text).toContain('<span>Total</span>\n              <strong>Rp\u00a059.000</strong>');
    try {
      await prisma.setting.update({ where: { key: 'protection_fee_enabled' }, data: { value: true } });
      const shown = await request(app).get('/checkout').set('User-Agent', MOBILE_UA);
      expect(shown.text).toContain('<span>Proteksi paket</span><strong>Rp\u00a03.000</strong>');
      expect(shown.text).toContain('<strong data-pay-bar-total>Rp62.000</strong>');
    } finally {
      await prisma.setting.update({ where: { key: 'protection_fee_enabled' }, data: { value: false } });
    }
  });

  it('Beli Lagi membuka halaman detail produk', async () => {
    const res = await request(app).get('/akun').set('User-Agent', DESKTOP_UA);
    expect(res.text.match(/<a class="btn btn-primary" href="\/produk\/source-18" data-buy-again>Beli Lagi<\/a>/g)?.length).toBe(2);
    expect(res.text).not.toContain('GRI-');
  });

  it('produk VIK / Event dengan link luar langsung diarahkan keluar', async () => {
    const vik = await prisma.product.findFirstOrThrow({ where: { type: 'DIGITAL_CONTENT' } });
    try {
      await prisma.product.update({ where: { id: vik.id }, data: { externalUrl: 'https://vik.kompas.com/contoh' } });
      const detail = await request(app).get(`/produk/${vik.slug}`);
      expect(detail.status).toBe(302);
      expect(detail.headers.location).toBe('https://vik.kompas.com/contoh');
      const list = await request(app).get('/produk?category=digital&sub=konten-premium').set('User-Agent', DESKTOP_UA);
      expect(list.text).toContain('href="https://vik.kompas.com/contoh"');
    } finally {
      await prisma.product.update({ where: { id: vik.id }, data: { externalUrl: vik.externalUrl } });
    }
  });

  it('produk membership diarahkan ke halaman langganan eksternal', async () => {
    const res = await request(app).get('/produk/premium-kompascom-max');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('plus.kompas.com');
  });

  it('produk yang tidak ada → 404', async () => {
    const res = await request(app).get('/produk/tidak-ada');
    expect(res.status).toBe(404);
  });
});

describe('redirect URL prototipe', () => {
  it.each([
    ['/koleksi.html?tab=diskon', '/koleksi/diskon'],
    ['/semua-produk.html?category=buku', '/produk?category=buku'],
    [`/detail-apparel.html?product=${APPAREL}`, `/produk/${APPAREL}`],
    ['/order-detail.html?id=SKC-1&status=completed', '/pesanan/SKC-1?status=completed'],
    ['/payment-success.html?id=SKC-1', '/pembayaran/SKC-1/berhasil'],
    ['/category.html?category=bundling', '/produk'],
  ])('%s → %s', async (from, to) => {
    const res = await request(app).get(from);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });
});

describe('pilih template', () => {
  it('?device= memaksa template dan disimpan di cookie', async () => {
    const res = await request(app).get('/?device=mobile').set('User-Agent', DESKTOP_UA);
    expect(res.text).toContain('sv2m-header');
    expect(res.headers['set-cookie']?.[0]).toContain('device=mobile');
  });
});
