/**
 * Data contoh untuk pratinjau email (/__email) dan tes. Produk & harga mengikuti seed;
 * nanti (Tahap 3) data asli dibentuk dari tabel orders/order_items.
 */
import type { EmailData, EmailItem } from './email.renderer.js';

const KAOS: EmailItem = {
  title: 'Kaos Hitam Ekslusif Kompas.com “Sandang Pangan Papan Kebenaran”',
  variant: 'Hitam, L',
  qty: 1,
  price: 120000,
  image: 'https://asset.kompas.com/data/photo/2026/07/08/6a4e06ea0a89f.webp',
  url: '/produk/kaos-hitam-ekslusif-kompascom-sandang-pangan-papan-kebenaran',
};
const MUG: EmailItem = {
  title: 'Gelas Mug Eksklusif Kompas.com Keramik Elegan',
  qty: 2,
  price: 47000,
  image: 'https://asset.kompas.com/data/photo/2025/12/21/6947675184cf9.webp',
  url: '/produk/gelas-mug-eksklusif-kompascom-keramik-elegan',
};
const PESTA_BOLA: EmailItem = {
  title: 'Bundling Pesta Bola: Tabloid Bola by Kompas Edisi Pesta Bola Amerika 2026 + Akses Kompas Digital Premium',
  variant: 'Bundling Plus',
  qty: 1,
  price: 99000,
  image: '/images/store-v2/product-pesta-bola-premium.png',
  url: '/produk/source-18',
};
const VIDEO: EmailItem = {
  title: 'Jason Ranti: Mentalitas di Dunia yang Berisik | BEGINU 5 TAHUN',
  qty: 1,
  price: 20000,
  image: 'https://asset.kompas.com/data/photo/2026/05/06/69fb06d183a7f.jpg',
  url: '/produk/jason-ranti-mentalitas-di-dunia-yang-berisik-beginu-5-tahun',
};

const customer = { name: 'Reza Pratama' };
const address = { recipient: 'Reza Pratama', phone: '0812-3456-7890', line: 'Jl. Dahlia Indah No.23, Kemanggisan, Palmerah, Jakarta Barat' };
const pickup = {
  name: 'Kantor KOMPAS.com',
  address: 'Kompas Gramedia, Jl. Palmerah Sel. No.22-26 Unit 2 Lantai 2, Gelora, Tanah Abang, Jakarta Pusat 10270',
  hours: 'Senin–Jumat, 09.00–17.00 WIB',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kompas%20Gramedia%20Palmerah',
};

/** Pesanan fisik dikirim: kaos + 2 mug, promo DJFXA54, JNE Regular. */
const shippedOrder: EmailData['order'] = {
  invoiceNo: 'SKC-261014-H7Q4MP',
  createdAt: '14 Oktober 2026, 10.12 WIB',
  fulfillment: 'SHIPPING',
  items: [KAOS, MUG],
  subtotal: 214000,
  shippingFee: 9000,
  discount: 14000,
  promoCode: 'DJFXA54',
  total: 209000,
  paymentMethod: 'Virtual account BCA',
  address,
  courier: 'JNE Regular',
  trackingNo: 'J23473733883',
};

/** Pesanan ambil sendiri di Palmerah. */
const pickupOrder: EmailData['order'] = {
  invoiceNo: 'SKC-261014-R3T9WX',
  createdAt: '14 Oktober 2026, 13.40 WIB',
  fulfillment: 'PICKUP',
  items: [KAOS],
  subtotal: 120000,
  shippingFee: 0,
  discount: 0,
  total: 120000,
  paymentMethod: 'GoPay',
  pickup,
};

/** Pesanan video premium (digital). */
const videoOrder: EmailData['order'] = {
  invoiceNo: 'SKC-261014-V8N2KD',
  createdAt: '14 Oktober 2026, 20.05 WIB',
  fulfillment: 'DIGITAL',
  items: [VIDEO],
  subtotal: 20000,
  shippingFee: 0,
  discount: 0,
  total: 20000,
  paymentMethod: 'QRIS',
};

/** Pesanan bundling yang dibatalkan / di-refund. */
const refundOrder: EmailData['order'] = {
  invoiceNo: 'SKC-261012-B5Q7ZE',
  createdAt: '12 Oktober 2026, 09.30 WIB',
  fulfillment: 'SHIPPING',
  items: [PESTA_BOLA],
  subtotal: 99000,
  shippingFee: 9000,
  discount: 0,
  total: 108000,
  paymentMethod: 'GoPay',
  address,
  courier: 'JNE Regular',
};

const vaPayment = { method: 'VA' as const, vaNumber: '8077 0812 3456 7890', deadline: '15 Oktober 2026, 10.12 WIB' };
const refund = { amount: 108000, destination: 'Saldo GoPay', eta: '28 Oktober 2026', doneAt: '20 Oktober 2026', reference: 'RF-261020-8K2M' };

export const EMAIL_SAMPLES: Record<string, EmailData> = {
  'menunggu-pembayaran': { customer, order: shippedOrder, payment: vaPayment },
  'pengingat-bayar': { customer, order: shippedOrder, payment: { ...vaPayment } },
  'pembayaran-berhasil': { customer, order: shippedOrder },
  'pesanan-dikirim': { customer, order: shippedOrder },
  'siap-diambil': { customer, order: pickupOrder },
  'akses-video': {
    customer,
    order: videoOrder,
    video: { title: VIDEO.title, image: VIDEO.image, url: VIDEO.url },
  },
  'pesanan-kedaluwarsa': { customer, order: shippedOrder, payment: vaPayment },
  'pesanan-dibatalkan': {
    customer,
    order: refundOrder,
    cancel: { by: 'oleh tim Store Kompas.com', reason: 'Stok produk habis saat pesanan diproses.' },
    refund,
  },
  'refund-diproses': { customer, order: refundOrder, refund },
  'refund-selesai': { customer, order: refundOrder, refund },
  'pesanan-selesai': { customer, order: shippedOrder },
};
