import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { chatMessageSchema, customQuoteSchema, safeText } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError } from '../lib/errors';
import { requirePermission } from '../auth/current-user';
import { ipHash, rateLimit } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';
import { enqueue } from '../services/jobs';
import { sendQuote, withdrawQuote } from '../services/custom-quotes';
import {
  assertOwnAttachments,
  forStaff,
  messageSelect,
  notificationKey,
} from '../services/custom-requests';

/**
 * Custom requests, from the shop's side: the inbox, the conversation, and
 * declining or closing a request.
 */
export const adminCustomRequestsRouter = Router();

const STATUSES = ['OPEN', 'QUOTED', 'ACCEPTED', 'ORDERED', 'DECLINED', 'CLOSED'] as const;

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});

adminCustomRequestsRouter.get('/admin/custom-requests', async (req, res) => {
  await requirePermission(req, 'request.read');
  const { status, q } = parseQuery(req, listSchema);

  const where: Prisma.CustomRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [requests, counts] = await Promise.all([
    prisma.customRequest.findMany({
      where,
      // Waiting on the shop first, then most recent.
      orderBy: [{ unreadByStaff: 'desc' }, { lastMessageAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        lastMessageAt: true,
        unreadByStaff: true,
        user: { select: { name: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
    }),
    prisma.customRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  res.json({
    items: requests.map(({ unreadByStaff, user, messages, ...request }) => ({
      ...request,
      unread: unreadByStaff,
      customer: user,
      preview: (messages[0]?.body ?? '').slice(0, 160) || 'Sent a photo.',
    })),
    countsByStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
  });
});

async function markReadByStaff(requestId: string) {
  await prisma.customRequest.updateMany({
    where: { id: requestId, unreadByStaff: true },
    data: { unreadByStaff: false },
  });
}

adminCustomRequestsRouter.get('/admin/custom-requests/:id', async (req, res) => {
  await requirePermission(req, 'request.read');

  const request = await prisma.customRequest.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      template: true,
      measurementUnit: true,
      measurementSnapshot: true,
      budget: true,
      neededBy: true,
      status: true,
      createdAt: true,
      unreadByStaff: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 500, select: messageSelect },
    },
  });
  if (!request) throw new NotFoundError('Request');

  if (request.unreadByStaff) await markReadByStaff(request.id);

  const { unreadByStaff: _unread, user, messages, ...rest } = request;
  res.json({ request: { ...rest, customer: user, messages: messages.map(forStaff) } });
});

const sinceSchema = z.object({ after: z.coerce.date().optional() });

adminCustomRequestsRouter.get('/admin/custom-requests/:id/messages', async (req, res) => {
  await requirePermission(req, 'request.read');
  const { after } = parseQuery(req, sinceSchema);

  const request = await prisma.customRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, unreadByStaff: true },
  });
  if (!request) throw new NotFoundError('Request');

  const messages = await prisma.customRequestMessage.findMany({
    where: { requestId: request.id, ...(after ? { createdAt: { gte: after } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: messageSelect,
  });

  if (request.unreadByStaff) await markReadByStaff(request.id);

  res.json({ messages: messages.map(forStaff), status: request.status });
});

adminCustomRequestsRouter.post('/admin/custom-requests/:id/messages', async (req, res) => {
  const actor = await requirePermission(req, 'request.write');
  await rateLimit(req, 'chatMessage', actor.id);
  const input = parseBody(req, chatMessageSchema);
  assertOwnAttachments(input.attachments);

  const request = await prisma.customRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!request) throw new NotFoundError('Request');
  if (request.status === 'CLOSED' || request.status === 'DECLINED') {
    throw new ConflictError('Reopen the request before replying.');
  }

  const now = new Date();

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.customRequestMessage.create({
      data: {
        requestId: request.id,
        authorId: actor.id,
        authorRole: 'STAFF',
        body: input.body,
        attachments: input.attachments,
      },
      select: messageSelect,
    });

    await tx.customRequest.update({
      where: { id: request.id },
      data: { unreadByCustomer: true, unreadByStaff: false, lastMessageAt: now },
    });

    await enqueue(
      'email.custom_request_to_customer',
      { requestId: request.id },
      {
        priority: 7,
        delaySeconds: 120,
        idempotencyKey: notificationKey('customer', request.id, now),
      },
      tx,
    );

    return created;
  });

  res.status(201).json({ message: forStaff(message) });
});

const statusSchema = z.object({
  status: z.enum(['OPEN', 'DECLINED', 'CLOSED']),
  note: safeText(500, 'Note').optional(),
});

/** What the customer reads in the conversation when the status changes. */
const STATUS_NOTICE: Record<'OPEN' | 'DECLINED' | 'CLOSED', string> = {
  OPEN: 'This request has been reopened.',
  DECLINED: 'Sorry — we are not able to make this piece.',
  CLOSED: 'This request has been closed.',
};

/**
 * Declining, closing or reopening a request.
 *
 * An ordered request has become an order and is handled there, so its status
 * no longer changes here. The change is posted into the conversation, so the
 * customer is never left wondering why they can no longer reply.
 */
adminCustomRequestsRouter.patch('/admin/custom-requests/:id/status', async (req, res) => {
  const actor = await requirePermission(req, 'request.write');
  const input = parseBody(req, statusSchema);

  const before = await prisma.customRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, number: true, status: true },
  });
  if (!before) throw new NotFoundError('Request');

  if (before.status === 'ORDERED') {
    throw new ConflictError('This request has become an order; manage it from the order instead.');
  }
  if (before.status === input.status) {
    throw new ConflictError(`The request is already ${input.status.toLowerCase()}.`);
  }

  const now = new Date();
  const notice = input.note
    ? `${STATUS_NOTICE[input.status]}\n\n${input.note}`
    : STATUS_NOTICE[input.status];

  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({
      where: { id: before.id },
      data: { status: input.status, unreadByCustomer: true, lastMessageAt: now },
    });

    await tx.customRequestMessage.create({
      data: { requestId: before.id, authorId: actor.id, authorRole: 'SYSTEM', body: notice },
    });

    await enqueue(
      'email.custom_request_to_customer',
      { requestId: before.id },
      {
        priority: 7,
        idempotencyKey: `custom-request-status:${before.id}:${input.status}:${now.getTime()}`,
      },
      tx,
    );

    await recordAudit(
      {
        actor: actorFrom(actor),
        action: 'custom_request.update',
        entityType: 'CustomRequest',
        entityId: before.id,
        summary: `${before.number} ${input.status === 'OPEN' ? 'reopened' : input.status.toLowerCase()}`,
        before: { status: before.status },
        after: { status: input.status, note: input.note },
        ip: ipHash(req),
        userAgent: req.get('user-agent') ?? null,
      },
      tx,
    );
  });

  res.json({ ok: true, status: input.status });
});

// ── Quotes ─────────────────────────────────────────────────────────────────

/** Sending a price. Admins only: a quote sets a price, which staff cannot do elsewhere. */
adminCustomRequestsRouter.post('/admin/custom-requests/:id/quotes', async (req, res) => {
  const actor = await requirePermission(req, 'request.quote');
  const input = parseBody(req, customQuoteSchema);

  const quote = await sendQuote(req.params.id, actor, input, {
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.status(201).json({ quoteId: quote.id });
});

adminCustomRequestsRouter.post(
  '/admin/custom-requests/:id/quotes/:quoteId/withdraw',
  async (req, res) => {
    const actor = await requirePermission(req, 'request.quote');

    await withdrawQuote(req.params.id, req.params.quoteId, actor, {
      ip: ipHash(req),
      userAgent: req.get('user-agent') ?? null,
    });

    res.json({ ok: true });
  },
);
