/**
 * Log perubahan CMS: siapa, kapan, apa. Panggil di dalam transaksi yang sama dengan perubahannya,
 * supaya log tidak pernah tercatat untuk perubahan yang gagal (atau sebaliknya).
 */
import type { Request } from 'express';
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { clientIp } from './auth/session.js';

type Db = Prisma.TransactionClient | typeof prisma;

const IGNORED = new Set(['updatedAt', 'createdAt', 'passwordHash', 'password']);

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value ?? null;
}

/** Selisih dua objek: { field: [sebelum, sesudah] } untuk field yang berubah (password & timestamp diabaikan). */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const changes: Record<string, [unknown, unknown]> = {};
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const field of fields) {
    if (IGNORED.has(field)) continue;
    const a = normalize(before?.[field]);
    const b = normalize(after?.[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
}

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  summary?: string | null;
  changes?: Record<string, unknown> | null;
  /** Pelaku kalau belum ada sesi (mis. saat login); default = akun yang sedang login. */
  actor?: { id: number; email: string };
};

export async function audit(db: Db, req: Request, entry: AuditEntry) {
  const actor = entry.actor ?? req.admin;
  await db.auditLog.create({
    data: {
      adminUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? 'sistem',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      entityLabel: entry.entityLabel?.slice(0, 255) ?? null,
      summary: entry.summary?.slice(0, 255) ?? null,
      changes: entry.changes && Object.keys(entry.changes).length ? (entry.changes as Prisma.InputJsonValue) : undefined,
      ip: clientIp(req),
    },
  });
}

export const ENTITY_LABELS: Record<string, string> = {
  product: 'Produk',
  category: 'Kategori',
  banner: 'Banner',
  home_section: 'Seksi produk',
  collection: 'Koleksi',
  navigation_item: 'Menu & pintasan',
  stock: 'Stok',
  promo: 'Promo',
  setting: 'Pengaturan',
  admin_user: 'Pengguna CMS',
  auth: 'Login',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Menambah',
  update: 'Mengubah',
  delete: 'Menghapus',
  archive: 'Mengarsipkan',
  reorder: 'Mengurutkan',
  login: 'Login',
  logout: 'Logout',
  password: 'Mengganti password',
  'password.reset': 'Mereset password',
  'stock.in': 'Barang masuk',
  'stock.adjust': 'Penyesuaian stok',
};
