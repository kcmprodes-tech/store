/**
 * Engine Handlebars ketiga untuk CMS (views/admin): satu template responsif untuk desktop & HP.
 * res.renderAdmin(view, data) menambahkan akun, hak akses, navigasi, CSRF token, dan flash message.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { create } from 'express-handlebars';
import Handlebars from 'handlebars';
import { isProd } from '../config/env.js';
import { formatNumber, formatRupiah } from '../lib/format.js';
import { assetVersion, helpers as storeHelpers } from '../view/engine.js';
import type { AdminRole } from '../generated/prisma/client.js';
import { takeFlash } from './http.js';
import { permissionMap, ROLE_LABELS, type Module } from './permissions.js';
import { formatDate, formatDateTime, toDateTimeLocal } from './time.js';
import { lowStockCount } from './modules/stok/stok.service.js';

const viewsRoot = join(process.cwd(), 'views', 'admin');
const iconRoot = join(process.cwd(), 'node_modules', '@phosphor-icons', 'core', 'assets');

const iconCache = new Map<string, string>();

/** SVG ikon Phosphor (https://phosphoricons.com), mis. {{icon "package"}} atau {{icon "check" size=16 weight="bold"}}. */
function iconSvg(name: string, weight: string) {
  const key = `${weight}/${name}`;
  let svg = iconCache.get(key);
  if (svg === undefined) {
    svg = '';
    if (/^[a-z0-9-]+$/.test(name) && /^(regular|bold|fill|light|thin|duotone)$/.test(weight)) {
      try {
        svg = readFileSync(join(iconRoot, weight, weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`), 'utf8').trim();
      } catch {
        if (!isProd) console.warn(`[admin] ikon tidak ditemukan: ${key}`);
      }
    }
    iconCache.set(key, svg);
  }
  return svg;
}

type HelperOptions = { hash: Record<string, unknown> };

const helpers = {
  ...storeHelpers,
  icon(name: string, options: HelperOptions) {
    const size = Number(options.hash.size ?? 20);
    const weight = String(options.hash.weight ?? 'regular');
    const cls = options.hash.class ? ` ${String(options.hash.class)}` : '';
    const svg = iconSvg(String(name), weight).replace(
      '<svg ',
      `<svg class="ph${Handlebars.escapeExpression(cls)}" width="${size}" height="${size}" aria-hidden="true" focusable="false" `,
    );
    return new Handlebars.SafeString(svg);
  },
  rupiah: (n: unknown) => (n === null || n === undefined || n === '' ? '' : formatRupiah(Number(n))),
  number: (n: unknown) => (n === null || n === undefined || n === '' ? '' : formatNumber(Number(n))),
  datetime: (d: unknown) => formatDateTime(d as Date),
  date: (d: unknown) => formatDate(d as Date),
  dtlocal: (d: unknown) => toDateTimeLocal(d as Date),
  roleLabel: (r: AdminRole) => ROLE_LABELS[r] ?? r,
  includes: (list: unknown, value: unknown) => Array.isArray(list) && list.includes(value),
  not: (v: unknown) => !v,
  or: (...args: unknown[]) => args.slice(0, -1).some(Boolean),
  and: (...args: unknown[]) => args.slice(0, -1).every(Boolean),
  gt: (a: unknown, b: unknown) => Number(a) > Number(b),
  lte: (a: unknown, b: unknown) => Number(a) <= Number(b),
  selected: (a: unknown, b: unknown) => (String(a ?? '') === String(b ?? '') ? 'selected' : ''),
  checked: (v: unknown) => (v ? 'checked' : ''),
  /** Nilai field form: data yang baru dikirim (kalau ada error) atau nilai dari database. */
  pick: (...args: unknown[]) => args.slice(0, -1).find((v) => v !== undefined && v !== null) ?? '',
  concat: (...args: unknown[]) => args.slice(0, -1).join(''),
  /** Pilih nilai: (ifv kondisi "a" "b"). */
  ifv: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
  /** Inisial nama untuk avatar, mis. "Ardi Suhanda" → "AS". */
  initials: (name: unknown) =>
    String(name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(''),
};

const engine = create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: join(viewsRoot, 'layouts'),
  partialsDir: join(viewsRoot, 'partials'),
  helpers,
});

// ───────────── Navigasi ─────────────

type NavItem = { key: string; label: string; href: string; icon: string; module?: Module; badge?: number };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: null, items: [{ key: 'dasbor', label: 'Dasbor', href: '/admin', icon: 'squares-four' }] },
  {
    label: 'Katalog',
    items: [
      { key: 'produk', label: 'Produk', href: '/admin/produk', icon: 'package', module: 'produk' },
      { key: 'kategori', label: 'Kategori', href: '/admin/kategori', icon: 'tree-structure', module: 'kategori' },
    ],
  },
  {
    label: 'Tampilan store',
    items: [
      { key: 'banner', label: 'Banner hero', href: '/admin/banner', icon: 'image', module: 'tampilan' },
      { key: 'seksi', label: 'Seksi produk', href: '/admin/seksi', icon: 'rows', module: 'tampilan' },
      { key: 'koleksi', label: 'Koleksi', href: '/admin/koleksi', icon: 'stack', module: 'menu' },
      { key: 'menu', label: 'Menu & pintasan', href: '/admin/menu', icon: 'list-bullets', module: 'menu' },
    ],
  },
  {
    label: 'Operasional',
    items: [
      { key: 'stok', label: 'Stok', href: '/admin/stok', icon: 'warehouse', module: 'stok' },
      { key: 'promo', label: 'Promo', href: '/admin/promo', icon: 'ticket', module: 'promo' },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { key: 'pengaturan', label: 'Pengaturan', href: '/admin/pengaturan', icon: 'gear-six', module: 'pengaturan' },
      { key: 'pengguna', label: 'Pengguna CMS', href: '/admin/pengguna', icon: 'users-three', module: 'pengguna' },
      { key: 'log', label: 'Log perubahan', href: '/admin/log', icon: 'clock-counter-clockwise' },
    ],
  },
];

/** Menu bawah di HP: Dasbor + 3 modul yang paling sering dipakai peran utama akun. */
const MOBILE_PRIORITY: Record<AdminRole, string[]> = {
  ADMIN: ['produk', 'stok', 'promo'],
  EDITOR: ['produk', 'seksi', 'kategori'],
  MARKETING: ['promo', 'banner', 'seksi'],
  CS: ['produk', 'stok', 'promo'],
  GUDANG: ['stok', 'produk', 'log'],
  FINANCE: ['promo', 'stok', 'produk'],
};

function buildNav(roles: AdminRole[], active: string | undefined, badges: Partial<Record<string, number>>) {
  const perms = permissionMap(roles);
  const groups = NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((i) => !i.module || perms[i.module].view)
      .map((i) => ({ ...i, active: i.key === active, badge: badges[i.key] || 0 })),
  })).filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const primary = roles[0] ?? 'CS';
  const bottom = [all[0], ...MOBILE_PRIORITY[primary].map((k) => all.find((i) => i.key === k)).filter((i) => i !== undefined)].slice(0, 4);
  const moreActive = !bottom.some((i) => i.active);
  return { groups, bottom, moreActive };
}

// ───────────── Render ─────────────

export function adminRenderMiddleware(req: Request, res: Response, next: NextFunction) {
  res.renderAdmin = async (view, data = {}, status = 200) => {
    const admin = req.admin ?? null;
    const perms = admin ? permissionMap(admin.roles) : null;
    const badges: Record<string, number> = {};
    if (perms?.stok.view) badges.stok = await lowStockCount();
    const html = await engine.renderView(join(viewsRoot, 'pages', `${view}.hbs`), {
      admin,
      perms,
      nav: admin ? buildNav(admin.roles, data.active as string | undefined, badges) : null,
      roleNames: admin?.roles.map((r) => ROLE_LABELS[r]).join(', '),
      csrfToken: admin?.csrfToken ?? '',
      flash: takeFlash(req, res),
      assetVersion,
      cache: isProd,
      ...data,
    });
    res.status(status).type('html').send(html);
  };
  next();
}
