/**
 * Pengamanan HTTP bersama untuk store (CMS punya header sendiri di src/admin/index.ts).
 */
import type { NextFunction, Request, Response } from 'express';
import { isProd } from '../config/env.js';

/**
 * CSP store: hanya skrip dari domain sendiri + Google Sign-In (popup login kgOneTap); tanpa skrip inline.
 * Gaya inline masih diizinkan (atribut style di template), gambar boleh dari https mana pun (foto produk/CDN).
 */
const STORE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src 'self' https://accounts.google.com/gsi/",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

/** Header keamanan dasar untuk semua respons store & file statis. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  });
  if (!req.path.startsWith('/admin')) {
    res.set({
      'Content-Security-Policy': STORE_CSP,
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    });
  }
  // HSTS hanya lewat HTTPS di produksi (di localhost http akan membuat browser memaksa https)
  if (isProd && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/** Langsung dari mesin ini (bukan lewat tunnel/proxy): browser developer di localhost. */
export function isLocalRequest(req: Request) {
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  return loopback && !req.get('x-forwarded-for') && !req.get('cf-connecting-ip');
}

/** Detail error (stack trace) hanya untuk developer di localhost saat development, tidak lewat tunnel/internet. */
export function showDebugInfo(req: Request) {
  return !isProd && isLocalRequest(req);
}
