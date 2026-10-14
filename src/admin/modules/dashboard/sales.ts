/**
 * Data penjualan & analitik dashboard. Penjualan = pesanan yang sudah dibayar (paid_at), tidak termasuk yang
 * dibatalkan/kedaluwarsa; refund ditampilkan terpisah. Semua periode dihitung dalam WIB.
 */
import { prisma } from '../../../lib/prisma.js';
import { formatRupiah } from '../../../lib/format.js';
import { FULFILLMENT_LABELS } from '../pesanan/pesanan.service.js';
import type { Fulfillment } from '../../../generated/prisma/client.js';

const WIB = 7 * 3600_000;
const DAY = 86400_000;

export const PERIODS = {
  minggu: { label: 'Minggu ini', previous: 'minggu lalu', unit: 'hari' },
  bulan: { label: 'Bulan ini', previous: 'bulan lalu', unit: 'hari' },
  tahun: { label: '12 bulan terakhir', previous: '12 bulan sebelumnya', unit: 'bulan' },
} as const;
export type PeriodKey = keyof typeof PERIODS;

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ───────────── Waktu WIB ─────────────

/** Tanggal kalender WIB dari sebuah Date. */
function wib(d: Date) {
  const x = new Date(d.getTime() + WIB);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() };
}
/** Jam 00:00 WIB pada tanggal kalender (bulan boleh di luar 0–11, dinormalkan). */
const wibMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - WIB);
const dayKey = (d: Date) => {
  const p = wib(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};
const monthKey = (d: Date) => {
  const p = wib(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}`;
};

type Range = { from: Date; to: Date };
type Bucket = { key: string; label: string; full: string; future: boolean };

/** Periode berjalan + periode pembanding dengan panjang yang sama (sampai titik waktu yang sama). */
export function periodRange(key: PeriodKey, now = new Date()): { current: Range; previous: Range; buckets: Bucket[]; bucketFormat: 'day' | 'month' } {
  const t = wib(now);
  if (key === 'minggu') {
    const offset = (t.dow + 6) % 7; // Senin = 0
    const from = wibMidnight(t.y, t.m, t.d - offset);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(from.getTime() + i * DAY);
      const p = wib(day);
      return { key: dayKey(day), label: DAYS[p.dow]!, full: `${DAYS[p.dow]}, ${p.d} ${MONTHS[p.m]} ${p.y}`, future: day > now };
    });
    return { current: { from, to: now }, previous: { from: new Date(from.getTime() - 7 * DAY), to: new Date(now.getTime() - 7 * DAY) }, buckets, bucketFormat: 'day' };
  }
  if (key === 'bulan') {
    const from = wibMidnight(t.y, t.m, 1);
    const days = new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate();
    const prevFrom = wibMidnight(t.y, t.m - 1, 1);
    // Pembanding: bulan lalu sampai tanggal & jam yang sama (dibatasi akhir bulan lalu)
    const elapsed = now.getTime() - from.getTime();
    const prevTo = new Date(Math.min(prevFrom.getTime() + elapsed, from.getTime()));
    const buckets = Array.from({ length: days }, (_, i) => {
      const day = wibMidnight(t.y, t.m, i + 1);
      const p = wib(day);
      return { key: dayKey(day), label: String(i + 1), full: `${DAYS[p.dow]}, ${i + 1} ${MONTHS[t.m]} ${t.y}`, future: day > now };
    });
    return { current: { from, to: now }, previous: { from: prevFrom, to: prevTo }, buckets, bucketFormat: 'day' };
  }
  const from = wibMidnight(t.y, t.m - 11, 1);
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const month = wibMidnight(t.y, t.m - 11 + i, 1);
    const p = wib(month);
    return { key: monthKey(month), label: MONTHS[p.m]!, full: `${MONTHS[p.m]} ${p.y}`, future: false };
  });
  const prevFrom = wibMidnight(t.y, t.m - 23, 1);
  return { current: { from, to: now }, previous: { from: prevFrom, to: new Date(prevFrom.getTime() + (now.getTime() - from.getTime())) }, buckets, bucketFormat: 'month' };
}

// ───────────── Query ─────────────

const num = (v: unknown) => Number(v ?? 0);

async function totals(r: Range) {
  const [row] = await prisma.$queryRaw<{ n: bigint; s: unknown }[]>`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS s FROM orders
    WHERE paid_at >= ${r.from} AND paid_at < ${r.to} AND status NOT IN ('CANCELED', 'EXPIRED')`;
  return { orders: num(row?.n), revenue: num(row?.s) };
}

/** Perubahan dibanding periode sebelumnya; null kalau periode sebelumnya kosong. */
function delta(current: number, previous: number) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), up: pct > 0, down: pct < 0 };
}

/** Kartu angka utama: minggu ini, bulan ini, 12 bulan terakhir. */
export async function salesKpis(now = new Date()) {
  return Promise.all(
    (Object.keys(PERIODS) as PeriodKey[]).map(async (key) => {
      const p = periodRange(key, now);
      const [cur, prev] = await Promise.all([totals(p.current), totals(p.previous)]);
      return { key, label: PERIODS[key].label, previousLabel: PERIODS[key].previous, ...cur, previous: prev.revenue, delta: delta(cur.revenue, prev.revenue) };
    }),
  );
}

/** "Rp1,2 jt" untuk sumbu grafik. */
export function rupiahCompact(n: number) {
  const f = (x: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(x);
  if (n >= 1e9) return `Rp${f(n / 1e9)} M`;
  if (n >= 1e6) return `Rp${f(n / 1e6)} jt`;
  if (n >= 1e3) return `Rp${f(n / 1e3)} rb`;
  return `Rp${f(n)}`;
}

/** Garis bantu sumbu Y yang "bulat" (0, 250 rb, 500 rb, …). */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return { top: 100_000, ticks: [0, 25_000, 50_000, 75_000, 100_000] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** Grafik kolom penjualan per hari/bulan untuk periode terpilih. */
export async function salesChart(key: PeriodKey, now = new Date()) {
  const p = periodRange(key, now);
  const fmt = p.bucketFormat === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const rows = await prisma.$queryRaw<{ k: string; n: bigint; s: unknown }[]>`
    SELECT DATE_FORMAT(DATE_ADD(paid_at, INTERVAL 7 HOUR), ${fmt}) AS k, COUNT(*) AS n, COALESCE(SUM(total), 0) AS s
    FROM orders
    WHERE paid_at >= ${p.current.from} AND paid_at < ${p.current.to} AND status NOT IN ('CANCELED', 'EXPIRED')
    GROUP BY k`;
  const byKey = new Map(rows.map((r) => [r.k, { orders: num(r.n), revenue: num(r.s) }]));
  const max = Math.max(0, ...[...byKey.values()].map((v) => v.revenue));
  const { top, ticks } = niceTicks(max);
  // Label sumbu X jarang-jarang untuk bulan berjalan (1, 5, 10, 15, …) supaya tidak bertumpuk
  const showLabel = (i: number) => key !== 'bulan' || i === 0 || (i + 1) % 5 === 0;
  const bars = p.buckets.map((b, i) => {
    const v = byKey.get(b.key) ?? { orders: 0, revenue: 0 };
    return {
      ...b,
      ...v,
      height: top ? Math.round((v.revenue / top) * 1000) / 10 : 0,
      showLabel: showLabel(i),
      revenueText: formatRupiah(v.revenue),
    };
  });
  return {
    unit: PERIODS[key].unit,
    ticks: ticks.map((t) => ({ label: rupiahCompact(t), y: top ? Math.round((t / top) * 1000) / 10 : 0 })).reverse(),
    bars,
    total: bars.reduce((n, b) => n + b.revenue, 0),
    empty: bars.every((b) => b.revenue === 0),
  };
}

/** Rincian analitik untuk periode terpilih. */
export async function salesBreakdown(key: PeriodKey, now = new Date()) {
  const { current: r } = periodRange(key, now);
  const paid = { from: r.from, to: r.to };
  const [sum, items, refunds, canceled, products, categories, fulfillment, methods] = await Promise.all([
    totals(paid),
    prisma.$queryRaw<{ q: unknown }[]>`
      SELECT COALESCE(SUM(oi.qty), 0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.paid_at >= ${paid.from} AND o.paid_at < ${paid.to} AND o.status NOT IN ('CANCELED', 'EXPIRED')`,
    prisma.$queryRaw<{ n: bigint; s: unknown }[]>`
      SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s FROM refunds
      WHERE status = 'COMPLETED' AND completed_at >= ${paid.from} AND completed_at < ${paid.to}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM orders
      WHERE status IN ('CANCELED', 'EXPIRED') AND canceled_at >= ${paid.from} AND canceled_at < ${paid.to}`,
    prisma.$queryRaw<{ title: string; pid: number | null; q: unknown; s: unknown }[]>`
      SELECT oi.product_title AS title, MAX(v.product_id) AS pid, SUM(oi.qty) AS q, SUM(oi.qty * oi.price) AS s
      FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE o.paid_at >= ${paid.from} AND o.paid_at < ${paid.to} AND o.status NOT IN ('CANCELED', 'EXPIRED')
      GROUP BY oi.product_title ORDER BY s DESC, q DESC LIMIT 5`,
    prisma.$queryRaw<{ name: string; s: unknown; q: unknown }[]>`
      SELECT COALESCE(pc.name, c.name, 'Tanpa kategori') AS name, SUM(oi.qty * oi.price) AS s, SUM(oi.qty) AS q
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE o.paid_at >= ${paid.from} AND o.paid_at < ${paid.to} AND o.status NOT IN ('CANCELED', 'EXPIRED')
      GROUP BY name ORDER BY s DESC LIMIT 6`,
    prisma.$queryRaw<{ f: Fulfillment; n: bigint; s: unknown }[]>`
      SELECT fulfillment AS f, COUNT(*) AS n, COALESCE(SUM(total), 0) AS s FROM orders
      WHERE paid_at >= ${paid.from} AND paid_at < ${paid.to} AND status NOT IN ('CANCELED', 'EXPIRED')
      GROUP BY f ORDER BY s DESC`,
    prisma.$queryRaw<{ code: string | null; name: string | null; n: bigint; s: unknown }[]>`
      SELECT o.payment_method_code AS code, MAX(pm.name) AS name, COUNT(*) AS n, COALESCE(SUM(o.total), 0) AS s
      FROM orders o LEFT JOIN payment_methods pm ON pm.code = o.payment_method_code
      WHERE o.paid_at >= ${paid.from} AND o.paid_at < ${paid.to} AND o.status NOT IN ('CANCELED', 'EXPIRED')
      GROUP BY o.payment_method_code ORDER BY s DESC LIMIT 6`,
  ]);

  /** Batang horizontal: lebar relatif terhadap nilai terbesar, persen terhadap total. */
  const bars = <T extends { value: number }>(list: T[]) => {
    const max = Math.max(0, ...list.map((x) => x.value));
    const total = list.reduce((n, x) => n + x.value, 0);
    return list.map((x) => ({ ...x, width: max ? Math.max(2, Math.round((x.value / max) * 100)) : 0, pct: total ? Math.round((x.value / total) * 100) : 0, valueText: formatRupiah(x.value) }));
  };

  return {
    summary: {
      revenue: sum.revenue,
      orders: sum.orders,
      aov: sum.orders ? Math.round(sum.revenue / sum.orders) : 0,
      items: num(items[0]?.q),
      refunds: num(refunds[0]?.s),
      refundCount: num(refunds[0]?.n),
      canceled: num(canceled[0]?.n),
    },
    products: bars(products.map((p) => ({ label: p.title, href: p.pid ? `/admin/produk/${p.pid}` : null, value: num(p.s), qty: num(p.q) }))),
    categories: bars(categories.map((c) => ({ label: c.name, value: num(c.s), qty: num(c.q) }))),
    fulfillment: bars(fulfillment.map((f) => ({ label: FULFILLMENT_LABELS[f.f] ?? f.f, value: num(f.s), qty: num(f.n) }))),
    methods: bars(methods.map((m) => ({ label: m.name ?? m.code ?? 'Lainnya', value: num(m.s), qty: num(m.n) }))),
  };
}
