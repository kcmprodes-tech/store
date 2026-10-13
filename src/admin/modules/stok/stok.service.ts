/**
 * Stok per SKU. Tersedia = fisik (on_hand) − dipesan (reserved), dijumlah semua lokasi.
 * Setiap perubahan stok ditulis ke buku besar stock_movements dalam transaksi yang sama.
 */
import type { Request } from 'express';
import { getSettings } from '../../../lib/settings.js';
import { prisma } from '../../../lib/prisma.js';
import type { Prisma, StockMovementType } from '../../../generated/prisma/client.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  IN: 'Barang masuk',
  OUT: 'Keluar',
  ADJUST: 'Penyesuaian',
  RESERVE: 'Dipesan',
  RELEASE: 'Batal dipesan',
  RETURN: 'Retur',
  TRANSFER: 'Transfer',
};

export const ADJUST_REASONS = ['Hitung ulang (opname)', 'Rusak', 'Hilang', 'Retur dari pembeli', 'Salah input', 'Lainnya'] as const;

/** Gudang utama (saat ini hanya Palmerah). */
export async function mainLocation(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const location = await db.stockLocation.findFirst({ where: { type: 'WAREHOUSE', isActive: true }, orderBy: { id: 'asc' } });
  if (!location) throw new HttpError(500, 'Lokasi gudang belum diatur.');
  return location;
}

export type StockRow = {
  variantId: number;
  productId: number;
  title: string;
  variantName: string | null;
  sku: string;
  image: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  customThreshold: boolean;
  state: 'habis' | 'menipis' | 'aman';
  productStatus: string;
};

/** Semua SKU yang stoknya dilacak (produk belum diarsipkan), dengan jumlah per status. */
export async function stockRows(): Promise<StockRow[]> {
  const threshold = await defaultLowStockThreshold();
  const variants = await prisma.productVariant.findMany({
    where: { trackStock: true, isActive: true, product: { status: { not: 'ARCHIVED' } } },
    orderBy: [{ product: { title: 'asc' } }, { sortOrder: 'asc' }],
    include: { inventory: true, product: { select: { id: true, title: true, status: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } },
  });
  return variants.map((v) => {
    const onHand = v.inventory.reduce((n, l) => n + l.onHand, 0);
    const reserved = v.inventory.reduce((n, l) => n + l.reserved, 0);
    const available = onHand - reserved;
    const t = v.lowStockThreshold ?? threshold;
    return {
      variantId: v.id,
      productId: v.product.id,
      title: v.product.title,
      variantName: v.name,
      sku: v.sku,
      image: v.product.images[0]?.url ?? '',
      onHand,
      reserved,
      available,
      threshold: t,
      customThreshold: v.lowStockThreshold !== null,
      state: available <= 0 ? 'habis' : available <= t ? 'menipis' : 'aman',
      productStatus: v.product.status,
    };
  });
}

type Actor = { email: string };

/** Barang masuk: tambah stok fisik (atomik) + catat mutasi IN. */
export async function stockIn(
  tx: Prisma.TransactionClient,
  req: Request & { admin?: Actor },
  rows: { variantId: number; qty: number }[],
  ref: { refId: string | null; note: string | null },
) {
  const location = await mainLocation(tx);
  for (const row of rows) {
    await tx.inventoryLevel.upsert({
      where: { variantId_locationId: { variantId: row.variantId, locationId: location.id } },
      create: { variantId: row.variantId, locationId: location.id, onHand: row.qty },
      update: { onHand: { increment: row.qty } },
    });
    await tx.stockMovement.create({
      data: {
        variantId: row.variantId,
        locationId: location.id,
        type: 'IN',
        qtyDelta: row.qty,
        refType: 'barang-masuk',
        refId: ref.refId,
        note: ref.note,
        createdBy: req.admin?.email ?? null,
      },
    });
  }
  const skus = await tx.productVariant.findMany({ where: { id: { in: rows.map((r) => r.variantId) } }, select: { id: true, sku: true } });
  const skuOf = new Map(skus.map((s) => [s.id, s.sku]));
  await audit(tx, req, {
    action: 'stock.in',
    entityType: 'stock',
    entityId: ref.refId,
    entityLabel: ref.refId ? `Ref. ${ref.refId}` : null,
    summary: rows.map((r) => `${skuOf.get(r.variantId)} +${r.qty}`).join(', '),
    changes: { rows: [null, rows.map((r) => ({ sku: skuOf.get(r.variantId), qty: r.qty }))] },
  });
}

/**
 * Penyesuaian stok fisik satu SKU (baris stok dikunci selama transaksi).
 * mode "set": jumlah fisik dihitung = qty; mode "delta": tambah/kurang qty.
 */
export async function adjustStock(
  tx: Prisma.TransactionClient,
  req: Request & { admin?: Actor },
  input: { variantId: number; mode: 'set' | 'delta'; qty: number; reason: string; note: string | null; allowBelowReserved: boolean },
) {
  const location = await mainLocation(tx);
  await tx.inventoryLevel.upsert({
    where: { variantId_locationId: { variantId: input.variantId, locationId: location.id } },
    create: { variantId: input.variantId, locationId: location.id, onHand: 0 },
    update: {},
  });
  const [level] = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    SELECT on_hand AS onHand, reserved FROM inventory_levels
    WHERE variant_id = ${input.variantId} AND location_id = ${location.id} FOR UPDATE`;
  const onHand = Number(level!.onHand);
  const reserved = Number(level!.reserved);
  const next = input.mode === 'set' ? input.qty : onHand + input.qty;
  const delta = next - onHand;
  if (next < 0) return { error: `Stok fisik tidak boleh minus (sekarang ${onHand}).` } as const;
  if (next < reserved && !input.allowBelowReserved) return { warning: { onHand, reserved, next } } as const;
  if (delta === 0) return { error: 'Tidak ada perubahan: jumlahnya sama dengan stok fisik sekarang.' } as const;

  await tx.inventoryLevel.update({
    where: { variantId_locationId: { variantId: input.variantId, locationId: location.id } },
    data: { onHand: next },
  });
  const note = [input.reason, input.note].filter(Boolean).join(' — ').slice(0, 500);
  await tx.stockMovement.create({
    data: { variantId: input.variantId, locationId: location.id, type: 'ADJUST', qtyDelta: delta, refType: 'penyesuaian', note, createdBy: req.admin?.email ?? null },
  });
  const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: input.variantId }, select: { sku: true } });
  await audit(tx, req, {
    action: 'stock.adjust',
    entityType: 'stock',
    entityId: input.variantId,
    entityLabel: variant.sku,
    summary: `${variant.sku}: ${onHand} → ${next} (${delta > 0 ? '+' : ''}${delta}) · ${input.reason}`,
    changes: { onHand: [onHand, next] },
  });
  return { ok: { before: onHand, after: next, delta, sku: variant.sku } } as const;
}

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
