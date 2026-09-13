import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { couponSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma-errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Discount codes.
 *
 * A code that has been used is never edited into something else and never
 * deleted: orders reference it, and changing the terms under an order that
 * already took the discount rewrites history. Spent codes are switched off
 * instead, which stops new uses and leaves the record intact.
 */
export const adminCouponsRouter = Router();

const listSchema = z.object({
  state: z.enum(['active', 'scheduled', 'expired', 'inactive']).optional(),
  q: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminCouponsRouter.get('/admin/coupons', async (req, res) => {
  await requirePermission(req, 'coupon.read');
  const { state, q, limit } = parseQuery(req, listSchema);

  const now = new Date();

  // "Active" means live right now: switched on, started, and not yet ended.
  const stateFilter: Record<string, Prisma.CouponWhereInput> = {
    active: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    scheduled: { isActive: true, startsAt: { gt: now } },
    expired: { endsAt: { lte: now } },
    inactive: { isActive: false },
  };

  const where: Prisma.CouponWhereInput = {
    ...(state ? stateFilter[state] : {}),
    ...(q ? { code: { contains: q.toUpperCase() } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { _count: { select: { orders: true } } },
    }),
    prisma.coupon.count({ where }),
  ]);

  res.json({
    items: items.map(({ _count, ...coupon }) => ({ ...coupon, orderCount: _count.orders })),
    total,
  });
});

adminCouponsRouter.get('/admin/coupons/:id', async (req, res) => {
  await requirePermission(req, 'coupon.read');

  const coupon = await prisma.coupon.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { orders: true } } },
  });
  if (!coupon) throw new NotFoundError('Coupon');

  const { _count, ...rest } = coupon;
  res.json({ coupon: { ...rest, orderCount: _count.orders } });
});

/** Turns the unique-code constraint into something a person can act on. */
function rethrowCollision(error: unknown): never {
  if (isUniqueViolation(error, 'code')) {
    throw new ConflictError('That code already exists. Pick another.');
  }
  throw error;
}

adminCouponsRouter.post('/admin/coupons', async (req, res) => {
  const actor = await requirePermission(req, 'coupon.write');
  const input = parseBody(req, couponSchema);

  try {
    const coupon = await prisma.coupon.create({ data: input });

    await recordAudit({
      actor: actorFrom(actor),
      action: 'coupon.create',
      entityType: 'Coupon',
      entityId: coupon.id,
      summary: `Created ${coupon.code}`,
      after: input,
      ip: ipHash(req),
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(201).json({ coupon });
  } catch (error) {
    rethrowCollision(error);
  }
});

adminCouponsRouter.patch('/admin/coupons/:id', async (req, res) => {
  const actor = await requirePermission(req, 'coupon.write');
  const input = parseBody(req, couponSchema);

  const before = await prisma.coupon.findUnique({ where: { id: req.params.id } });
  if (!before) throw new NotFoundError('Coupon');

  /*
   * Once a code has been redeemed its terms are frozen. Switching it off or
   * ending it early is still allowed — both only ever reduce what it can do
   * from here on, and neither touches an order that already used it.
   */
  if (before.usedCount > 0) {
    const frozen: (keyof typeof input)[] = [
      'code',
      'type',
      'value',
      'maxDiscount',
      'minOrderSubtotal',
      'appliesToCategoryIds',
      'appliesToProductIds',
      'firstOrderOnly',
    ];

    const changed = frozen.filter(
      (field) => JSON.stringify(input[field]) !== JSON.stringify(before[field]),
    );

    if (changed.length > 0) {
      throw new ValidationError(
        `${before.code} has been used ${before.usedCount} time${
          before.usedCount === 1 ? '' : 's'
        }, so its terms cannot change. Switch it off and make a new code instead.`,
        changed.map((field) => ({ field, message: 'Locked once the code has been used.' })),
      );
    }
  }

  try {
    const coupon = await prisma.coupon.update({ where: { id: before.id }, data: input });

    await recordAudit({
      actor: actorFrom(actor),
      action: 'coupon.update',
      entityType: 'Coupon',
      entityId: coupon.id,
      summary: `Updated ${coupon.code}`,
      before,
      after: coupon,
      ip: ipHash(req),
      userAgent: req.get('user-agent') ?? null,
    });

    res.json({ coupon });
  } catch (error) {
    rethrowCollision(error);
  }
});

/**
 * Deleting a code, which is only possible while nobody has used it.
 *
 * A used code is switched off instead: the orders that took the discount need
 * the row to still be there to explain their own totals.
 */
adminCouponsRouter.delete('/admin/coupons/:id', async (req, res) => {
  const actor = await requirePermission(req, 'coupon.write');

  const coupon = await prisma.coupon.findUnique({
    where: { id: req.params.id },
    select: { id: true, code: true, usedCount: true, _count: { select: { orders: true } } },
  });
  if (!coupon) throw new NotFoundError('Coupon');

  if (coupon.usedCount > 0 || coupon._count.orders > 0) {
    throw new ValidationError(
      `${coupon.code} has been used, so it cannot be deleted — the orders that took it need it to explain their totals. Switch it off instead.`,
    );
  }

  await prisma.coupon.delete({ where: { id: coupon.id } });

  await recordAudit({
    actor: actorFrom(actor),
    action: 'coupon.delete',
    entityType: 'Coupon',
    entityId: coupon.id,
    summary: `Deleted ${coupon.code}`,
    before: coupon,
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ ok: true });
});

/** Switching a code on or off, the one change that is always safe. */
adminCouponsRouter.patch('/admin/coupons/:id/active', async (req, res) => {
  const actor = await requirePermission(req, 'coupon.write');
  const { isActive } = parseBody(req, z.object({ isActive: z.boolean() }));

  const before = await prisma.coupon.findUnique({
    where: { id: req.params.id },
    select: { id: true, code: true, isActive: true },
  });
  if (!before) throw new NotFoundError('Coupon');

  const coupon = await prisma.coupon.update({
    where: { id: before.id },
    data: { isActive },
    select: { id: true, code: true, isActive: true },
  });

  await recordAudit({
    actor: actorFrom(actor),
    action: 'coupon.update',
    entityType: 'Coupon',
    entityId: coupon.id,
    summary: `${coupon.code} switched ${isActive ? 'on' : 'off'}`,
    before,
    after: coupon,
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ coupon });
});
