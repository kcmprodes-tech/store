/**
 * Stok per SKU. Tersedia = fisik (on_hand) − dipesan (reserved), dijumlah semua lokasi.
 * Setiap perubahan stok ditulis ke buku besar stock_movements dalam transaksi yang sama.
 */
import { getSettings } from '../../../lib/settings.js';
import { prisma } from '../../../lib/prisma.js';

export const DEFAULT_LOW_STOCK = 5;

export async function defaultLowStockThreshold() {
  const { low_stock_threshold_default: value } = await getSettings(['low_stock_threshold_default']);
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_LOW_STOCK;
}

let lowCache: { value: number; at: number } | null = null;

/** Jumlah SKU aktif yang stok tersedianya ≤ ambang (untuk badge menu Stok). Cache 30 detik. */
export async function lowStockCount() {
  if (lowCache && Date.now() - lowCache.at < 30_000) return lowCache.value;
  const threshold = await defaultLowStockThreshold();
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT v.id
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory_levels l ON l.variant_id = v.id
    WHERE v.track_stock = 1 AND v.is_active = 1 AND p.status <> 'ARCHIVED'
    GROUP BY v.id, v.low_stock_threshold
    HAVING COALESCE(SUM(l.on_hand - l.reserved), 0) <= COALESCE(v.low_stock_threshold, ${threshold})`;
  lowCache = { value: rows.length, at: Date.now() };
  return rows.length;
}

export function resetLowStockCache() {
  lowCache = null;
}

export type LowStockRow = {
  variantId: number;
  productId: number;
  title: string;
  sku: string;
  variantName: string | null;
  available: number;
  threshold: number;
};

/** SKU dengan stok tersedia ≤ ambang, paling kritis dulu. */
export async function lowStockItems(limit = 8): Promise<LowStockRow[]> {
  const threshold = await defaultLowStockThreshold();
  const rows = await prisma.$queryRaw<
    { variantId: number; productId: number; title: string; sku: string; variantName: string | null; available: number | bigint; threshold: number | bigint }[]
  >`
    SELECT v.id AS variantId, p.id AS productId, p.title, v.sku, v.name AS variantName,
           CAST(COALESCE(SUM(l.on_hand - l.reserved), 0) AS SIGNED) AS available,
           CAST(COALESCE(v.low_stock_threshold, ${threshold}) AS SIGNED) AS threshold
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory_levels l ON l.variant_id = v.id
    WHERE v.track_stock = 1 AND v.is_active = 1 AND p.status <> 'ARCHIVED'
    GROUP BY v.id, p.id, p.title, v.sku, v.name, v.low_stock_threshold
    HAVING available <= threshold
    ORDER BY available ASC, p.title ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, available: Number(r.available), threshold: Number(r.threshold) }));
}
