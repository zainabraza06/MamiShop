import { Router } from 'express';
import { z } from 'zod';
import { orderStatusUpdateSchema, refundSchema, safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { NotFoundError } from '../lib/errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom } from '../services/audit';
import { changeOrderStatus, refundOrder, setStaffNote } from '../services/order-management';

/**
 * Order management.
 *
 * Reading needs `order.read`; changing status needs `order.write`; refunds
 * need `order.refund`, which STAFF does not have by default — moving money is
 * the lever most worth restricting in a small business.
 */
export const adminOrdersRouter = Router();

const listSchema = z.object({
  status: z
    .enum([
      'PENDING',
      'CONFIRMED',
      'IN_PRODUCTION',
      'READY_TO_SHIP',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ])
    .optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminOrdersRouter.get('/admin/orders', async (req, res) => {
  await requirePermission(req, 'order.read');

  const filter = parseQuery(req, listSchema);

  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    // One box that searches the two things staff actually have to hand: the
    // number from the customer's email, or the email itself.
    ...(filter.q
      ? {
          OR: [
            { orderNumber: { contains: filter.q, mode: 'insensitive' as const } },
            { email: { contains: filter.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total, counts] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderNumber: true,
        email: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        grandTotal: true,
        refundedTotal: true,
        currency: true,
        placedAt: true,
        isManual: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
    // Drives the filter tabs, so staff can see what is waiting without
    // clicking through every status.
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  res.json({
    items: items.map(({ _count, ...order }) => ({ ...order, itemCount: _count.items })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    total,
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

adminOrdersRouter.get('/admin/orders/:id', async (req, res) => {
  await requirePermission(req, 'order.read');

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      events: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { createdAt: 'desc' } },
      returnRequests: {
        select: { id: true, requestNumber: true, status: true, kind: true, createdAt: true },
      },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!order) throw new NotFoundError('Order');

  res.json({ order });
});

adminOrdersRouter.patch('/admin/orders/:id/status', async (req, res) => {
  const user = await requirePermission(req, 'order.write');
  const input = parseBody(req, orderStatusUpdateSchema);

  // Cancelling is its own permission: it releases stock and ends the sale.
  if (input.status === 'CANCELLED') await requirePermission(req, 'order.cancel');

  const result = await changeOrderStatus(
    { orderId: req.params.id, ...input },
    { actor: actorFrom(user), ip: ipHash(req), userAgent: req.get('user-agent') ?? null },
  );

  res.json(result);
});

adminOrdersRouter.post('/admin/orders/:id/refund', async (req, res) => {
  const user = await requirePermission(req, 'order.refund');
  const input = parseBody(req, refundSchema);

  const result = await refundOrder(
    { orderId: req.params.id, ...input },
    { actor: actorFrom(user), ip: ipHash(req), userAgent: req.get('user-agent') ?? null },
  );

  res.json(result);
});

const noteSchema = z.object({ note: safeText(2000, 'Note') });

adminOrdersRouter.patch('/admin/orders/:id/note', async (req, res) => {
  const user = await requirePermission(req, 'order.write');
  const { note } = parseBody(req, noteSchema);

  await setStaffNote(req.params.id, note, {
    actor: actorFrom(user),
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.json({ ok: true });
});
