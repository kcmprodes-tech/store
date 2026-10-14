/** CMS: promo, pengaturan (WhatsApp & ambang stok), pengguna CMS, log perubahan. */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeWhatsapp } from '../src/admin/modules/pengaturan/pengaturan.routes.js';
import { verifyPassword } from '../src/admin/auth/password.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { invalidateStorefront } from '../src/modules/storefront/storefront.service.js';
import { agent as newAgent, createAdmin, deleteAdmins, get, HOST, login, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];
const settingsBefore = await prisma.setting.findMany({ where: { key: { in: ['whatsapp_number', 'low_stock_threshold_default'] } } });

afterAll(async () => {
  await prisma.promoCode.deleteMany({ where: { code: { startsWith: 'UJI' } } });
  await prisma.setting.deleteMany({ where: { key: { in: ['whatsapp_number', 'low_stock_threshold_default'] } } });
  for (const s of settingsBefore) await prisma.setting.create({ data: { key: s.key, value: s.value as object } });
  invalidateStorefront();
  const created = await prisma.adminUser.findMany({ where: { email: { endsWith: '@uji-cms.test' } }, select: { id: true } });
  await deleteAdmins([...admins, ...created.map((u) => u.id)]);
  await prisma.$disconnect();
});

describe('Promo', () => {
  it('Marketing membuat promo persen; kode jadi huruf besar; status otomatis; promo terpakai tidak bisa dihapus', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['MARKETING']);
    admins.push(user.id);
    const res = await postForm(agent, '/admin/promo', csrf, { code: 'uji-hemat10', type: 'PERCENT', value: '10', maxDiscount: '50000', minSpend: '100000', quota: '100', isActive: 'on' });
    expect(res.status).toBe(303);
    const promo = await prisma.promoCode.findUniqueOrThrow({ where: { code: 'UJI-HEMAT10' } });
    expect(promo).toMatchObject({ type: 'PERCENT', value: 10, maxDiscount: 50000, minSpend: 100000, quota: 100 });
    const list = await get(agent, '/admin/promo');
    const start = list.text.indexOf('UJI-HEMAT10</strong>');
    expect(start).toBeGreaterThan(0);
    // formatRupiah memakai spasi tak terputus (U+00A0) antara "Rp" dan angka
    expect(list.text.slice(start, start + 200)).toContain('<td data-label="Potongan">10% (maks. Rp 50.000)</td>');

    const bad = await postForm(agent, '/admin/promo', csrf, { code: 'UJI SPASI', type: 'PERCENT', value: '150', isActive: 'on' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('tanpa spasi');
    expect(bad.text).toContain('Persen maksimal 100.');

    await prisma.promoCode.update({ where: { id: promo.id }, data: { usedCount: 3 } });
    await postForm(agent, `/admin/promo/${promo.id}/hapus`, csrf);
    expect(await prisma.promoCode.count({ where: { id: promo.id } })).toBe(1);
    // kode tidak bisa diganti setelah dipakai
    await postForm(agent, `/admin/promo/${promo.id}`, csrf, { code: 'UJI-GANTI', type: 'PERCENT', value: '15', minSpend: '0', isActive: 'on' });
    expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).code).toBe('UJI-HEMAT10');
  });

  it('CS & Finance hanya melihat promo; Editor tidak boleh membuka', async () => {
    const finance = await loggedIn(app, ['FINANCE']);
    const editor = await loggedIn(app, ['EDITOR']);
    admins.push(finance.user.id, editor.user.id);
    expect((await get(finance.agent, '/admin/promo')).status).toBe(200);
    expect((await postForm(finance.agent, '/admin/promo', finance.csrf, { code: 'UJIFIN', type: 'FIXED', value: '1000', isActive: 'on' })).status).toBe(403);
    expect((await get(editor.agent, '/admin/promo')).status).toBe(403);
  });
});

describe('Pengaturan', () => {
  it('nomor WhatsApp dinormalisasi', () => {
    expect(normalizeWhatsapp('0812-3456-7890')).toEqual({ value: '6281234567890' });
    expect(normalizeWhatsapp('+62 812 3456 7890')).toEqual({ value: '6281234567890' });
    expect(normalizeWhatsapp('')).toEqual({ value: '' });
    expect(normalizeWhatsapp('12345')).toHaveProperty('error');
  });

  it('Admin mengganti nomor WhatsApp → langsung dipakai tombol Butuh bantuan di store', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const res = await postForm(agent, '/admin/pengaturan', csrf, { whatsapp: '0811-0000-1234', lowStock: '7' });
    expect(res.status).toBe(303);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'whatsapp_number' } })).value).toBe('6281100001234');
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'low_stock_threshold_default' } })).value).toBe(7);
    const home = await request(app).get('/').set('User-Agent', 'Mozilla/5.0 (Macintosh) Chrome/140');
    expect(home.text).toContain('https://wa.me/6281100001234');
    expect(await prisma.auditLog.count({ where: { adminUserId: user.id, entityType: 'setting' } })).toBe(1);
  });

  it('hanya Admin yang boleh membuka pengaturan', async () => {
    const { user, agent } = await loggedIn(app, ['EDITOR', 'MARKETING']);
    admins.push(user.id);
    expect((await get(agent, '/admin/pengaturan')).status).toBe(403);
  });
});

describe('Pengguna CMS', () => {
  it('Admin membuat akun Gudang: password sementara tampil sekali, wajib diganti saat login', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const res = await postForm(agent, '/admin/pengguna', csrf, { name: 'Staf Gudang Uji', email: 'gudang1@uji-cms.test', roles: ['GUDANG'] });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const password = /id="temp-password" value="([^"]+)"/.exec(res.text)![1]!;
    expect(password.length).toBeGreaterThanOrEqual(14);
    const created = await prisma.adminUser.findUniqueOrThrow({ where: { email: 'gudang1@uji-cms.test' }, include: { roles: true } });
    expect(created.mustChangePassword).toBe(true);
    expect(created.roles.map((r) => r.role)).toEqual(['GUDANG']);
    expect(await verifyPassword(password, created.passwordHash)).toBe(true);
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'admin_user', entityId: String(created.id) } });
    expect(JSON.stringify(audits)).not.toContain(password);

    const staff = newAgent(app);
    expect((await login(staff, created.email, password)).headers.location).toBe('/admin/akun/password');

    // ubah peran → sesi dicabut
    await postForm(agent, `/admin/pengguna/${created.id}`, csrf, { name: 'Staf Gudang Uji', roles: ['GUDANG', 'CS'], isActive: 'on' });
    expect(await prisma.adminSession.count({ where: { adminUserId: created.id } })).toBe(0);

    // reset password
    const reset = await postForm(agent, `/admin/pengguna/${created.id}/reset-password`, csrf);
    const newPassword = /id="temp-password" value="([^"]+)"/.exec(reset.text)![1]!;
    expect(newPassword).not.toBe(password);
    expect(await verifyPassword(newPassword, (await prisma.adminUser.findUniqueOrThrow({ where: { id: created.id } })).passwordHash)).toBe(true);

    // email ganda ditolak
    const dup = await postForm(agent, '/admin/pengguna', csrf, { name: 'Lain', email: 'gudang1@uji-cms.test', roles: ['CS'] });
    expect(dup.status).toBe(400);
    expect(dup.text).toContain('sudah punya akun CMS');
  });

  it('Admin tidak bisa menonaktifkan diri sendiri atau mencabut Admin terakhir', async () => {
    const { user, agent, csrf } = await loggedIn(app, ['ADMIN']);
    admins.push(user.id);
    const self = await postForm(agent, `/admin/pengguna/${user.id}`, csrf, { name: user.name, roles: ['ADMIN'] });
    // checkbox isActive tidak dikirim → mencoba menonaktifkan diri sendiri
    expect(self.status).toBe(400);
    expect(self.text).toContain('tidak bisa menonaktifkan akun sendiri');

    // Simulasikan hanya satu Admin aktif: nonaktifkan sementara Admin lain
    const others = await prisma.adminUser.findMany({ where: { id: { not: user.id }, isActive: true, roles: { some: { role: 'ADMIN' } } }, select: { id: true } });
    await prisma.adminUser.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      const drop = await postForm(agent, `/admin/pengguna/${user.id}`, csrf, { name: user.name, roles: ['EDITOR'], isActive: 'on' });
      expect(drop.status).toBe(400);
      expect(drop.text).toContain('minimal satu Admin aktif');
    } finally {
      await prisma.adminUser.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
  });

  it('non-Admin tidak bisa membuka pengguna CMS', async () => {
    const { user, agent } = await loggedIn(app, ['FINANCE']);
    admins.push(user.id);
    expect((await get(agent, '/admin/pengguna')).status).toBe(403);
  });
});

describe('Log perubahan', () => {
  it('Admin melihat semua log dengan detail sebelum → sesudah; peran lain hanya miliknya', async () => {
    const admin = await loggedIn(app, ['ADMIN']);
    const editor = await loggedIn(app, ['EDITOR']);
    admins.push(admin.user.id, editor.user.id);
    const apparel = await prisma.category.findUniqueOrThrow({ where: { slug: 'drinkware' } });
    await postForm(editor.agent, `/admin/kategori/${apparel.id}/tampil`, editor.csrf);
    await postForm(editor.agent, `/admin/kategori/${apparel.id}/tampil`, editor.csrf);

    const all = await get(admin.agent, `/admin/log?entitas=category&id=${apparel.id}`);
    expect(all.status).toBe(200);
    expect(all.text).toContain(editor.user.email);
    expect(all.text).toContain('<td class="mono small">isActive</td><td class="log-value">Ya</td><td class="log-value">Tidak</td>');

    const own = await get(editor.agent, '/admin/log');
    expect(own.text).toContain('hanya aktivitas Anda');
    expect(own.text).not.toContain(admin.user.email);
    // Filter pelaku diabaikan untuk non-Admin
    const sneaky = await get(editor.agent, `/admin/log?pelaku=${admin.user.id}`);
    expect(sneaky.text).not.toContain(admin.user.email);
  });
});

describe('Menu samping', () => {
  it('grup default terbuka; dilipat lewat cookie skc_admin_nav; grup halaman aktif tetap terbuka', async () => {
    const user = await createAdmin(['ADMIN']);
    admins.push(user.id);
    const res = await login(newAgent(app), user.email);
    const session = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('skc_admin='))!.split(';')[0]!;
    const page = (url: string, nav?: string) =>
      request(app).get(url).set('Host', HOST).set('Cookie', nav === undefined ? session : `${session}; skc_admin_nav=${nav}`);
    const isOpen = (html: string, key: string) => new RegExp(`data-nav-group="${key}" open`).test(html);

    const plain = await page('/admin');
    for (const key of ['pesanan', 'katalog', 'tampilan', 'operasional', 'sistem']) expect(isOpen(plain.text, key)).toBe(true);

    const folded = await page('/admin', 'katalog,sistem,<script>');
    expect(isOpen(folded.text, 'katalog')).toBe(false);
    expect(isOpen(folded.text, 'sistem')).toBe(false);
    expect(isOpen(folded.text, 'pesanan')).toBe(true);

    const onProduct = await page('/admin/produk', 'katalog');
    expect(isOpen(onProduct.text, 'katalog')).toBe(true);
  });
});

describe('Dashboard', () => {
  it('kartu ringkasan mengikuti hak akses: Admin 4 kartu, Editor hanya Produk & Kategori', async () => {
    const admin = await loggedIn(app, ['ADMIN']);
    admins.push(admin.user.id);
    const a = await get(admin.agent, '/admin');
    for (const key of ['produk', 'kategori', 'promo', 'pesanan']) expect(a.text).toContain(`id="ringkasan-${key}"`);
    for (const text of ['tayang', 'unggulan', 'berlaku sekarang', 'nonaktif / berakhir', 'pendapatan', 'belum dibayar', 'aria-label="Produk baru"']) {
      expect(a.text).toContain(text);
    }
    const editor = await loggedIn(app, ['EDITOR']);
    admins.push(editor.user.id);
    const e = await get(editor.agent, '/admin');
    expect(e.text).toContain('id="ringkasan-produk"');
    expect(e.text).toContain('id="ringkasan-kategori"');
    expect(e.text).toContain('Kategori baru');
    expect(e.text).not.toContain('id="ringkasan-promo"');
    expect(e.text).not.toContain('id="ringkasan-pesanan"');
    // Pesanan terbaru (5, + Lihat semua) untuk peran yang bisa melihat pesanan; Editor tetap melihat Draft & terjadwal
    expect(a.text).toContain('Pesanan terbaru');
    expect(a.text).toContain('href="/admin/pesanan?status=semua"');
    expect((a.text.match(/class="recent-order-icon"/g) ?? []).length).toBeLessThanOrEqual(5);
    expect(e.text).not.toContain('Pesanan terbaru');
    expect(e.text).toContain('Draft & terjadwal');
  });
});

