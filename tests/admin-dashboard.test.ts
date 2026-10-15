/** CMS: dashboard (Figma 233:1131) — tab Pesanan/Penjualan, rincian kartu Pesanan, bar atas, kotak masuk. */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { deleteAdmins, get, loggedIn, postForm } from './admin-helpers.js';

const app = createApp();
const admins: number[] = [];

afterAll(async () => {
  await deleteAdmins(admins); // notifikasi ikut terhapus (onDelete: Cascade)
  await prisma.$disconnect();
});

describe('Dashboard', () => {
  it('Admin: tab Pesanan aktif, Penjualan lewat ?tab=penjualan; rincian status pesanan berjumlah sama dengan total', async () => {
    const s = await loggedIn(app, ['ADMIN']);
    admins.push(s.user.id);
    const res = await get(s.agent, '/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="tab-ringkasan"');
    expect(res.text).toMatch(/id="tab-ringkasan"[^>]*aria-selected="true"/);
    expect(res.text).toMatch(/id="panel-penjualan"[^>]*hidden/);
    expect(res.text).toContain('href="/admin?tab&#x3D;penjualan&amp;periode&#x3D;tahun"'); // Handlebars meng-escape = dan &

    // Rincian kartu Pesanan: tombol angka + caret membuka popover berisi 4 status bertitik warna
    expect(res.text).toContain('aria-controls="rincian-pesanan"');
    for (const tone of ['warning', 'info', 'success', 'error']) expect(res.text).toContain(`dot dot-${tone}`);
    const total = await prisma.order.count();
    const counts = [...res.text.matchAll(/<span class="summary-breakdown-label">[^<]+<\/span><strong>([\d.]+)<\/strong>/g)].map((m) => Number(m[1]!.replace(/\./g, '')));
    expect(counts).toHaveLength(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);

    const sales = await get(s.agent, '/admin?tab=penjualan');
    expect(sales.text).toMatch(/id="tab-penjualan"[^>]*aria-selected="true"/);
    expect(sales.text).toMatch(/id="panel-ringkasan"[^>]*hidden/);
    expect(sales.text).not.toMatch(/id="panel-penjualan"[^>]*hidden/);
  });

  it('CS & Gudang tanpa tab Penjualan (?tab=penjualan diabaikan); Barang masuk hanya untuk yang boleh mengubah stok', async () => {
    const cs = await loggedIn(app, ['CS']);
    const gudang = await loggedIn(app, ['GUDANG']);
    admins.push(cs.user.id, gudang.user.id);
    const a = await get(cs.agent, '/admin?tab=penjualan');
    expect(a.status).toBe(200);
    expect(a.text).not.toContain('role="tab"');
    expect(a.text).not.toContain('id="panel-penjualan"');
    expect(a.text).toContain('aria-controls="rincian-pesanan"');
    expect(a.text).not.toContain('href="/admin/stok/masuk"');
    const g = await get(gudang.agent, '/admin');
    expect(g.text).toContain('href="/admin/stok/masuk"');
  });

  it('bar atas: sapaan + badge peran, cari, bantuan, kotak masuk, menu akun (bukan di sidebar)', async () => {
    const s = await loggedIn(app, ['ADMIN']);
    admins.push(s.user.id);
    const res = await get(s.agent, '/admin');
    expect(res.text).toContain(`<h1 class="adm-greeting"><span>Halo, ${s.user.name}</span><span class="badge badge-role">Admin</span></h1>`);
    expect(res.text).toContain('id="topbar-search-panel"');
    expect(res.text).toContain('id="dashboard-search-panel"');
    expect(res.text).toContain('aria-controls="pop-bantuan"');
    expect(res.text).toContain('href="/admin/notifikasi" aria-label="Kotak masuk"');
    expect(res.text).toContain('aria-controls="pop-akun"');
    const sidebar = res.text.slice(res.text.indexOf('<aside class="adm-sidebar"'), res.text.indexOf('</aside>'));
    expect(sidebar).not.toContain('adm-account');
    // Halaman lain: bar atas tanpa sapaan
    const other = await get(s.agent, '/admin/produk');
    expect(other.text).toContain('class="adm-topbar');
    expect(other.text).not.toContain('class="adm-greeting"');
  });
});

describe('Kotak masuk', () => {
  it('daftar notifikasi milik sendiri, lonceng menghitung yang belum dibaca, buka = tandai dibaca, baca semua', async () => {
    const s = await loggedIn(app, ['ADMIN']);
    const other = await loggedIn(app, ['ADMIN']);
    admins.push(s.user.id, other.user.id);
    const base = { type: 'order_paid', body: 'Isi uji' };
    const [n1] = await Promise.all([
      prisma.notification.create({ data: { ...base, adminUserId: s.user.id, title: 'Uji notifikasi satu', url: '/admin/pesanan' } }),
      prisma.notification.create({ data: { ...base, adminUserId: s.user.id, title: 'Uji notifikasi dua', url: 'https://evil.example/admin' } }),
    ]);
    const mine = await prisma.notification.findMany({ where: { adminUserId: s.user.id }, orderBy: { id: 'asc' } });
    const n2 = mine.find((n) => n.title === 'Uji notifikasi dua')!;
    const foreign = await prisma.notification.create({ data: { ...base, adminUserId: other.user.id, title: 'Punya orang lain', url: '/admin' } });

    const list = await get(s.agent, '/admin/notifikasi');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Uji notifikasi satu');
    expect(list.text).not.toContain('Punya orang lain');
    expect(list.text).toContain('aria-label="Kotak masuk, 2 belum dibaca"');

    const open = await get(s.agent, `/admin/notifikasi/${n1!.id}/buka`);
    expect(open.status).toBe(303);
    expect(open.headers.location).toBe('/admin/pesanan');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n1!.id } })).readAt).not.toBeNull();
    // Tujuan di luar /admin tidak diikuti
    expect((await get(s.agent, `/admin/notifikasi/${n2.id}/buka`)).headers.location).toBe('/admin/notifikasi');
    // Notifikasi akun lain tidak bisa dibuka
    expect((await get(s.agent, `/admin/notifikasi/${foreign.id}/buka`)).headers.location).toBe('/admin/notifikasi');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();

    await prisma.notification.updateMany({ where: { adminUserId: s.user.id }, data: { readAt: null } });
    const done = await postForm(s.agent, '/admin/notifikasi/baca-semua', s.csrf);
    expect(done.status).toBe(303);
    expect(await prisma.notification.count({ where: { adminUserId: s.user.id, readAt: null } })).toBe(0);
    expect(await prisma.notification.count({ where: { adminUserId: other.user.id, readAt: null } })).toBe(1);
    expect((await get(s.agent, '/admin/notifikasi')).text).toContain('href="/admin/notifikasi" aria-label="Kotak masuk"');
  });
});
