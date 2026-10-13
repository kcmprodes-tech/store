/**
 * CMS Store Kompas.com di /admin.
 * Urutan middleware: header keamanan → body parser → sesi → CSRF → halaman publik (login, PWA) →
 * wajib login → modul → halaman error.
 */
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { isProd } from '../config/env.js';
import { authRouter } from './auth/routes.js';
import { loadSession } from './auth/session.js';
import { HttpError, handle } from './http.js';
import { adminRenderMiddleware } from './render.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { kategoriRouter } from './modules/kategori/kategori.routes.js';
import { menuRouter } from './modules/menu/menu.routes.js';
import { bannerRouter } from './modules/kurasi/banner.routes.js';
import { feedApiRouter } from './modules/kurasi/feed.js';
import { koleksiRouter } from './modules/kurasi/koleksi.routes.js';
import { seksiRouter } from './modules/kurasi/seksi.routes.js';
import { uploadRouter } from './modules/upload/upload.routes.js';

export const adminRouter = Router();

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  });
  next();
};

/** Sesi login (kalau ada) → req.admin. */
const sessionLoader: RequestHandler = (req, _res, next) => {
  loadSession(req)
    .then((admin) => {
      if (admin) req.admin = admin;
      next();
    })
    .catch(next);
};

function sameOrigin(source: string | undefined, host: string | undefined) {
  if (!source || !host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function tokensEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * CSRF: setiap request yang mengubah data harus berasal dari origin yang sama (termasuk login),
 * dan kalau sudah login wajib membawa token sesi (field _csrf atau header X-CSRF-Token).
 */
const csrfProtect: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const host = req.get('x-forwarded-host') ?? req.get('host');
  if (!sameOrigin(req.get('origin') ?? req.get('referer'), host)) {
    return next(new HttpError(403, 'Permintaan ditolak karena asalnya tidak dikenali. Muat ulang halaman lalu coba lagi.'));
  }
  if (req.admin) {
    const token = req.get('x-csrf-token') ?? (typeof req.body?._csrf === 'string' ? req.body._csrf : '');
    if (!token || !tokensEqual(token, req.admin.csrfToken)) {
      return next(new HttpError(403, 'Formulir sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.'));
    }
  }
  next();
};

/** Wajib login; akun yang harus ganti password diarahkan ke halaman ganti password dulu. */
const requireLogin: RequestHandler = (req, res, next) => {
  if (!req.admin) {
    if (req.method === 'GET' && req.accepts('html')) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    return next(new HttpError(401, 'Sesi login berakhir. Silakan masuk lagi.'));
  }
  if (req.admin.mustChangePassword && !['/akun/password', '/logout'].includes(req.path)) {
    return res.redirect(303, '/admin/akun/password');
  }
  next();
};

adminRouter.use(securityHeaders);
adminRouter.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 5000 }));
adminRouter.use(express.json({ limit: '2mb' }));
adminRouter.use(sessionLoader);
adminRouter.use(adminRenderMiddleware);
adminRouter.use(csrfProtect);

// ───────────── Publik: PWA & login ─────────────

adminRouter.get('/manifest.webmanifest', (_req, res) => {
  res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(
    JSON.stringify({
      name: 'CMS Store Kompas.com',
      short_name: 'CMS Store',
      description: 'Kelola produk, tampilan, stok, dan promo Store Kompas.com',
      id: '/admin/',
      start_url: '/admin/',
      scope: '/admin/',
      display: 'standalone',
      background_color: '#FFFFFF',
      theme_color: '#0A5388',
      lang: 'id',
      icons: [
        { src: '/cms/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/cms/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/cms/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
  );
});

/** Service worker disajikan dari /admin/ supaya scope-nya mencakup seluruh CMS. */
const serviceWorker = readFileSync(join(process.cwd(), 'public', 'cms', 'sw.js'), 'utf8');
adminRouter.get('/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache').type('application/javascript').send(serviceWorker);
});

adminRouter.use(authRouter);

// ───────────── Wajib login ─────────────

adminRouter.use(requireLogin);
adminRouter.use(dashboardRouter);
adminRouter.use(uploadRouter);
adminRouter.use(kategoriRouter);
adminRouter.use(menuRouter);
adminRouter.use(feedApiRouter);
adminRouter.use(bannerRouter);
adminRouter.use(seksiRouter);
adminRouter.use(koleksiRouter);

adminRouter.use(
  handle(async (_req, _res) => {
    throw new HttpError(404, 'Halaman tidak ditemukan.');
  }),
);

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : typeof err?.status === 'number' ? err.status : 500;
  const message =
    err instanceof HttpError
      ? err.message
      : status === 413
        ? 'Data yang dikirim terlalu besar.'
        : status < 500
          ? 'Permintaan tidak valid.'
          : 'Terjadi kesalahan di server. Coba lagi sebentar lagi.';
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  if (!req.accepts('html') || req.get('x-requested-with') === 'fetch') {
    res.status(status).json({ error: message });
    return;
  }
  res
    .renderAdmin('error', { pageTitle: status === 404 ? 'Tidak ditemukan' : 'Terjadi kesalahan', status, message, stack: isProd || status < 500 ? null : String(err?.stack ?? '') }, status)
    .catch((renderErr) => {
      console.error(renderErr);
      res.status(status).type('text').send(message);
    });
};

adminRouter.use(errorHandler);
