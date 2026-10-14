/** Pencarian global: GET /admin/cari (halaman hasil) dan GET /admin/api/cari (saran saat mengetik). */
import { Router } from 'express';
import { handle } from '../../http.js';
import { directMatch, globalSearch, MIN_QUERY, normalizeQuery } from './cari.service.js';

export const cariRouter = Router();

cariRouter.get(
  '/api/cari',
  handle(async (req, res) => {
    const text = normalizeQuery(req.query.q);
    const groups = await globalSearch(req.admin!.roles, text, 5);
    res.json({ q: text, groups, direct: text ? await directMatch(req.admin!.roles, text) : null });
  }),
);

cariRouter.get(
  '/cari',
  handle(async (req, res) => {
    const raw = String(req.query.q ?? '').trim();
    const text = normalizeQuery(raw);
    // No invoice / no resi lengkap langsung membuka pesanannya
    const direct = text ? await directMatch(req.admin!.roles, text) : null;
    if (direct) return res.redirect(303, direct);
    const groups = await globalSearch(req.admin!.roles, text, 20);
    await res.renderAdmin('cari', {
      pageTitle: text ? `Cari "${text}"` : 'Pencarian',
      active: 'dasbor',
      q: raw,
      text,
      tooShort: raw.length > 0 && !text,
      minQuery: MIN_QUERY,
      groups,
      total: groups.reduce((n, g) => n + g.total, 0),
    });
  }),
);
