import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { requirePermission } from '../auth/current-user';
import { parseQuery } from '../http/validate';

/**
 * The audit log, read-only.
 *
 * There is deliberately no route here to write, edit or delete an entry: a log
 * that the people it records can tidy up is not a log. Rows are written only
 * by recordAudit, alongside the change they describe.
 *
 * The hashed IP and user agent stay out of this screen. They exist for an
 * investigation, not for colleagues browsing each other's activity.
 */
export const adminAuditRouter = Router();

const listSchema = z.object({
  /** The part of an action before the dot: "order", "coupon", "staff". */
  area: z
    .string()
    .trim()
    .max(32)
    .regex(/^[a-z_]+$/, 'Unknown area.')
    .optional(),
  actor: z.string().trim().max(120).optional(),
  entityId: z.string().trim().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminAuditRouter.get('/admin/audit', async (req, res) => {
  await requirePermission(req, 'audit.read');
  const { area, actor, entityId, cursor, limit } = parseQuery(req, listSchema);

  const where: Prisma.AuditLogWhereInput = {
    ...(area ? { action: { startsWith: `${area}.` } } : {}),
    ...(actor ? { actorEmail: { contains: actor, mode: 'insensitive' } } : {}),
    ...(entityId ? { entityId } : {}),
  };

  const [rows, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      // id breaks ties between entries written in the same millisecond, so the
      // cursor never skips or repeats one.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        actorEmail: true,
        actorRole: true,
        diff: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
  ]);

  // One tab per area, counting every action within it.
  const areaCounts = new Map<string, number>();
  for (const row of actions) {
    const name = row.action.split('.')[0];
    areaCounts.set(name, (areaCounts.get(name) ?? 0) + row._count._all);
  }

  const page = rows.slice(0, limit);

  res.json({
    items: page,
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    areas: [...areaCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});
