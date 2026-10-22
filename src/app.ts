import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { adminRouter } from './admin/index.js';
import { isProd, trustProxy } from './config/env.js';
import { deviceMiddleware } from './lib/device.js';
import { securityHeaders, showDebugInfo } from './lib/security.js';
import { emailPreview } from './modules/email/email.preview.js';
import { renderMiddleware } from './view/engine.js';
import { web } from './web/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);

  // Gambar unggahan CMS: browser tidak boleh menebak jenis file selain yang dikirim server.
  app.use('/uploads', (_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(
    express.static(join(process.cwd(), 'public'), {
      maxAge: isProd ? '7d' : 0,
      // CSS/JS memakai ?v=<versi>, gambar boleh di-cache lebih lama.
    }),
  );
  // QA visual (development): sajikan build prototipe store-v2 di /__prototipe untuk dibandingkan 1:1.
  if (!isProd && process.env.PROTOTYPE_DIR) {
    app.use('/__prototipe', express.static(process.env.PROTOTYPE_DIR));
  }
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/robots.txt', (_req, res) => {
    res.type('text').send('User-agent: *\nDisallow: /admin\n');
  });

  // CMS: sebelum middleware store (device & render store tidak dipakai di /admin).
  app.use('/admin', adminRouter);

  app.use(deviceMiddleware);
  app.use(renderMiddleware);

  // Pratinjau template email pembeli (development).
  if (!isProd) app.use('/__email', emailPreview);

  app.use(web);

  app.use((_req: Request, res: Response) => {
    res.status(404).type('text').send('Halaman tidak ditemukan.');
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // mis. URL rusak (%ZZ) → 400, bukan 500
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return;
    const message = status < 500 ? 'Permintaan tidak valid.' : 'Terjadi kesalahan pada server.';
    // stack trace hanya untuk developer di localhost, tidak pernah lewat tunnel/internet
    res.status(status).type('text').send(status >= 500 && showDebugInfo(req) ? String((err as Error)?.stack ?? err) : message);
  });

  return app;
}
