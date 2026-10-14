/**
 * Template email pembeli: semua email ter-render dengan data contoh, CSS ter-inline,
 * link absolut, dan halaman pratinjau /__email tersedia di development.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { EMAILS } from '../src/modules/email/email.catalog.js';
import { renderEmail } from '../src/modules/email/email.renderer.js';
import { EMAIL_SAMPLES } from '../src/modules/email/email.samples.js';

const BASE = 'https://store.example.test';
const FAKE_WA = '6200000000001';

describe('template email', () => {
  it('setiap email di katalog punya data contoh', () => {
    expect(EMAILS).toHaveLength(11);
    for (const e of EMAILS) expect(EMAIL_SAMPLES[e.name], e.name).toBeDefined();
  });

  for (const e of EMAILS) {
    it(`${e.name}: subjek, isi, dan link lengkap`, async () => {
      const data = EMAIL_SAMPLES[e.name];
      const { subject, preheader, html } = await renderEmail(e.name, data, { baseUrl: BASE, whatsappNumber: FAKE_WA });
      expect(subject).toContain(data.order.invoiceNo);
      expect(preheader.length).toBeGreaterThan(5);
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).not.toContain('{{');
      // CSS sudah di-inline (kartu putih) dan media query mobile tetap ada
      expect(html).toMatch(/class="e-card"[^>]*style="[^"]*background: ?#FFFFFF/);
      expect(html).toContain('@media only screen and (max-width: 620px)');
      // semua link & gambar absolut (email dibuka di luar situs)
      const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
      for (const url of urls) expect(url, url).toMatch(/^https:\/\//);
      expect(html).toContain(`${BASE}/images/store-v2/logo-store.png`);
      expect(html).toContain(`https://wa.me/${FAKE_WA}?text`);
    });
  }

  it('tanpa nomor WhatsApp, blok bantuan disembunyikan', async () => {
    const { html } = await renderEmail('pembayaran-berhasil', EMAIL_SAMPLES['pembayaran-berhasil'], { baseUrl: BASE });
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('Butuh bantuan?');
  });

  it('total & diskon pesanan tampil dalam rupiah', async () => {
    const { html } = await renderEmail('pembayaran-berhasil', EMAIL_SAMPLES['pembayaran-berhasil'], { baseUrl: BASE });
    expect(html).toContain('Rp\u00a0209.000'); // formatRupiah memakai spasi tak terputus
    expect(html).toContain('Diskon (DJFXA54)');
    expect(html).toContain('Subtotal (3 produk)');
  });

  it('template tidak dikenal → error', async () => {
    await expect(renderEmail('tidak-ada', EMAIL_SAMPLES['pembayaran-berhasil'])).rejects.toThrow(/tidak dikenal/);
  });
});

describe('pratinjau email (development)', () => {
  const app = createApp();

  it('/__email menampilkan daftar semua email', async () => {
    const res = await request(app).get('/__email').expect(200);
    for (const e of EMAILS) expect(res.text).toContain(`/__email?email=${e.name}`);
  });

  it('/__email/:name merender email, nama asing 404', async () => {
    const res = await request(app).get('/__email/pesanan-dikirim').expect(200);
    expect(res.text).toContain('J23473733883');
    await request(app).get('/__email/tidak-ada').expect(404);
  });
});
