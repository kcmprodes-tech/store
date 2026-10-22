/**
 * Regresi keamanan (audit OWASP 15 Okt 2026): header store, halaman error, CSRF ketat, batas login per akun,
 * akun uji hanya dari localhost, validasi link CMS, dan password lemah.
 */
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { passwordProblem } from '../src/admin/auth/password.js';
import { resetLoginThrottle } from '../src/admin/auth/throttle.js';
import { isSafeUrl } from '../src/admin/http.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { agent, createAdmin, deleteAdmins, HOST, login, ORIGIN, PASSWORD } from './admin-helpers.js';

const app = createApp();
const created: { id: number; email: string }[] = [];

afterEach(() => resetLoginThrottle());
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { action: { in: ['login.fail', 'login.throttled'] }, entityLabel: { in: created.map((u) => u.email) } } });
  await deleteAdmins(created.map((u) => u.id));
  await prisma.$disconnect();
});

describe('header & halaman error store', () => {
  it('halaman store memasang CSP dan header keamanan', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CMS tetap memakai CSP-nya sendiri', async () => {
    const res = await request(app).get('/admin/login');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('404 tidak memantulkan alamat, URL rusak = 400 tanpa stack trace lewat proxy', async () => {
    const notFound = await request(app).get('/tidak-ada-<script>');
    expect(notFound.status).toBe(404);
    expect(notFound.text).not.toContain('script');
    const bad = await request(app).get('/produk/%ZZ').set('X-Forwarded-For', '203.0.113.9');
    expect(bad.status).toBe(400);
    expect(bad.text).toBe('Permintaan tidak valid.');
    expect(bad.text).not.toMatch(/at |\/Users\//);
  });
});

describe('CMS: CSRF & halaman tanpa login', () => {
  it('ganti password tanpa login diarahkan ke login (bukan error 500)', async () => {
    const res = await request(app).get('/admin/akun/password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('/admin/login');
  });

  it('origin lain ditolak meski memalsukan X-Forwarded-Host, juga beda skema', async () => {
    const forged = await request(app)
      .post('/admin/login')
      .set('Host', HOST)
      .set('Origin', 'http://evil.example')
      .set('X-Forwarded-Host', 'evil.example')
      .type('form')
      .send({ email: 'x@y.z', password: 'salah' });
    expect(forged.status).toBe(403);
    const scheme = await request(app).post('/admin/login').set('Host', HOST).set('Origin', `https://${HOST}`).type('form').send({ email: 'x@y.z', password: 'salah' });
    expect(scheme.status).toBe(403);
    const crossSite = await request(app)
      .post('/admin/login')
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'cross-site')
      .type('form')
      .send({ email: 'x@y.z', password: 'salah' });
    expect(crossSite.status).toBe(403);
  });
});

describe('CMS: login', () => {
  it('akun uji *@cms.test tidak bisa login lewat tunnel/proxy, hanya dari localhost', async () => {
    const user = await createAdmin(['ADMIN']);
    created.push(user);
    const viaTunnel = await agent(app)
      .post('/admin/login')
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', '198.51.100.7')
      .type('form')
      .send({ email: user.email, password: PASSWORD, next: '/admin' });
    expect(viaTunnel.status).toBe(401);
    const local = await login(agent(app), user.email);
    expect(local.status).toBe(303);
    expect(local.headers.location).toBe('/admin');
  });

  it('satu akun dibatasi 20 percobaan walau IP berganti-ganti', async () => {
    const user = await createAdmin(['EDITOR']);
    created.push(user);
    const tryFrom = (i: number, password: string) =>
      request(app)
        .post('/admin/login')
        .set('Host', HOST)
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .type('form')
        .send({ email: user.email, password });
    for (let i = 1; i <= 20; i++) expect((await tryFrom(i, 'salah-terus-123')).status).toBe(401);
    const blocked = await tryFrom(99, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Terlalu banyak percobaan');
    const logged = await prisma.auditLog.count({ where: { action: 'login.fail', entityLabel: user.email } });
    expect(logged).toBeGreaterThanOrEqual(20);
  });

  it('sesi: cookie Secure saat diakses lewat HTTPS, berumur maksimal 12 jam', async () => {
    const user = await createAdmin(['EDITOR']);
    created.push(user);
    const res = await request(app)
      .post('/admin/login')
      .set('Host', HOST)
      .set('Origin', `https://${HOST}`)
      .set('X-Forwarded-Proto', 'https')
      .type('form')
      .send({ email: 'bukan-akun@contoh.id', password: 'salah' });
    expect(res.status).toBe(401); // origin https cocok karena proxy tepercaya bilang https
    const ok = await login(agent(app), user.email);
    const cookie = String(ok.headers['set-cookie']);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeLessThanOrEqual(12 * 3600);
    expect(cookie).toContain('HttpOnly');
  });
});

describe('validasi', () => {
  it('link CMS menolak javascript:, kutip, spasi/kontrol, dan //', () => {
    for (const bad of ['javascript:alert(1)', '/x" onerror="alert(1)', '/\t/evil.com', '//evil.com', '/\\evil.com', 'http://contoh.id', 'https://a.b/"><svg onload=1>', '/a b'])
      expect(isSafeUrl(bad), bad).toBe(false);
    for (const good of ['/produk/kaos-hitam', '/produk?category=merchandise&sub=apparel', 'https://plus.kompas.com/', '/uploads/abc.webp'])
      expect(isSafeUrl(good), good).toBe(true);
  });

  it('password umum ditolak, kalimat panjang diterima', () => {
    for (const weak of ['password123', 'Kompas2026!', '1234567890', 'aaaaaaaaaaaa', 'qwerty12345']) expect(passwordProblem(weak), weak).not.toBeNull();
    expect(passwordProblem('kopi-pagi-di-palmerah')).toBeNull();
  });
});
