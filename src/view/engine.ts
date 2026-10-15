import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { create, type ExpressHandlebars } from 'express-handlebars';
import Handlebars from 'handlebars';
import { isProd } from '../config/env.js';
import { getWhatsappNumber } from '../lib/settings.js';
import type { Platform } from '../lib/device.js';
import { getStoreChrome } from '../modules/storefront/storefront.service.js';

const viewsRoot = join(process.cwd(), 'views');

/** bodyClass per halaman/platform, diambil dari template prototipe. */
type PageMeta = Record<string, Record<Platform, { bodyClass: string }>>;
const pageMeta = JSON.parse(readFileSync(join(viewsRoot, 'page-meta.json'), 'utf8')) as PageMeta;

export const helpers = {
  eq: (a: unknown, b: unknown) => a === b,
  /** Nilai atribut (href/src) yang di-escape seperti tulisan tangan: `&` → `&amp;`, tetapi `=` tidak jadi `&#x3D;`. */
  attr: (value: unknown) =>
    new Handlebars.SafeString(Handlebars.Utils.escapeExpression(String(value ?? '')).replace(/&#x3D;/g, '=')),
  inc: (n: unknown) => Number(n) + 1,
  /** Data JSON untuk <script type="application/json">; `<` di-escape supaya aman di dalam tag script. */
  json: (value: unknown) => JSON.stringify(value ?? null).replace(/</g, '\\u003c'),
};

function engineFor(platform: Platform): ExpressHandlebars {
  return create({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: join(viewsRoot, platform, 'layouts'),
    partialsDir: [join(viewsRoot, 'shared', 'partials'), join(viewsRoot, platform, 'partials')],
    helpers,
  });
}

const engines: Record<Platform, ExpressHandlebars> = {
  desktop: engineFor('desktop'),
  mobile: engineFor('mobile'),
};

/** Versi aset untuk cache-busting CSS/JS. */
export const assetVersion = Date.now().toString(36);

export function renderMiddleware(req: Request, res: Response, next: NextFunction) {
  res.renderPage = async (view, data = {}, status = 200) => {
    const platform = req.platform ?? 'desktop';
    const [waNumber, storeChrome] = await Promise.all([getWhatsappNumber(), getStoreChrome()]);
    const whatsapp = waNumber
      ? { number: waNumber, helpUrl: `https://wa.me/${waNumber}?text=${encodeURIComponent('Halo Store Kompas.com, saya butuh bantuan.')}` }
      : null;
    const html = await engines[platform].renderView(join(viewsRoot, platform, 'pages', `${view}.hbs`), {
      whatsapp,
      storeChrome,
      ...data,
      bodyClass: pageMeta[view]?.[platform]?.bodyClass ?? '',
      platform,
      assetVersion,
      cache: isProd,
    });
    res.status(status).type('html').send(html);
  };
  next();
}
