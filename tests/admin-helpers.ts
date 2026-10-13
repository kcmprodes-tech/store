/**
 * Utilitas tes CMS: akun uji sementara (dihapus lagi setelah tes) dan agen supertest yang sudah login.
 * Semua request non-GET memakai Origin yang sama dengan Host, seperti browser sungguhan.
 */
import request from 'supertest';
import type { Express } from 'express';
import { hashPassword } from '../src/admin/auth/password.js';
import { prisma } from '../src/lib/prisma.js';
import type { AdminRole } from '../src/generated/prisma/client.js';

export const HOST = 'cms.test';
export const ORIGIN = `http://${HOST}`;
export const PASSWORD = 'Rahasia-Uji-123';

let seq = 0;

export async function createAdmin(roles: AdminRole[], opts: { mustChangePassword?: boolean; isActive?: boolean } = {}) {
  seq += 1;
  const email = `tes-${Date.now().toString(36)}-${seq}@cms.test`;
  return prisma.adminUser.create({
    data: {
      email,
      name: `Tes ${roles.join(' ')}`,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
      roles: { create: roles.map((role) => ({ role })) },
    },
  });
}

export async function deleteAdmins(ids: number[]) {
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: ids } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
}

export type Agent = ReturnType<typeof request.agent>;

export function agent(app: Express) {
  return request.agent(app);
}

/** POST dari "browser": Host + Origin sama. */
export function post(a: Agent, url: string) {
  return a.post(url).set('Host', HOST).set('Origin', ORIGIN);
}

export function get(a: Agent, url: string) {
  return a.get(url).set('Host', HOST);
}

export async function login(a: Agent, email: string, password = PASSWORD) {
  return post(a, '/admin/login').type('form').send({ email, password, next: '/admin' });
}

/** Token CSRF dari halaman CMS yang sedang login. */
export async function csrfToken(a: Agent) {
  const res = await get(a, '/admin');
  const token = /<meta name="csrf-token" content="([^"]+)">/.exec(res.text)?.[1];
  if (!token) throw new Error(`CSRF token tidak ditemukan (status ${res.status})`);
  return token;
}

/** Agen yang sudah login + token CSRF-nya. */
export async function loggedIn(app: Express, roles: AdminRole[]) {
  const user = await createAdmin(roles);
  const a = agent(app);
  const res = await login(a, user.email);
  if (res.status !== 303) throw new Error(`login gagal: ${res.status}`);
  return { user, agent: a, csrf: await csrfToken(a) };
}

/** POST form dengan token CSRF. */
export function postForm(a: Agent, url: string, csrf: string, data: Record<string, unknown> = {}) {
  return post(a, url).type('form').send({ _csrf: csrf, ...data });
}

/** POST JSON dengan token CSRF di header. */
export function postJson(a: Agent, url: string, csrf: string, data: unknown) {
  return post(a, url).set('X-CSRF-Token', csrf).set('X-Requested-With', 'fetch').set('Accept', 'application/json').send(data as object);
}
