/** Tampilan pesanan di CMS: badge status, langkah berikutnya, alamat, dan template WhatsApp ke pembeli. */
import type { Fulfillment, OrderStatus, Prisma, RefundStatus } from '../../../generated/prisma/client.js';
import { formatRupiah } from '../../../lib/format.js';
import { formatDate, formatDateTime } from '../../time.js';
import { AUTO_COMPLETE_DAYS, daysSince, FULFILLMENT_LABELS, LATE_PROCESSING_DAYS, PICKUP_REMINDER_DAYS, STATUS_LABELS } from './pesanan.service.js';

type Tone = 'info' | 'success' | 'warning' | 'error' | 'plain';

const STATUS_TONES: Record<OrderStatus, Tone> = {
  UNPAID: 'warning',
  PROCESSING: 'info',
  READY_PICKUP: 'info',
  SHIPPED: 'info',
  COMPLETED: 'success',
  CANCELED: 'plain',
  EXPIRED: 'plain',
};

export const FULFILLMENT_ICONS: Record<Fulfillment, string> = { SHIPPING: 'truck', PICKUP: 'storefront', DIGITAL: 'play-circle' };

export const REFUND_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Menunggu keputusan',
  APPROVED: 'Disetujui, dana belum dikirim',
  REJECTED: 'Ditolak',
  COMPLETED: 'Dana dikembalikan',
};
const REFUND_TONES: Record<RefundStatus, Tone> = { REQUESTED: 'warning', APPROVED: 'info', REJECTED: 'plain', COMPLETED: 'success' };

export const refundBadge = (s: RefundStatus) => ({ label: REFUND_LABELS[s], tone: REFUND_TONES[s] });

type OrderLike = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  paidAt: Date | null;
  packedAt: Date | null;
  trackingNo: string | null;
  readyAt: Date | null;
  shippedAt: Date | null;
  paymentDueAt: Date | null;
};

export function statusBadge(o: Pick<OrderLike, 'status'>) {
  return { label: STATUS_LABELS[o.status], tone: STATUS_TONES[o.status] };
}

/** Tahap kerja berikutnya (dipakai di daftar & detail), mis. "Perlu dikemas". */
export function stageOf(o: OrderLike): { label: string; tone: Tone } | null {
  if (o.status === 'UNPAID') return { label: `Bayar sebelum ${formatDateTime(o.paymentDueAt)}`, tone: 'plain' };
  if (o.status === 'READY_PICKUP') return { label: 'Menunggu pembeli datang', tone: 'plain' };
  if (o.status !== 'PROCESSING') return null;
  if (o.fulfillment === 'PICKUP') return { label: 'Perlu disiapkan', tone: 'warning' };
  if (!o.packedAt) return { label: 'Perlu dikemas', tone: 'warning' };
  if (!o.trackingNo) return { label: 'Perlu no resi', tone: 'warning' };
  return { label: 'Siap diserahkan ke kurir', tone: 'info' };
}

/** Peringatan waktu: diproses terlalu lama, atau belum diambil pembeli. */
export function lateOf(o: OrderLike, now = new Date()): { label: string; tone: Tone } | null {
  if (o.status === 'PROCESSING') {
    const d = daysSince(o.paidAt, now);
    if (d >= LATE_PROCESSING_DAYS) return { label: `Terlambat ${d} hari`, tone: 'error' };
  }
  if (o.status === 'READY_PICKUP') {
    const d = daysSince(o.readyAt, now);
    if (d >= PICKUP_REMINDER_DAYS) return { label: `Belum diambil ${d} hari`, tone: 'warning' };
  }
  return null;
}

export function autoCompleteAt(o: Pick<OrderLike, 'shippedAt'>) {
  return o.shippedAt ? new Date(o.shippedAt.getTime() + AUTO_COMPLETE_DAYS * 86400_000) : null;
}

export function fulfillmentInfo(f: Fulfillment) {
  return { label: FULFILLMENT_LABELS[f], icon: FULFILLMENT_ICONS[f] };
}

// ───────────── Alamat ─────────────

type AddressSnapshot = Partial<Record<'label' | 'recipient' | 'phone' | 'address' | 'district' | 'city' | 'province' | 'postalCode' | 'note', string>>;

export function addressOf(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as AddressSnapshot;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const region = [str(a.district), str(a.city), [str(a.province), str(a.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    label: str(a.label),
    recipient: str(a.recipient),
    phone: str(a.phone),
    street: str(a.address),
    region,
    note: str(a.note),
    oneLine: [str(a.address), region].filter(Boolean).join(', '),
  };
}

// ───────────── WhatsApp ─────────────

type WaInput = {
  invoiceNo: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  buyerName: string | null;
  buyerPhone: string | null;
  courier: string | null;
  trackingNo: string | null;
  addressSnapshot: unknown;
  pickupLocation: { name: string; address: string; openingHours: string } | null;
  refunds: { amount: number; status: RefundStatus; dueAt: Date }[];
};

/** Template pesan WhatsApp sesuai keadaan pesanan; nomor pembeli sudah dinormalisasi ke 62…. */
export function waTemplates(o: WaInput) {
  if (!o.buyerPhone) return [];
  const name = (o.buyerName ?? '').trim().split(/\s+/)[0] || 'Kak';
  const list: { label: string; text: string }[] = [];
  if (o.status === 'READY_PICKUP' && o.pickupLocation) {
    list.push({
      label: 'Pesanan siap diambil',
      text: `Halo ${name}, pesanan ${o.invoiceNo} di Store Kompas.com sudah siap diambil di ${o.pickupLocation.name} (${o.pickupLocation.address}), jam ${o.pickupLocation.openingHours}. Tunjukkan QR pengambilan di halaman pesanan Anda saat mengambil. Terima kasih.`,
    });
  }
  if (o.trackingNo && o.status === 'SHIPPED') {
    list.push({
      label: 'Pesanan dikirim + no resi',
      text: `Halo ${name}, pesanan ${o.invoiceNo} sudah kami kirim lewat ${o.courier ?? 'kurir'} dengan no resi ${o.trackingNo}. Terima kasih sudah berbelanja di Store Kompas.com.`,
    });
  }
  const address = addressOf(o.addressSnapshot);
  if (o.fulfillment === 'SHIPPING' && address && (o.status === 'UNPAID' || o.status === 'PROCESSING')) {
    list.push({
      label: 'Konfirmasi alamat',
      text: `Halo ${name}, kami dari Store Kompas.com ingin mengonfirmasi alamat pengiriman pesanan ${o.invoiceNo}: ${address.recipient ? `${address.recipient}, ` : ''}${address.oneLine}. Apakah alamat ini sudah benar?`,
    });
  }
  const refund = [...o.refunds].reverse().find((r) => r.status !== 'REJECTED');
  if (refund) {
    list.push({
      label: 'Info refund',
      text:
        refund.status === 'COMPLETED'
          ? `Halo ${name}, dana pesanan ${o.invoiceNo} sebesar ${formatRupiah(refund.amount)} sudah kami kembalikan. Mohon cek rekening/dompet digital Anda. Terima kasih.`
          : `Halo ${name}, pengembalian dana pesanan ${o.invoiceNo} sebesar ${formatRupiah(refund.amount)} sedang kami proses, paling lambat ${formatDate(refund.dueAt)}. Terima kasih atas kesabarannya.`,
    });
  }
  list.push({ label: 'Pesan bebas', text: `Halo ${name}, kami dari Store Kompas.com terkait pesanan ${o.invoiceNo}. ` });
  return list.map((t) => ({ ...t, href: `https://wa.me/${o.buyerPhone}?text=${encodeURIComponent(t.text)}` }));
}

/** Cari no invoice, nama/HP/email pembeli, atau no resi. */
export function orderSearchWhere(text: string): Prisma.OrderWhereInput {
  if (!text) return {};
  const upper = text.toUpperCase();
  const or: Prisma.OrderWhereInput[] = [
    { invoiceNo: { contains: upper } },
    { buyerName: { contains: text } },
    { trackingNo: { contains: upper } },
    { user: { email: { contains: text } } },
  ];
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 4) or.push({ buyerPhone: { contains: digits.replace(/^(62|0)/, '') } });
  return { OR: or };
}

/** 4 digit terakhir HP (verifikasi pengambilan & tampilan tersamar). */
export const phoneLast4 = (phone: string | null | undefined) => String(phone ?? '').replace(/\D/g, '').slice(-4);

/** 62812xxxx0101 → 0812-xxxx-0101 untuk ditampilkan. */
export function displayPhone(phone: string | null | undefined) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  const local = d.startsWith('62') ? `0${d.slice(2)}` : d;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
}
