import { Router } from 'express';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  chatMessageSchema,
  customRequestSchema,
  quoteAcceptSchema,
  quoteDeclineSchema,
} from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { requireUser } from '../auth/current-user';
import { ipHash, rateLimit } from '../http/request';
import { parseBody, parseQuery } from '../http/validate';
import { enqueue } from '../services/jobs';
import {
  declineQuote,
  loadAcceptableQuote,
  placeQuoteOrder,
  priceQuote,
  toChatQuote,
} from '../services/custom-quotes';
import {
  assertOwnAttachments,
  forCustomer,
  messageSelect,
  notificationKey,
  uploadsConfigured,
  withRequestNumber,
} from '../services/custom-requests';

/**
 * A customer's requests for pieces the shop does not list, and the
 * conversation about each one.
 *
 * Every lookup is scoped to the signed-in customer. Someone else's request
 * answers "not found" rather than "forbidden", so request ids cannot be probed
 * to learn which exist.
 */
export const customRequestsRouter = Router();

const CLOSED_STATUSES = ['CLOSED', 'DECLINED'] as const;

async function ownRequest(id: string, userId: string) {
  const request = await prisma.customRequest.findFirst({
    where: { id, userId },
    select: { id: true, status: true, unreadByCustomer: true },
  });
  if (!request) throw new NotFoundError('Request');
  return request;
}

/** Opening the conversation counts as reading it. Only writes when something changes. */
async function markRead(requestId: string) {
  await prisma.customRequest.updateMany({
    where: { id: requestId, unreadByCustomer: true },
    data: { unreadByCustomer: false },
  });
}

customRequestsRouter.get('/custom-requests', async (req, res) => {
  const user = await requireUser(req);

  const requests = await prisma.customRequest.findMany({
    where: { userId: user.id },
    orderBy: { lastMessageAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      lastMessageAt: true,
      unreadByCustomer: true,
    },
  });

  res.json({
    items: requests.map(({ unreadByCustomer, ...request }) => ({
      ...request,
      unread: unreadByCustomer,
    })),
  });
});

/** What the request form needs: the customer's saved measurements, and whether photos work. */
customRequestsRouter.get('/custom-requests/options', async (req, res) => {
  const user = await requireUser(req);

  const profiles = await prisma.measurementProfile.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, label: true, template: true, unit: true },
  });

  res.json({ profiles, uploadsEnabled: uploadsConfigured() });
});

customRequestsRouter.post('/custom-requests', async (req, res) => {
  const user = await requireUser(req);
  // Each request emails the owner, so it shares the contact form's budget.
  await rateLimit(req, 'contact', user.id);
  const input = parseBody(req, customRequestSchema);
  assertOwnAttachments(input.attachments);

  const profile = input.measurementProfileId
    ? await prisma.measurementProfile.findFirst({
        where: { id: input.measurementProfileId, userId: user.id, deletedAt: null },
        select: { id: true, template: true, unit: true, values: true },
      })
    : null;

  if (input.measurementProfileId && !profile) {
    throw new ValidationError('That measurement profile is not one of yours.', [
      { field: 'measurementProfileId', message: 'Choose one of your saved profiles.' },
    ]);
  }

  const now = new Date();

  const request = await withRequestNumber((number) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.customRequest.create({
        data: {
          number,
          userId: user.id,
          title: input.title,
          description: input.description,
          template: input.template ?? profile?.template ?? null,
          measurementProfileId: profile?.id ?? null,
          measurementUnit: profile?.unit ?? null,
          measurementSnapshot: profile
            ? (profile.values as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          budget: input.budget ?? null,
          neededBy: input.neededBy ?? null,
          unreadByStaff: true,
          lastMessageAt: now,
          // The description opens the conversation, with any photos, so the
          // thread reads from the beginning on both sides.
          messages: {
            create: {
              authorId: user.id,
              authorRole: 'CUSTOMER',
              body: input.description,
              attachments: input.attachments,
            },
          },
        },
        select: { id: true, number: true },
      });

      await enqueue(
        'email.custom_request_to_staff',
        { requestId: created.id },
        { priority: 6, idempotencyKey: `custom-request-new:${created.id}` },
        tx,
      );

      return created;
    }),
  );

  res.status(201).json({ request });
});

customRequestsRouter.get('/custom-requests/:id', async (req, res) => {
  const user = await requireUser(req);

  const request = await prisma.customRequest.findFirst({
    where: { id: req.params.id, userId: user.id },
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
      unreadByCustomer: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 500, select: messageSelect },
    },
  });
  if (!request) throw new NotFoundError('Request');

  if (request.unreadByCustomer) await markRead(request.id);

  const { unreadByCustomer: _unread, messages, ...rest } = request;
  res.json({ request: { ...rest, messages: messages.map(forCustomer) } });
});

const sinceSchema = z.object({ after: z.coerce.date().optional() });

/**
 * New messages since the last one the page has, for the chat's polling.
 *
 * `gte` rather than `gt`: two messages can share a millisecond, and the page
 * drops any it already holds by id, so a repeat costs nothing and a miss
 * would cost a message.
 */
customRequestsRouter.get('/custom-requests/:id/messages', async (req, res) => {
  const user = await requireUser(req);
  const { after } = parseQuery(req, sinceSchema);
  const request = await ownRequest(req.params.id, user.id);

  const messages = await prisma.customRequestMessage.findMany({
    where: { requestId: request.id, ...(after ? { createdAt: { gte: after } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: messageSelect,
  });

  if (request.unreadByCustomer) await markRead(request.id);

  res.json({ messages: messages.map(forCustomer), status: request.status });
});

async function assertCanWrite(req: Request, requestId: string, userId: string) {
  const request = await ownRequest(requestId, userId);
  if ((CLOSED_STATUSES as readonly string[]).includes(request.status)) {
    throw new ConflictError(
      'This request is closed. Start a new one if you would like something else made.',
    );
  }
  return request;
}

customRequestsRouter.post('/custom-requests/:id/messages', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'chatMessage', user.id);
  const input = parseBody(req, chatMessageSchema);
  assertOwnAttachments(input.attachments);
  const request = await assertCanWrite(req, req.params.id, user.id);

  const now = new Date();

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.customRequestMessage.create({
      data: {
        requestId: request.id,
        authorId: user.id,
        authorRole: 'CUSTOMER',
        body: input.body,
        attachments: input.attachments,
      },
      select: messageSelect,
    });

    await tx.customRequest.update({
      where: { id: request.id },
      data: { unreadByStaff: true, unreadByCustomer: false, lastMessageAt: now },
    });

    await enqueue(
      'email.custom_request_to_staff',
      { requestId: request.id },
      { priority: 6, delaySeconds: 120, idempotencyKey: notificationKey('staff', request.id, now) },
      tx,
    );

    return created;
  });

  res.status(201).json({ message: forCustomer(message) });
});

// ── Quotes ─────────────────────────────────────────────────────────────────

/** Everything the page for accepting a quote needs before the customer types anything. */
customRequestsRouter.get('/custom-requests/:id/quotes/:quoteId/checkout', async (req, res) => {
  const user = await requireUser(req);
  const quote = await loadAcceptableQuote(req.params.id, req.params.quoteId, user.id);

  const address = await prisma.address.findFirst({
    where: { userId: user.id, deletedAt: null, type: 'SHIPPING' },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    select: {
      fullName: true,
      phone: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });

  const { request, ...rest } = quote;
  res.json({
    request: { id: request.id, number: request.number, title: request.title },
    quote: toChatQuote(rest),
    email: request.user.email,
    phone: request.user.phone,
    defaultAddress: address,
  });
});

const previewSchema = z.object({
  country: z.string().trim().length(2).default('PK'),
  state: z.string().trim().min(1).max(60),
  city: z.string().trim().min(1).max(60),
  shippingRateId: z.string().max(64).nullish(),
  paymentMethod: z.enum(['COD', 'BANK_TRANSFER']).optional(),
});

/** The live summary beside the form: delivery options and the total to pay. */
customRequestsRouter.post('/custom-requests/:id/quotes/:quoteId/preview', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'api', user.id);
  const input = parseBody(req, previewSchema);
  const quote = await loadAcceptableQuote(req.params.id, req.params.quoteId, user.id);

  const { pricing, rate, rates, codAllowed } = await priceQuote(
    quote.amount,
    { country: input.country, state: input.state, city: input.city },
    { shippingRateId: input.shippingRateId ?? null, paymentMethod: input.paymentMethod },
  );

  res.json({
    subtotal: pricing.subtotal,
    shippingTotal: pricing.shippingTotal,
    taxTotal: pricing.taxTotal,
    grandTotal: pricing.grandTotal,
    breakdown: pricing.breakdown,
    rates: rates.map((option) => ({
      id: option.id,
      name: option.name,
      description: option.description,
      amount: option.amount,
      freeAbove: option.freeAbove,
      minDays: option.minDays,
      maxDays: option.maxDays,
    })),
    selectedRateId: rate?.id ?? null,
    codAllowed,
  });
});

customRequestsRouter.post('/custom-requests/:id/quotes/:quoteId/accept', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'checkout', user.id);
  const input = parseBody(req, quoteAcceptSchema);

  const order = await placeQuoteOrder({
    requestId: req.params.id,
    quoteId: req.params.quoteId,
    userId: user.id,
    input,
    ipHash: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.status(201).json({ orderNumber: order.orderNumber });
});

customRequestsRouter.post('/custom-requests/:id/quotes/:quoteId/decline', async (req, res) => {
  const user = await requireUser(req);
  const { reason } = parseBody(req, quoteDeclineSchema);

  await declineQuote(req.params.id, req.params.quoteId, user.id, reason);
  res.json({ ok: true });
});
