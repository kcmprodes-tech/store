/** Utilitas request/response CMS: handler async, flash message, validasi form (zod), guard hak akses. */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { can, type Level, type Module } from './permissions.js';

export type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const handle =
  (fn: Handler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ───────────── Flash message (cookie singkat, dibaca sekali) ─────────────

const FLASH_COOKIE = 'skc_admin_flash';
export type Flash = { type: 'success' | 'error' | 'info'; message: string };

export function setFlash(res: Response, type: Flash['type'], message: string) {
  res.cookie(FLASH_COOKIE, JSON.stringify({ type, message }), { httpOnly: true, sameSite: 'lax', path: '/admin', maxAge: 60_000 });
}

export function takeFlash(req: Request, res: Response): Flash | null {
  const raw = req.cookies?.[FLASH_COOKIE];
  if (typeof raw !== 'string') return null;
  res.clearCookie(FLASH_COOKIE, { path: '/admin' });
  try {
    const value = JSON.parse(raw) as Flash;
    return ['success', 'error', 'info'].includes(value.type) && typeof value.message === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Redirect dengan pesan, mis. setelah menyimpan. */
export function redirectWith(res: Response, url: string, type: Flash['type'], message: string) {
  setFlash(res, type, message);
  res.redirect(303, url);
}

// ───────────── Hak akses ─────────────

export function requirePermission(module: Module, level: Level = 'view'): RequestHandler {
  return (req, _res, next) => {
    if (req.admin && can(req.admin.roles, module, level)) return next();
    next(new HttpError(403, 'Anda tidak punya akses ke halaman ini.'));
  };
}

export function canEdit(req: Request, module: Module) {
  return Boolean(req.admin && can(req.admin.roles, module, 'edit'));
}

// ───────────── Validasi form ─────────────

/** Teks dari form: di-trim; kosong → null. */
export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : (v ?? null)), z.string().max(max, `Maksimal ${max} karakter.`).nullable());

export const requiredText = (max: number, label = 'Kolom ini') =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string({ error: `${label} wajib diisi.` }).min(1, `${label} wajib diisi.`).max(max, `Maksimal ${max} karakter.`),
  );

/** Checkbox HTML: ada = true, tidak ada = false. */
export const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === '1' || v === true, z.boolean());

/** Angka bulat dari input; kosong → null. */
export const optionalInt = (min = 0, max = 1_000_000_000) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(/[.\s]/g, ''))),
    z.number({ error: 'Harus berupa angka.' }).int('Harus bilangan bulat.').min(min, `Minimal ${min}.`).max(max, `Maksimal ${max}.`).nullable(),
  );

export const requiredInt = (min = 0, max = 1_000_000_000, label = 'Angka') =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(String(v).replace(/[.\s]/g, ''))),
    z.number({ error: `${label} wajib diisi.` }).int('Harus bilangan bulat.').min(min, `Minimal ${min}.`).max(max, `Maksimal ${max}.`),
  );

/** Slug URL: huruf kecil, angka, tanda hubung. */
export const slug = (max = 80) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().min(1, 'Wajib diisi.').max(max).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Hanya huruf kecil, angka, dan tanda hubung (-).'),
  );

/**
 * Link yang aman untuk dipasang di store: path relatif ("/koleksi/…", bukan "//…") atau https://.
 * Menolak javascript:, data:, http:, dan sejenisnya.
 */
export function isSafeUrl(value: string) {
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const safeUrl = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : (v ?? null)),
    z.string().max(max).refine(isSafeUrl, 'Link harus diawali "/" (halaman store) atau "https://".').nullable(),
  );

export type FormErrors = Record<string, string>;

export function parseForm<S extends z.ZodType>(schema: S, input: unknown):
  | { ok: true; data: z.infer<S> }
  | { ok: false; errors: FormErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_form';
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Teks → slug, mis. "Kaos Hitam #1" → "kaos-hitam-1". */
export function slugify(text: string, max = 80) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Nilai query string → teks (atau ''). */
export const q = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Nomor halaman dari query (?hal=2). */
export function pageParam(v: unknown) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
