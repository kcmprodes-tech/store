/**
 * Pengguna CMS (Admin): tambah akun, ubah peran, nonaktifkan, reset password.
 * Password sementara ditampilkan sekali di halaman hasil (tidak lewat redirect/cookie) dan wajib diganti saat login.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import type { AdminRole } from '../../../generated/prisma/client.js';
import { generatePassword, hashPassword } from '../../auth/password.js';
import { revokeSessions } from '../../auth/session.js';
import { audit } from '../../audit.js';
import { checkbox, handle, HttpError, parseForm, redirectWith, requiredText, requirePermission } from '../../http.js';
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../permissions.js';

export const penggunaRouter = Router();
penggunaRouter.use('/pengguna', requirePermission('pengguna', 'edit'));

const rolesField = z.preprocess(
  (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []),
  z.array(z.enum(ALL_ROLES as [AdminRole, ...AdminRole[]])).min(1, 'Pilih minimal satu peran.'),
);

const createSchema = z.object({
  name: requiredText(120, 'Nama'),
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().email('Email tidak valid.').max(191)),
  roles: rolesField,
});
const updateSchema = z.object({ name: requiredText(120, 'Nama'), roles: rolesField, isActive: checkbox });

const roleOptions = ALL_ROLES.map((role) => ({ role, label: ROLE_LABELS[role], desc: ROLE_DESCRIPTIONS[role] }));

/** Jumlah Admin aktif selain akun `exceptId`. */
const otherActiveAdmins = (exceptId: number) =>
  prisma.adminUser.count({ where: { id: { not: exceptId }, isActive: true, roles: { some: { role: 'ADMIN' } } } });

function showPassword(res: Response, data: { user: { id: number; name: string; email: string }; password: string; isNew: boolean }) {
  return res.renderAdmin('pengguna/password', { pageTitle: data.isNew ? 'Akun dibuat' : 'Password direset', active: 'pengguna', backHref: '/admin/pengguna', ...data });
}

penggunaRouter.get(
  '/pengguna',
  handle(async (req, res) => {
    const users = await prisma.adminUser.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { roles: true, _count: { select: { sessions: true } } },
    });
    await res.renderAdmin('pengguna/index', {
      pageTitle: 'Pengguna CMS',
      active: 'pengguna',
      users: users.map((u) => ({ ...u, roleList: u.roles.map((r) => ROLE_LABELS[r.role]), isSelf: u.id === req.admin!.id })),
    });
  }),
);

penggunaRouter.get(
  '/pengguna/baru',
  handle(async (_req, res) => {
    await res.renderAdmin('pengguna/form', { pageTitle: 'Pengguna baru', active: 'pengguna', backHref: '/admin/pengguna', roleOptions, values: { roles: [], isActive: true } });
  }),
);

penggunaRouter.post(
  '/pengguna',
  handle(async (req, res) => {
    const parsed = parseForm(createSchema, req.body);
    const errors: Record<string, string> = parsed.ok ? {} : parsed.errors;
    if (parsed.ok && (await prisma.adminUser.findUnique({ where: { email: parsed.data.email } }))) errors.email = 'Email ini sudah punya akun CMS.';
    if (!parsed.ok || Object.keys(errors).length) {
      return res.renderAdmin('pengguna/form', { pageTitle: 'Pengguna baru', active: 'pengguna', backHref: '/admin/pengguna', roleOptions, values: { ...req.body, roles: [req.body?.roles ?? []].flat() }, errors }, 400);
    }
    const { name, email, roles } = parsed.data;
    const password = generatePassword();
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: { name, email, passwordHash: await hashPassword(password), mustChangePassword: true, roles: { create: roles.map((role) => ({ role })) } },
      });
      await audit(tx, req, { action: 'create', entityType: 'admin_user', entityId: created.id, entityLabel: email, changes: { name: [null, name], email: [null, email], roles: [null, roles] } });
      return created;
    });
    await showPassword(res, { user, password, isNew: true });
  }),
);

async function loadUser(req: Request) {
  const user = await prisma.adminUser.findUnique({ where: { id: Number(req.params.id) }, include: { roles: true } });
  if (!user) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  return user;
}

penggunaRouter.get(
  '/pengguna/:id',
  handle(async (req, res) => {
    const user = await loadUser(req);
    await res.renderAdmin('pengguna/form', {
      pageTitle: user.name,
      active: 'pengguna',
      backHref: '/admin/pengguna',
      roleOptions,
      user,
      isSelf: user.id === req.admin!.id,
      values: { ...user, roles: user.roles.map((r) => r.role) },
    });
  }),
);

penggunaRouter.post(
  '/pengguna/:id',
  handle(async (req, res) => {
    const user = await loadUser(req);
    const isSelf = user.id === req.admin!.id;
    const parsed = parseForm(updateSchema, req.body);
    const errors: Record<string, string> = parsed.ok ? {} : parsed.errors;
    if (parsed.ok) {
      const losesAdmin = user.roles.some((r) => r.role === 'ADMIN') && (!parsed.data.roles.includes('ADMIN') || !parsed.data.isActive);
      if (losesAdmin && (await otherActiveAdmins(user.id)) === 0) errors.roles = 'Harus ada minimal satu Admin aktif.';
      if (isSelf && !parsed.data.isActive) errors.isActive = 'Anda tidak bisa menonaktifkan akun sendiri.';
    }
    if (!parsed.ok || Object.keys(errors).length) {
      return res.renderAdmin(
        'pengguna/form',
        { pageTitle: user.name, active: 'pengguna', backHref: '/admin/pengguna', roleOptions, user, isSelf, values: { ...req.body, roles: [req.body?.roles ?? []].flat() }, errors },
        400,
      );
    }
    const { name, roles, isActive } = parsed.data;
    const beforeRoles = user.roles.map((r) => r.role).sort();
    const rolesChanged = JSON.stringify(beforeRoles) !== JSON.stringify([...roles].sort());
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: user.id }, data: { name, isActive } });
      if (rolesChanged) {
        await tx.adminUserRole.deleteMany({ where: { adminUserId: user.id } });
        await tx.adminUserRole.createMany({ data: roles.map((role) => ({ adminUserId: user.id, role })) });
      }
      const changes: Record<string, [unknown, unknown]> = {};
      if (user.name !== name) changes.name = [user.name, name];
      if (user.isActive !== isActive) changes.isActive = [user.isActive, isActive];
      if (rolesChanged) changes.roles = [beforeRoles, roles];
      await audit(tx, req, { action: 'update', entityType: 'admin_user', entityId: user.id, entityLabel: user.email, changes });
    });
    // Peran berubah / akun dinonaktifkan → semua sesinya dicabut (akun sendiri tetap masuk).
    if (rolesChanged || !isActive) await revokeSessions(user.id, isSelf ? req.admin!.sessionId : undefined);
    redirectWith(res, '/admin/pengguna', 'success', `Akun ${user.email} disimpan.${rolesChanged && !isSelf ? ' Pengguna perlu login ulang.' : ''}`);
  }),
);

penggunaRouter.post(
  '/pengguna/:id/reset-password',
  handle(async (req, res) => {
    const user = await loadUser(req);
    if (user.id === req.admin!.id) return redirectWith(res, '/admin/akun/password', 'info', 'Untuk akun sendiri, ganti password di halaman ini.');
    const password = generatePassword();
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true } });
      await audit(tx, req, { action: 'password.reset', entityType: 'admin_user', entityId: user.id, entityLabel: user.email });
    });
    await revokeSessions(user.id);
    await showPassword(res, { user, password, isNew: false });
  }),
);
