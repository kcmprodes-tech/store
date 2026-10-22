/** Login, logout, dan ganti password akun CMS. */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../audit.js';
import { handle, parseForm, redirectWith } from '../http.js';
import { isProd } from '../../config/env.js';
import { isLocalRequest } from '../../lib/security.js';
import { dummyPasswordHash, hashPassword, needsRehash, passwordProblem, verifyPassword } from './password.js';
import { clientIp, createSession, destroySession, revokeSessions } from './session.js';
import { clearLoginFailures, loginBlockedFor, registerLoginAttempt } from './throttle.js';

export const authRouter = Router();

/** Tujuan setelah login: hanya halaman di dalam /admin. */
function safeNext(value: unknown) {
  return typeof value === 'string' && /^\/admin(\/[^/\\]|$|\?)/.test(value) && !value.includes('//') ? value : '/admin';
}

const loginSchema = z.object({
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().email('Email tidak valid.').max(191)),
  password: z.string().min(1, 'Password wajib diisi.').max(200),
});

authRouter.get(
  '/login',
  handle(async (req, res) => {
    if (req.admin) return res.redirect(303, safeNext(req.query.next));
    await res.renderAdmin('login', { layout: 'auth', pageTitle: 'Login', next: safeNext(req.query.next) });
  }),
);

/** Lupa password: password CMS hanya bisa direset Admin CMS (menu Pengguna CMS). */
authRouter.get(
  '/lupa-password',
  handle(async (req, res) => {
    if (req.admin) return res.redirect(303, '/admin');
    await res.renderAdmin('lupa-password', { layout: 'auth', pageTitle: 'Lupa password' });
  }),
);

authRouter.post(
  '/login',
  handle(async (req, res) => {
    const next = safeNext(req.body?.next);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 191) : '';
    const fail = (message: string, status = 401) =>
      res.renderAdmin('login', { layout: 'auth', pageTitle: 'Login', next, email, error: message }, status);

    const parsed = parseForm(loginSchema, req.body);
    if (!parsed.ok) return fail(parsed.errors.email ?? parsed.errors.password ?? 'Periksa email dan password.', 400);

    const ip = clientIp(req) ?? 'unknown';
    const wait = loginBlockedFor(ip, email);
    if (wait > 0) {
      await audit(prisma, req, { action: 'login.throttled', entityType: 'auth', entityLabel: email });
      return fail(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.`, 429);
    }
    // dicatat sebelum password dicek: request paralel tidak bisa melewati batas bersamaan
    registerLoginAttempt(ip, email);

    const found = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
    // akun uji (*@cms.test) hanya untuk development dari mesin ini: di produksi dan lewat tunnel/internet
    // diperlakukan seperti tidak ada
    const testOnly = found?.email.endsWith('@cms.test') && (isProd || !isLocalRequest(req));
    const user = testOnly ? null : found;
    // Email tak dikenal tetap diperiksa ke hash dummy supaya waktu respons sama.
    const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !valid || !user.isActive) {
      await audit(prisma, req, { action: 'login.fail', entityType: 'auth', entityLabel: email });
      return fail('Email atau password salah, atau akun tidak aktif.');
    }

    clearLoginFailures(ip, email);
    await createSession(req, res, user.id);
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // parameter hash dinaikkan → hash lama diperbarui diam-diam saat login berhasil
        ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
      },
    });
    await audit(prisma, req, { action: 'login', entityType: 'auth', entityId: user.id, entityLabel: user.email, actor: user });
    res.redirect(303, user.mustChangePassword ? '/admin/akun/password' : next);
  }),
);

authRouter.post(
  '/logout',
  handle(async (req, res) => {
    if (req.admin) await audit(prisma, req, { action: 'logout', entityType: 'auth', entityId: req.admin.id, entityLabel: req.admin.email });
    await destroySession(req, res);
    res.redirect(303, '/admin/login');
  }),
);

// ───────────── Ganti password (wajib saat login pertama) ─────────────

const passwordSchema = z
  .object({
    current: z.string().min(1, 'Password sekarang wajib diisi.').max(200),
    password: z.string().max(200),
    confirm: z.string().max(200),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Konfirmasi password tidak sama.' });

/** Halaman ganti password ada sebelum pemeriksaan login umum, jadi dijaga sendiri. */
function requireSession(req: Request, res: Response) {
  if (req.admin) return true;
  if (req.method === 'GET') res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  else res.status(401).type('text').send('Silakan login dulu.');
  return false;
}

authRouter.get(
  '/akun/password',
  handle(async (req, res) => {
    if (!requireSession(req, res)) return;
    await res.renderAdmin('account-password', { pageTitle: 'Ganti password', forced: req.admin!.mustChangePassword });
  }),
);

authRouter.post(
  '/akun/password',
  handle(async (req, res) => {
    if (!requireSession(req, res)) return;
    const admin = req.admin!;
    const render = (errors: Record<string, string>) =>
      res.renderAdmin('account-password', { pageTitle: 'Ganti password', forced: admin.mustChangePassword, errors }, 400);

    const parsed = parseForm(passwordSchema, req.body);
    if (!parsed.ok) return render(parsed.errors);
    const problem = passwordProblem(parsed.data.password, admin.email);
    if (problem) return render({ password: problem });

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await verifyPassword(parsed.data.current, user.passwordHash))) return render({ current: 'Password sekarang salah.' });
    if (await verifyPassword(parsed.data.password, user.passwordHash)) return render({ password: 'Password baru harus berbeda dari yang sekarang.' });

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: false } });
      await audit(tx, req, { action: 'password', entityType: 'admin_user', entityId: admin.id, entityLabel: admin.email });
    });
    // semua sesi lama dicabut (termasuk yang sedang dipakai), lalu sesi baru dengan token baru
    await revokeSessions(admin.id);
    await createSession(req, res, admin.id);
    redirectWith(res, '/admin', 'success', 'Password berhasil diganti. Sesi di perangkat lain sudah dikeluarkan.');
  }),
);
