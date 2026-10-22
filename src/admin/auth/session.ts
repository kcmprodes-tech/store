/**
 * Sesi login CMS. Cookie berisi token acak; database hanya menyimpan SHA-256 token itu.
 * Sesi berakhir setelah 8 jam tanpa aktivitas, dan paling lama 12 jam sejak login (OWASP ASVS 3.3),
 * jadi perangkat gudang/HP yang tertinggal tidak tetap masuk ke akun berhari-hari.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { isProd } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import type { AdminRole } from '../../generated/prisma/client.js';

export const SESSION_COOKIE = 'skc_admin';
const IDLE_MS = 8 * 3600_000;
const MAX_AGE_MS = 12 * 3600_000;
/** lastSeenAt diperbarui paling sering tiap 5 menit, supaya tidak menulis DB di setiap request. */
const TOUCH_MS = 5 * 60_000;

export type AdminContext = {
  id: number;
  email: string;
  name: string;
  roles: AdminRole[];
  mustChangePassword: boolean;
  sessionId: string;
  csrfToken: string;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Secure di produksi, dan juga setiap kali diakses lewat HTTPS (mis. tunnel saat development). */
export const cookieOptions = (req?: Request) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd || Boolean(req?.secure),
  path: '/admin',
});

export function clientIp(req: Request) {
  return (req.ip ?? '').slice(0, 64) || null;
}

/** Buat sesi baru (selalu token baru setiap login) dan pasang cookie-nya. */
export async function createSession(req: Request, res: Response, adminUserId: number) {
  const token = randomBytes(32).toString('base64url');
  await prisma.adminSession.create({
    data: {
      id: sha256(token),
      adminUserId,
      csrfToken: randomBytes(32).toString('base64url'),
      ip: clientIp(req),
      userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null,
      expiresAt: new Date(Date.now() + MAX_AGE_MS),
    },
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: MAX_AGE_MS });
}

/** Sesi dari cookie; null kalau tidak ada, kedaluwarsa, atau akunnya nonaktif. */
export async function loadSession(req: Request): Promise<AdminContext | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const session = await prisma.adminSession.findUnique({
    where: { id },
    include: { adminUser: { include: { roles: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + IDLE_MS <= now || !session.adminUser.isActive) {
    await prisma.adminSession.deleteMany({ where: { id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_MS) {
    await prisma.adminSession.update({ where: { id }, data: { lastSeenAt: new Date(now) } });
  }
  const user = session.adminUser;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role),
    mustChangePassword: user.mustChangePassword,
    sessionId: id,
    csrfToken: session.csrfToken,
  };
}

export async function destroySession(req: Request, res: Response) {
  if (req.admin) await prisma.adminSession.deleteMany({ where: { id: req.admin.sessionId } });
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

/** Cabut semua sesi akun (ganti password, nonaktif, ubah peran); `keepSessionId` = sesi yang sedang dipakai. */
export function revokeSessions(adminUserId: number, keepSessionId?: string) {
  return prisma.adminSession.deleteMany({
    where: { adminUserId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
}
