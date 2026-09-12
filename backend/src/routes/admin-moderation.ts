import { Router } from 'express';
import { z } from 'zod';
import { safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError } from '../lib/errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Reviews and return requests — the two queues that need a human's judgement.
 */
export const adminModerationRouter = Router();

// ── Reviews ────────────────────────────────────────────────────────────────

const reviewListSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminModerationRouter.get('/admin/reviews', async (req, res) => {
  await requirePermission(req, 'review.moderate');

  const filter = parseQuery(req, reviewListSchema);

  const [rows, counts] = await Promise.all([
    prisma.review.findMany({
      where: { status: filter.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        photos: true,
        isVerifiedPurchase: true,
        status: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        product: { select: { name: true, slug: true } },
      },
    }),
    prisma.review.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

const moderationSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });

/**
 * Approving or rejecting a review recomputes the product's rating.
 *
 * The average is stored on the product so a listing of 24 items needs 24
 * columns rather than 24 aggregate queries — which means it has to be
 * recalculated here, in the same transaction, or the star rating drifts away
 * from the reviews behind it.
 */
adminModerationRouter.patch('/admin/reviews/:id', async (req, res) => {
  const user = await requirePermission(req, 'review.moderate');
  const { status } = parseBody(req, moderationSchema);

  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, productId: true, rating: true },
  });
  if (!review) throw new NotFoundError('Review');
  if (review.status === status)
    throw new ConflictError(`That review is already ${status.toLowerCase()}.`);

  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id: review.id },
      data: { status, moderatedById: user.id, moderatedAt: new Date() },
    });

    const approved = await tx.review.aggregate({
      where: { productId: review.productId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await tx.product.update({
      where: { id: review.productId },
      data: {
        ratingAverage: approved._avg.rating ?? 0,
        ratingCount: approved._count._all,
      },
    });

    await recordAudit(
      {
        actor: actorFrom(user),
        action: 'review.moderate',
        entityType: 'Review',
        entityId: review.id,
        summary: `Review ${review.status} → ${status}`,
        before: { status: review.status },
        after: { status },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );
  });

  res.json({ ok: true, status });
});

// ── Returns ────────────────────────────────────────────────────────────────

const returnListSchema = z.object({
  status: z
    .enum([
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'IN_TRANSIT',
      'RECEIVED',
      'REFUNDED',
      'EXCHANGED',
      'CLOSED',
    ])
    .optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

adminModerationRouter.get('/admin/returns', async (req, res) => {
  await requirePermission(req, 'return.read');

  const filter = parseQuery(req, returnListSchema);

  const [rows, counts] = await Promise.all([
    prisma.returnRequest.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        requestNumber: true,
        kind: true,
        status: true,
        reason: true,
        detail: true,
        photos: true,
        refundAmount: true,
        staffNote: true,
        createdAt: true,
        order: {
          select: { id: true, orderNumber: true, email: true, currency: true, grandTotal: true },
        },
        items: { select: { id: true, quantity: true, reason: true } },
      },
    }),
    prisma.returnRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

/**
 * Return statuses are a workflow rather than a state machine: a piece can go
 * back for alteration, come back in, and be closed without a refund. Staff
 * judgement decides the path, so any status is reachable — but the change is
 * recorded, with who made it.
 */
const returnUpdateSchema = z.object({
  status: z.enum([
    'REQUESTED',
    'APPROVED',
    'REJECTED',
    'IN_TRANSIT',
    'RECEIVED',
    'REFUNDED',
    'EXCHANGED',
    'CLOSED',
  ]),
  staffNote: safeText(1000, 'Note').optional(),
  refundAmount: z.coerce.number().int().min(0).nullable().optional(),
});

adminModerationRouter.patch('/admin/returns/:id', async (req, res) => {
  const user = await requirePermission(req, 'return.write');
  const input = parseBody(req, returnUpdateSchema);

  const request = await prisma.returnRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, requestNumber: true, status: true, staffNote: true, refundAmount: true },
  });
  if (!request) throw new NotFoundError('Return request');

  const settled = ['REFUNDED', 'EXCHANGED', 'REJECTED', 'CLOSED'].includes(input.status);

  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({
      where: { id: request.id },
      data: {
        status: input.status,
        ...(input.staffNote !== undefined ? { staffNote: input.staffNote } : {}),
        ...(input.refundAmount !== undefined ? { refundAmount: input.refundAmount } : {}),
        ...(settled ? { resolvedById: user.id, resolvedAt: new Date() } : {}),
      },
    });

    await recordAudit(
      {
        actor: actorFrom(user),
        action: 'return.status_change',
        entityType: 'ReturnRequest',
        entityId: request.id,
        summary: `${request.requestNumber}: ${request.status} → ${input.status}`,
        before: { status: request.status, refundAmount: request.refundAmount },
        after: { status: input.status, refundAmount: input.refundAmount },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );
  });

  res.json({ ok: true, status: input.status });
});
