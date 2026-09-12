import { Router } from 'express';
import { z } from 'zod';
import { safeText } from '@momishop/shared/validation';
import { BANKED_STATUSES } from '@momishop/shared/order-status';
import { prisma } from '../lib/db';
import { NotFoundError, ValidationError } from '../lib/errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Customers, from the staff side.
 *
 * Two rules shape this file. Staff see people, not credentials: no password
 * hash, no session token, no reset link ever leaves here. And a customer is
 * never deleted from the admin — orders, invoices and tax records point at
 * them; suspending is the strongest thing this screen can do.
 */
export const adminCustomersRouter = Router();

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminCustomersRouter.get('/admin/customers', async (req, res) => {
  await requirePermission(req, 'customer.read');
  const { q, status, cursor, limit } = parseQuery(req, listSchema);

  const where = {
    role: 'CUSTOMER' as const,
    deletedAt: null,
    ...(status ? { status } : { status: { not: 'DELETED' as const } }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        marketingOptIn: true,
        _count: { select: { orders: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const page = rows.slice(0, limit);

  /*
   * Lifetime spend is aggregated in one grouped query rather than per row.
   * Only orders that count as revenue are included — a cancelled order is not
   * money the shop ever had, and showing it would flatter every customer.
   */
  const spend = page.length
    ? await prisma.order.groupBy({
        by: ['userId'],
        where: {
          userId: { in: page.map((customer) => customer.id) },
          status: { in: BANKED_STATUSES },
        },
        _sum: { grandTotal: true },
        _max: { placedAt: true },
      })
    : [];

  const spendByUser = new Map(
    spend.map((row) => [
      row.userId,
      { total: row._sum.grandTotal ?? 0, lastOrderAt: row._max.placedAt },
    ]),
  );

  res.json({
    items: page.map(({ _count, ...customer }) => ({
      ...customer,
      orderCount: _count.orders,
      lifetimeSpend: spendByUser.get(customer.id)?.total ?? 0,
      lastOrderAt: spendByUser.get(customer.id)?.lastOrderAt ?? null,
    })),
    total,
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
});

adminCustomersRouter.get('/admin/customers/:id', async (req, res) => {
  await requirePermission(req, 'customer.read');

  const customer = await prisma.user.findFirst({
    where: { id: req.params.id, role: 'CUSTOMER' },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      phone: true,
      status: true,
      marketingOptIn: true,
      locale: true,
      currency: true,
      createdAt: true,
      lastLoginAt: true,
      deletedAt: true,
      addresses: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      },
      measurementProfiles: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, template: true, unit: true, updatedAt: true },
      },
      loyaltyAccount: { select: { balance: true, lifetimeEarned: true, lifetimeSpent: true } },
      _count: { select: { reviews: true, returnRequests: true } },
    },
  });

  if (!customer) throw new NotFoundError('Customer');

  const [orders, spend] = await Promise.all([
    prisma.order.findMany({
      where: { userId: customer.id },
      orderBy: { placedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
        currency: true,
        placedAt: true,
      },
    }),
    prisma.order.aggregate({
      where: { userId: customer.id, status: { in: BANKED_STATUSES } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
  ]);

  res.json({
    customer: {
      ...customer,
      reviewCount: customer._count.reviews,
      returnCount: customer._count.returnRequests,
      lifetimeSpend: spend._sum.grandTotal ?? 0,
      paidOrderCount: spend._count._all,
    },
    orders,
  });
});

const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  marketingOptIn: z.boolean().optional(),
  reason: safeText(300, 'Reason').optional(),
});

/**
 * Suspend or reinstate an account.
 *
 * Suspension is not a deletion: the person keeps their order history, and
 * sessions stop working because `getCurrentUser` re-reads the live row on
 * every request rather than trusting what the cookie claims.
 */
adminCustomersRouter.patch('/admin/customers/:id', async (req, res) => {
  const actor = await requirePermission(req, 'customer.write');
  const input = parseBody(req, updateSchema);

  if (input.status === undefined && input.marketingOptIn === undefined) {
    throw new ValidationError('Nothing to change.');
  }

  const before = await prisma.user.findFirst({
    where: { id: req.params.id, role: 'CUSTOMER' },
    select: { id: true, email: true, status: true, marketingOptIn: true },
  });
  if (!before) throw new NotFoundError('Customer');

  if (input.status === 'SUSPENDED' && !input.reason) {
    throw new ValidationError('Say why the account is being suspended.', [
      { field: 'reason', message: 'A reason is required.' },
    ]);
  }

  const after = await prisma.user.update({
    where: { id: before.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.marketingOptIn === undefined ? {} : { marketingOptIn: input.marketingOptIn }),
    },
    select: { id: true, status: true, marketingOptIn: true },
  });

  await recordAudit({
    actor: actorFrom(actor),
    action:
      input.status === 'SUSPENDED'
        ? 'customer.suspend'
        : input.status === 'ACTIVE'
          ? 'customer.reinstate'
          : 'customer.update',
    entityType: 'User',
    entityId: before.id,
    summary: input.status
      ? `${before.email} ${input.status === 'SUSPENDED' ? 'suspended' : 'reinstated'}`
      : `${before.email} updated`,
    before: { status: before.status, marketingOptIn: before.marketingOptIn },
    after: { ...after, reason: input.reason },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ customer: after });
});

const loyaltySchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, 'Enter a number of points.'),
  reason: safeText(200, 'Reason').pipe(z.string().min(1, 'Say what the adjustment is for.')),
});

/**
 * A goodwill adjustment to someone's points.
 *
 * The balance is never written directly: it moves with a transaction row, so
 * the ledger always explains the number on the screen.
 */
adminCustomersRouter.post('/admin/customers/:id/loyalty', async (req, res) => {
  const actor = await requirePermission(req, 'customer.write');
  const input = parseBody(req, loyaltySchema);

  const customer = await prisma.user.findFirst({
    where: { id: req.params.id, role: 'CUSTOMER' },
    select: { id: true, email: true, loyaltyAccount: { select: { id: true, balance: true } } },
  });
  if (!customer) throw new NotFoundError('Customer');

  const balance = customer.loyaltyAccount?.balance ?? 0;
  if (balance + input.delta < 0) {
    throw new ValidationError(
      `That would take the balance below zero — there are ${balance} points.`,
      [{ field: 'delta', message: 'More points than the customer has.' }],
    );
  }

  const account = await prisma.$transaction(async (tx) => {
    const loyalty = await tx.loyaltyAccount.upsert({
      where: { userId: customer.id },
      create: {
        userId: customer.id,
        balance: input.delta,
        lifetimeEarned: input.delta > 0 ? input.delta : 0,
        lifetimeSpent: input.delta < 0 ? -input.delta : 0,
      },
      update: {
        balance: { increment: input.delta },
        ...(input.delta > 0
          ? { lifetimeEarned: { increment: input.delta } }
          : { lifetimeSpent: { increment: -input.delta } }),
      },
      select: { id: true, balance: true, lifetimeEarned: true, lifetimeSpent: true },
    });

    await tx.loyaltyTransaction.create({
      data: {
        accountId: loyalty.id,
        delta: input.delta,
        reason: 'ADJUSTMENT',
        reference: input.reason,
      },
    });

    await recordAudit(
      {
        actor: actorFrom(actor),
        action: 'customer.loyalty_adjust',
        entityType: 'User',
        entityId: customer.id,
        summary: `${input.delta > 0 ? '+' : ''}${input.delta} points for ${customer.email}`,
        after: { delta: input.delta, reason: input.reason, balance: loyalty.balance },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );

    return loyalty;
  });

  res.json({ loyalty: account });
});
