/**
 * Render email pembeli: Handlebars (views/emails) → CSS di-inline dengan juice supaya rapi di
 * Gmail/Outlook. Belum ada pengiriman; Tahap 3 memanggil renderEmail() saat status pesanan berubah.
 */
import { join } from 'node:path';
import { create } from 'express-handlebars';
import juice from 'juice';
import { env } from '../../config/env.js';
import { formatRupiah } from '../../lib/format.js';
import { findEmail } from './email.catalog.js';

const emailsRoot = join(process.cwd(), 'views', 'emails');

export interface EmailItem {
  title: string;
  variant?: string;
  qty: number;
  price: number;
  image: string;
  url: string;
}

export interface EmailData {
  customer: { name: string };
  order: {
    invoiceNo: string;
    createdAt: string;
    fulfillment: 'SHIPPING' | 'PICKUP' | 'DIGITAL';
    items: EmailItem[];
    subtotal: number;
    shippingFee: number;
    discount: number;
    promoCode?: string;
    total: number;
    paymentMethod: string;
    address?: { recipient: string; phone: string; line: string };
    courier?: string;
    trackingNo?: string;
    pickup?: { name: string; address: string; hours: string; mapsUrl: string };
  };
  payment?: { method: 'VA' | 'QRIS'; vaNumber?: string; deadline: string };
  video?: { title: string; image: string; url: string };
  cancel?: { by: string; reason: string };
  refund?: { amount: number; destination: string; eta?: string; doneAt?: string; reference?: string };
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
}

const hbs = create({
  extname: '.hbs',
  defaultLayout: 'email',
  layoutsDir: join(emailsRoot, 'layouts'),
  partialsDir: join(emailsRoot, 'partials'),
  helpers: {
    rupiah: (n: unknown) => formatRupiah(Number(n) || 0),
    eq: (a: unknown, b: unknown) => a === b,
  },
});

/** Link tujuan relatif (/pesanan/…) → absolut, karena email dibuka di luar situs. */
function absolute(baseUrl: string, path: string) {
  return /^https?:\/\//.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

export async function renderEmail(
  name: string,
  data: EmailData,
  opts: { whatsappNumber?: string; baseUrl?: string } = {},
): Promise<RenderedEmail> {
  const def = findEmail(name);
  if (!def) throw new Error(`Template email tidak dikenal: ${name}`);
  const baseUrl = opts.baseUrl ?? env.publicBaseUrl;
  const { order } = data;
  const view = {
    ...data,
    order: {
      ...order,
      url: absolute(baseUrl, `/pesanan/${order.invoiceNo}`),
      payUrl: absolute(baseUrl, `/pembayaran/${order.invoiceNo}`),
      itemCount: order.items.reduce((n, i) => n + i.qty, 0),
      // Beli lagi → halaman detail produk pertama
      buyAgainUrl: absolute(baseUrl, order.items[0]?.url ?? '/'),
      items: order.items.map((i) => ({ ...i, url: absolute(baseUrl, i.url), image: absolute(baseUrl, i.image), lineTotal: i.price * i.qty })),
    },
    // nomor VA tanpa spasi: satu "kata" sehingga tekan lama / klik dua kali menyalin seluruh nomor
    payment: data.payment && { ...data.payment, vaNumber: data.payment.vaNumber?.replace(/\s+/g, '') },
    video: data.video && { ...data.video, url: absolute(baseUrl, data.video.url), image: absolute(baseUrl, data.video.image) },
    baseUrl,
    homeUrl: `${baseUrl}/`,
    year: new Date().getFullYear(),
    whatsappUrl: opts.whatsappNumber
      ? `https://wa.me/${opts.whatsappNumber}?text=${encodeURIComponent(`Halo Store Kompas.com, saya mau tanya pesanan ${order.invoiceNo}.`)}`
      : '',
  };
  // subjek & preheader berupa teks biasa (di-escape nanti oleh layout)
  const text = (tpl: string) =>
    hbs.handlebars.compile(tpl, { noEscape: true })(view, { helpers: hbs.helpers }).replace(/\s+/g, ' ').trim();
  const subject = text(def.subject);
  const preheader = text(def.preheader);
  const raw = await hbs.renderView(join(emailsRoot, `${name}.hbs`), { ...view, subject, preheader });
  const html = juice(raw, { preserveMediaQueries: true, preserveImportant: true });
  return { subject, preheader, html };
}

/** Halaman pratinjau semua email (development). */
export async function renderEmailPreviewPage(data: Record<string, unknown>) {
  return hbs.renderView(join(emailsRoot, '_preview.hbs'), { ...data, layout: false });
}
