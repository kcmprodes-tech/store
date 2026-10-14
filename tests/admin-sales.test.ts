/** Dashboard penjualan & analitik: periode WIB, angka penjualan (yang batal tidak dihitung), hak akses. */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { periodRange, rupiahCompact, salesBreakdown, salesChart, salesKpis } from '../src/admin/modules/dashboard/sales.js';
import { cancelOrder, inOrderTx, SYSTEM } from '../src/admin/modules/pesanan/pesanan.service.js';
import { prisma } from '../src/lib/prisma.js';
import { deleteAdmins, get, loggedIn } from './admin-helpers.js';
import { cleanupOrders, createTestOrder, createTestProduct } from './order-helpers.js';

const app = createApp();
const admins: number[] = [];

afterAll(async () => {
  await cleanupOrders();
  await deleteAdmins(admins);
  await prisma.$disconnect();
});

describe('Periode WIB', () => {
  it('minggu mulai Senin 00:00 WIB, bulan tanggal 1, setahun = 12 bulan kalender terakhir; pembanding sepanjang periode berjalan', () => {
    const now = new Date('2026-10-14T08:00:00Z'); // Rabu 15:00 WIB
    const week = periodRange('minggu', now);
    expect(week.current.from.toISOString()).toBe('2026-10-11T17:00:00.000Z'); // Senin 12 Okt 00:00 WIB
    expect(week.previous.from.toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(week.previous.to.toISOString()).toBe('2026-10-07T08:00:00.000Z');
    expect(week.buckets.map((b) => b.label)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(week.buckets.filter((b) => b.future).length).toBe(4);

    const month = periodRange('bulan', now);
    expect(month.current.from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(month.buckets.length).toBe(31);
    expect(month.previous.from.toISOString()).toBe('2026-08-31T17:00:00.000Z');

    const year = periodRange('tahun', now);
    expect(year.current.from.toISOString()).toBe('2025-10-31T17:00:00.000Z'); // 1 Nov 2025 WIB
    expect(year.buckets.map((b) => b.label).join(' ')).toBe('Nov Des Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt');

    // Minggu 23:30 WIB masih minggu yang sama (Senin sebelumnya)
    expect(periodRange('minggu', new Date('2026-10-18T16:30:00Z')).current.from.toISOString()).toBe('2026-10-11T17:00:00.000Z');
    // Senin 00:30 WIB sudah minggu baru
    expect(periodRange('minggu', new Date('2026-10-18T17:30:00Z')).current.from.toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });

  it('format ringkas sumbu', () => {
    expect(rupiahCompact(0)).toBe('Rp0');
    expect(rupiahCompact(250_000)).toBe('Rp250 rb');
    expect(rupiahCompact(1_250_000)).toBe('Rp1,3 jt');
  });
});

describe('Angka penjualan', () => {
  it('pesanan dibayar masuk penjualan minggu/bulan/setahun, grafik & produk terlaris; yang dibatalkan tidak', async () => {
    const before = await salesKpis();
    const product = await createTestProduct({ variants: 1, stock: 50 });
    // 40 × Rp25.000 = Rp1 jt supaya pasti masuk 5 produk terlaris minggu ini
    const paid = await createTestOrder({ items: [{ variantId: product.variants[0]!.id, qty: 40 }], paid: true });
    const canceled = await createTestOrder({ items: [{ variantId: product.variants[0]!.id, qty: 1 }], paid: true });
    await inOrderTx((tx) => cancelOrder(tx, canceled.id, 'uji', SYSTEM));

    const after = await salesKpis();
    for (const key of ['minggu', 'bulan', 'tahun'] as const) {
      const b = before.find((k) => k.key === key)!;
      const a = after.find((k) => k.key === key)!;
      expect(a.revenue - b.revenue).toBe(paid.total);
      expect(a.orders - b.orders).toBe(1);
    }

    const chart = await salesChart('minggu');
    expect(chart.total).toBe(after.find((k) => k.key === 'minggu')!.revenue);
    const breakdown = await salesBreakdown('minggu');
    const top = breakdown.products.find((p) => p.label === product.title)!;
    expect(top).toMatchObject({ qty: 40, value: 25_000 * 40, href: `/admin/produk/${product.id}` });
    expect(breakdown.summary.canceled).toBeGreaterThanOrEqual(1);
  });
});

describe('Dashboard', () => {
  it('Admin, Finance, Marketing melihat Penjualan; Editor, CS, Gudang tidak; Promo aktif & Perubahan terakhir sudah tidak ada', async () => {
    for (const role of ['ADMIN', 'FINANCE', 'MARKETING'] as const) {
      const s = await loggedIn(app, [role]);
      admins.push(s.user.id);
      const res = await get(s.agent, '/admin?periode=tahun');
      expect(res.text).toContain('id="penjualan"');
      expect(res.text).toContain('Penjualan per bulan · 12 bulan terakhir');
      expect(res.text).not.toContain('Promo aktif');
      expect(res.text).not.toContain('Perubahan terakhir');
    }
    for (const role of ['EDITOR', 'CS', 'GUDANG'] as const) {
      const s = await loggedIn(app, [role]);
      admins.push(s.user.id);
      const res = await get(s.agent, '/admin');
      expect(res.text).not.toContain('id="penjualan"');
    }
  });
});
