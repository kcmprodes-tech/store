/**
 * Log perubahan CMS (siapa, kapan, apa). Admin melihat semua; peran lain hanya aktivitasnya sendiri.
 * Dibuka juga dari tombol "Riwayat" di form (filter entitas + id).
 */
import { Router } from 'express';
import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ACTION_LABELS, ENTITY_LABELS } from '../../audit.js';
import { handle, pageParam, q } from '../../http.js';
import { can } from '../../permissions.js';
import { fromDateTimeLocal } from '../../time.js';

export const logRouter = Router();
const PER_PAGE = 50;

/** Nilai untuk tabel sebelum → sesudah. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : s;
}

logRouter.get(
  '/log',
  handle(async (req, res) => {
    const admin = req.admin!;
    const seeAll = can(admin.roles, 'pengguna', 'view');
    const entity = q(req.query.entitas) in ENTITY_LABELS ? q(req.query.entitas) : '';
    const entityId = q(req.query.id).slice(0, 80);
    const actorId = seeAll ? Number(req.query.pelaku) || null : admin.id;
    const from = fromDateTimeLocal(q(req.query.dari) ? `${q(req.query.dari)}T00:00` : '');
    const to = fromDateTimeLocal(q(req.query.sampai) ? `${q(req.query.sampai)}T23:59` : '');
    const hideLogins = req.query.login !== '1';
    const page = pageParam(req.query.hal);

    const where: Prisma.AuditLogWhereInput = {
      ...(entity ? { entityType: entity } : {}),
      ...(entity && entityId ? { entityId } : {}),
      ...(actorId ? { adminUserId: actorId } : {}),
      ...(hideLogins && entity !== 'auth' ? { action: { notIn: ['login', 'logout'] } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [total, logs, actors] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
      seeAll ? prisma.adminUser.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }) : [],
    ]);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const base = new URLSearchParams(
      Object.entries({ entitas: entity, id: entityId, pelaku: seeAll && actorId ? String(actorId) : '', dari: q(req.query.dari), sampai: q(req.query.sampai), login: hideLogins ? '' : '1' }).filter(
        ([, v]) => v,
      ) as [string, string][],
    );
    const link = (p: number) => {
      const s = new URLSearchParams(base);
      if (p > 1) s.set('hal', String(p));
      return `/admin/log${s.toString() ? `?${s}` : ''}`;
    };
    const entityLabel = entity && entityId ? (logs[0]?.entityLabel ?? `#${entityId}`) : null;

    await res.renderAdmin('log/index', {
      pageTitle: 'Log perubahan',
      active: 'log',
      seeAll,
      total,
      entityFilter: entity ? { label: ENTITY_LABELS[entity], name: entityLabel } : null,
      filters: { entitas: entity, id: entityId, pelaku: actorId, dari: q(req.query.dari), sampai: q(req.query.sampai), login: !hideLogins },
      entities: Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })),
      actors,
      logs: logs.map((l) => ({
        ...l,
        actionLabel: ACTION_LABELS[l.action] ?? l.action,
        entityName: ENTITY_LABELS[l.entityType] ?? l.entityType,
        changeRows:
          l.changes && typeof l.changes === 'object'
            ? Object.entries(l.changes as Record<string, unknown>).map(([field, pair]) => {
                const [before, after] = Array.isArray(pair) && pair.length === 2 ? pair : [null, pair];
                return { field, before: show(before), after: show(after) };
              })
            : [],
      })),
      page,
      pages,
      prevHref: page > 1 ? link(page - 1) : null,
      nextHref: page < pages ? link(page + 1) : null,
    });
  }),
);
