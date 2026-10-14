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
  pesanan: 'Pesanan',
  refund: 'Refund',
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
  CS: 'Pesanan: cari, hubungi pembeli, batalkan, ajukan refund; melihat produk, stok, promo',
  GUDANG: 'Kemas, resi, serah terima kurir, ambil di tempat, retur, dan stok',
  FINANCE: 'Setujui/tolak refund; melihat pesanan, produk, stok, promo',
};

const MATRIX: Record<AdminRole, Partial<Record<Module, Level>>> = {
  ADMIN: {
    produk: 'edit', kategori: 'edit', tampilan: 'edit', menu: 'edit',
    stok: 'edit', promo: 'edit', pengaturan: 'edit', pengguna: 'edit',
    pesanan: 'edit', refund: 'edit',
  },
  EDITOR: { produk: 'edit', kategori: 'edit', tampilan: 'edit', menu: 'edit', stok: 'view' },
  MARKETING: { produk: 'view', kategori: 'view', tampilan: 'edit', menu: 'view', promo: 'edit' },
  CS: { produk: 'view', stok: 'view', promo: 'view', pesanan: 'edit', refund: 'view' },
  GUDANG: { produk: 'view', stok: 'edit', pesanan: 'edit' },
  FINANCE: { produk: 'view', stok: 'view', promo: 'view', pesanan: 'view', refund: 'edit' },
};

/**
 * Aksi pesanan per peran (lebih rinci dari level modul).
 * Gudang mengurus barang (kemas, resi, serah terima, ambil, retur); CS mengurus pembeli (batal, ajukan refund);
 * Finance memutuskan refund. Admin semua.
 */
export const ACTIONS = {
  'order.view': ['ADMIN', 'CS', 'GUDANG', 'FINANCE'],
  'order.cancel': ['ADMIN', 'CS'],
  'order.complete': ['ADMIN', 'CS'],
  'order.fulfil': ['ADMIN', 'GUDANG'],
  'order.contact': ['ADMIN', 'CS', 'GUDANG'],
  'refund.request': ['ADMIN', 'CS'],
  'refund.decide': ['ADMIN', 'FINANCE'],
  'order.simulate': ['ADMIN'],
  // Penjualan & analitik di dashboard (omzet, produk terlaris, kategori, metode bayar)
  'sales.view': ['ADMIN', 'FINANCE', 'MARKETING'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Action = keyof typeof ACTIONS;

export function canDo(roles: readonly AdminRole[], action: Action) {
  return roles.some((r) => (ACTIONS[action] as readonly AdminRole[]).includes(r));
}

/** Peta { aksi: boolean } untuk template. */
export function actionMap(roles: readonly AdminRole[]) {
  return Object.fromEntries((Object.keys(ACTIONS) as Action[]).map((a) => [a.replace('.', '_'), canDo(roles, a)])) as Record<string, boolean>;
}

/** Urutan prioritas peran untuk halaman awal & menu HP bila akun punya beberapa peran. */
export const ROLE_PRIORITY: AdminRole[] = ['ADMIN', 'GUDANG', 'CS', 'FINANCE', 'EDITOR', 'MARKETING'];

export function primaryRole(roles: readonly AdminRole[]): AdminRole {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? 'CS';
}

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
