/**
 * Pratinjau email (hanya development): /__email = daftar + pratinjau, /__email/:name = HTML email.
 * Memakai data contoh dari email.samples.ts.
 */
import { Router } from 'express';
import { getWhatsappNumber } from '../../lib/settings.js';
import { EMAILS, findEmail, type EmailGroup } from './email.catalog.js';
import { renderEmail, renderEmailPreviewPage } from './email.renderer.js';
import { EMAIL_SAMPLES } from './email.samples.js';

export const emailPreview = Router();

emailPreview.get('/', async (req, res) => {
  const selected = findEmail(String(req.query.email ?? '')) ?? EMAILS[0];
  const whatsappNumber = await getWhatsappNumber();
  const { subject, preheader } = await renderEmail(selected.name, EMAIL_SAMPLES[selected.name], { whatsappNumber });
  const groups = (['Transaksi', 'Refund', 'Setelah rilis'] as EmailGroup[]).map((name) => ({
    name,
    emails: EMAILS.filter((e) => e.group === name).map((e) => ({ ...e, active: e.name === selected.name })),
  }));
  res.type('html').send(await renderEmailPreviewPage({ groups, current: { ...selected, subject, preheader } }));
});

emailPreview.get('/:name', async (req, res) => {
  const def = findEmail(req.params.name);
  if (!def) {
    res.status(404).type('text').send(`Template email tidak dikenal: ${req.params.name}`);
    return;
  }
  const { html } = await renderEmail(def.name, EMAIL_SAMPLES[def.name], { whatsappNumber: await getWhatsappNumber() });
  res.type('html').send(html);
});
