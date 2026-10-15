/** CMS: login, sesi, CSRF, pembatasan percobaan, ganti password, header keamanan. */
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { resetLoginThrottle } from '../src/admin/auth/throttle.js';
import { verifyPassword } from '../src/admin/auth/password.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { agent, createAdmin, csrfToken, deleteAdmins, get, login, PASSWORD, post, postForm } from './admin-helpers.js';

const app = createApp();
const created: number[] = [];
const track = <T extends { id: number }>(u: T) => (created.push(u.id), u);

afterEach(() => resetLoginThrottle());
afterAll(async () => {
  await deleteAdmins(created);
  await prisma.$disconnect();
});

describe('login', () => {
  it('halaman CMS tanpa login diarahkan ke /admin/login', async () => {
    const res = await request(app).get('/admin/produk?status=draft');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/login?next=%2Fadmin%2Fproduk%3Fstatus%3Ddraft');
    const page = await request(app).get('/admin/login');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Siap-siap beresin kerjaan hari ini');
    expect(page.text).toContain('href="/admin/lupa-password"');
    expect(page.text).toContain('src="/cms/login/ilustrasi.png"');
  });

  it('lupa password: info reset oleh Admin; yang sudah login diarahkan ke dashboard', async () => {
    const page = await request(app).get('/admin/lupa-password');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Pengguna CMS');
    expect(page.text).toContain('href="/admin/login"');
    const user = track(await createAdmin(['CS']));
    const a = agent(app);
    await login(a, user.email);
    const logged = await get(a, '/admin/lupa-password');
    expect(logged.status).toBe(303);
    expect(logged.headers.location).toBe('/admin');
  });

  it('password salah ditolak, password benar masuk ke Dashboard dan tercatat di log', async () => {
    const user = track(await createAdmin(['EDITOR']));
    const a = agent(app);
    const wrong = await login(a, user.email, 'salah-sekali-123');
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain('Email atau password salah');

    const ok = await login(a, user.email);
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe('/admin');
    expect(ok.headers['set-cookie']?.join(';')).toMatch(/skc_admin=[^;]+; Max-Age=\d+; Path=\/admin; Expires=[^;]+; HttpOnly; SameSite=Lax/);
    const dash = await get(a, '/admin');
    expect(dash.status).toBe(200);
    expect(dash.text).toContain(`Halo, ${user.name}`);
    expect(await prisma.auditLog.count({ where: { adminUserId: user.id, action: 'login' } })).toBe(1);
  });

  it('email tidak terdaftar & akun nonaktif mendapat pesan yang sama', async () => {
    const inactive = track(await createAdmin(['ADMIN'], { isActive: false }));
    const a = agent(app);
    const unknown = await login(a, 'tidak-ada@cms.test');
    const off = await login(a, inactive.email);
    expect(unknown.status).toBe(401);
    expect(off.status).toBe(401);
    expect(off.text).toContain('Email atau password salah, atau akun tidak aktif.');
  });

  it('setelah 5 kali gagal, percobaan berikutnya ditahan (walau password benar)', async () => {
    const user = track(await createAdmin(['ADMIN']));
    const a = agent(app);
    for (let i = 0; i < 5; i++) expect((await login(a, user.email, `salah-${i}-xxxxxx`)).status).toBe(401);
    const blocked = await login(a, user.email);
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Terlalu banyak percobaan');
  });

  it('login dari origin lain ditolak (CSRF)', async () => {
    const user = track(await createAdmin(['ADMIN']));
    const res = await request(app)
      .post('/admin/login')
      .set('Host', 'cms.test')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    const noOrigin = await request(app).post('/admin/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(noOrigin.status).toBe(403);
  });

  it('tujuan setelah login hanya boleh di dalam /admin', async () => {
    const user = track(await createAdmin(['ADMIN']));
    const res = await post(agent(app), '/admin/login').type('form').send({ email: user.email, password: PASSWORD, next: '//evil.example/admin' });
    expect(res.headers.location).toBe('/admin');
  });
});

describe('sesi & CSRF', () => {
  it('POST tanpa token CSRF ditolak; logout dengan token mencabut sesi', async () => {
    const user = track(await createAdmin(['ADMIN']));
    const a = agent(app);
    await login(a, user.email);
    const csrf = await csrfToken(a);

    const noToken = await post(a, '/admin/logout').type('form').send({});
    expect(noToken.status).toBe(403);
    expect(await prisma.adminSession.count({ where: { adminUserId: user.id } })).toBe(1);

    const out = await postForm(a, '/admin/logout', csrf);
    expect(out.status).toBe(303);
    expect(await prisma.adminSession.count({ where: { adminUserId: user.id } })).toBe(0);
    expect((await get(a, '/admin')).status).toBe(303);
  });

  it('akun yang dinonaktifkan langsung keluar', async () => {
    const user = track(await createAdmin(['ADMIN']));
    const a = agent(app);
    await login(a, user.email);
    expect((await get(a, '/admin')).status).toBe(200);
    await prisma.adminUser.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await get(a, '/admin')).status).toBe(303);
  });
});

describe('ganti password', () => {
  it('akun baru wajib ganti password dulu; password lama tidak berlaku lagi & sesi lain dicabut', async () => {
    const user = track(await createAdmin(['EDITOR'], { mustChangePassword: true }));
    const other = agent(app);
    await login(other, user.email);

    const a = agent(app);
    const res = await login(a, user.email);
    expect(res.headers.location).toBe('/admin/akun/password');
    expect((await get(a, '/admin')).headers.location).toBe('/admin/akun/password');

    const page = await get(a, '/admin/akun/password');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)![1]!;
    const short = await postForm(a, '/admin/akun/password', csrf, { current: PASSWORD, password: 'pendek', confirm: 'pendek' });
    expect(short.status).toBe(400);
    expect(short.text).toContain('Password minimal 10 karakter.');

    const done = await postForm(a, '/admin/akun/password', csrf, {
      current: PASSWORD,
      password: 'Kalimat-Baru-Yang-Panjang',
      confirm: 'Kalimat-Baru-Yang-Panjang',
    });
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe('/admin');
    expect((await get(a, '/admin')).status).toBe(200);
    expect((await get(other, '/admin')).status).toBe(303); // sesi lain dicabut

    const fresh = await prisma.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.mustChangePassword).toBe(false);
    expect(await verifyPassword('Kalimat-Baru-Yang-Panjang', fresh.passwordHash)).toBe(true);
    expect(fresh.passwordHash).not.toContain('Kalimat');
  });
});

describe('keamanan halaman CMS', () => {
  it('header keamanan, noindex, dan robots.txt', async () => {
    const res = await request(app).get('/admin/login');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    expect((await request(app).get('/robots.txt')).text).toContain('Disallow: /admin');
  });

  it('manifest PWA & service worker', async () => {
    const manifest = await request(app).get('/admin/manifest.webmanifest');
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    const json = JSON.parse(manifest.text);
    expect(json.scope).toBe('/admin/');
    expect(json.start_url).toBe('/admin/');
    expect(json.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    const sw = await request(app).get('/admin/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['content-type']).toContain('javascript');
  });
});
