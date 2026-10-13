/**
 * Hak akses CMS per peran (dokumen "User Flow & Kebutuhan CMS", tabel Peran & hak akses).
 * Level: 'edit' (boleh mengubah) atau 'view' (hanya melihat). Modul yang tidak tercantum = tidak boleh dibuka.
 * Satu akun bisa punya beberapa peran; level tertinggi yang dipakai.
 */
import type { AdminRole } from '../generated/prisma/client.js';

export const MODULES = {
  produk: 'Produk & varian',
  kategori: 'Kategori',
  tampilan: 'Banner & seksi beranda',
  menu: 'Koleksi, menu & pintasan',
  stok: 'Stok',
  promo: 'Promo',
  pengaturan: 'Pengaturan',
  pengguna: 'Pengguna CMS & log',
} as const;

export type Module = keyof typeof MODULES;
export type Level = 'view' | 'edit';

export const ROLE_LABELS: Record<AdminRole, string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  MARKETING: 'Marketing',
  CS: 'CS / Order',
  GUDANG: 'Gudang',
  FINANCE: 'Finance',
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  ADMIN: 'Semua modul, termasuk pengguna CMS dan pengaturan',
  EDITOR: 'Produk, kategori, tampilan beranda, koleksi & menu; melihat stok',
  MARKETING: 'Promo, banner & seksi beranda; melihat produk',
  CS: 'Melihat produk, stok, dan promo (modul pesanan menyusul)',
  GUDANG: 'Stok: barang masuk & penyesuaian; melihat produk',
  FINANCE: 'Melihat produk, stok, dan promo (refund & laporan menyusul)',
};

const MATRIX: Record<AdminRole, Partial<Record<Module, Level>>> = {
  ADMIN: {
    produk: 'edit', kategori: 'edit', tampilan: 'edit', menu: 'edit',
    stok: 'edit', promo: 'edit', pengaturan: 'edit', pengguna: 'edit',
  },
  EDITOR: { produk: 'edit', kategori: 'edit', tampilan: 'edit', menu: 'edit', stok: 'view' },
  MARKETING: { produk: 'view', kategori: 'view', tampilan: 'edit', menu: 'view', promo: 'edit' },
  CS: { produk: 'view', stok: 'view', promo: 'view' },
  GUDANG: { produk: 'view', stok: 'edit' },
  FINANCE: { produk: 'view', stok: 'view', promo: 'view' },
};

export function levelFor(roles: readonly AdminRole[], module: Module): Level | null {
  let level: Level | null = null;
  for (const role of roles) {
    const l = MATRIX[role]?.[module];
    if (l === 'edit') return 'edit';
    if (l === 'view') level = 'view';
  }
  return level;
}

export function can(roles: readonly AdminRole[], module: Module, level: Level = 'view') {
  const l = levelFor(roles, module);
  return level === 'view' ? l !== null : l === 'edit';
}

/** Peta { modul: level } untuk template (menu & tombol ubah). */
export function permissionMap(roles: readonly AdminRole[]) {
  return Object.fromEntries(
    (Object.keys(MODULES) as Module[]).map((m) => {
      const l = levelFor(roles, m);
      return [m, { view: l !== null, edit: l === 'edit' }];
    }),
  ) as Record<Module, { view: boolean; edit: boolean }>;
}

export const ALL_ROLES = Object.keys(ROLE_LABELS) as AdminRole[];
