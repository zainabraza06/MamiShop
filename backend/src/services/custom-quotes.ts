import { Prisma } from '@prisma/client';
import type { ChatQuote } from '@momishop/shared/api-types';
import type { Currency } from '@momishop/shared/money';
import { priceOrder } from '@momishop/shared/pricing';
import { availableRates, resolveShippingZone, resolveTaxRules } from '@momishop/shared/shipping';
import type { customQuoteSchema, quoteAcceptSchema } from '@momishop/shared/validation';
import type { z } from 'zod';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { actorFrom, recordAudit } from './audit';
import { getShippingZones, getTaxRules, nextOrderNumber, runOrderTransaction } from './checkout';
import { enqueue } from './jobs';

/**
 * Price quotes for custom requests, and turning an accepted one into an order.
 *
 * An accepted quote becomes an ordinary order — the same numbering, pricing,
 * invoice, confirmation email and tracking as anything bought from the shop —
 * so nothing downstream needs to know it started as a conversation.
 */

/** Matches the published delivery policy: cash on delivery on orders up to Rs 50,000. */
export const COD_LIMIT = 5_000_000;

const DAY_MS = 86_400_000;

export const quoteSelect = {
  id: true,
  amount: true,
  stitchingDays: true,
  note: true,
  status: true,
  expiresAt: true,
  order: { select: { orderNumber: true } },
} satisfies Prisma.CustomQuoteSelect;

type SelectedQuote = Prisma.CustomQuoteGetPayload<{ select: typeof quoteSelect }>;

export function toChatQuote(quote: SelectedQuote): ChatQuote {
  return {
    id: quote.id,
    amount: quote.amount,
    stitchingDays: quote.stitchingDays,
    note: quote.note,
    status: quote.status,
    expiresAt: quote.expiresAt.toISOString(),
    orderNumber: quote.order?.orderNumber ?? null,
  };
}

const CLOSED = ['CLOSED', 'DECLINED', 'ORDERED'];

interface Actor {
  id: string;
  email: string;
  role: string;
}

interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

/** Sends a quote. A new quote replaces any earlier one still on offer. */
export async function sendQuote(
  requestId: string,
  actor: Actor,
  input: z.infer<typeof customQuoteSchema>,
  context: RequestContext,
) {
  const request = await prisma.customRequest.findUnique({
    where: { id: requestId },
    select: { id: true, number: true, status: true },
  });
  if (!request) throw new NotFoundError('Request');
  if (CLOSED.includes(request.status)) {
    throw new ConflictError(
      request.status === 'ORDERED'
        ? 'This request has already become an order.'
        : 'Reopen the request before sending a quote.',
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.validDays * DAY_MS);

  return prisma.$transaction(async (tx) => {
    await tx.customQuote.updateMany({
      where: { requestId: request.id, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });

    const quote = await tx.customQuote.create({
      data: {
        requestId: request.id,
        amount: input.amount,
        stitchingDays: input.stitchingDays,
        note: input.note || null,
        expiresAt,
        createdById: actor.id,
      },
      select: quoteSelect,
    });

    await tx.customRequestMessage.create({
      data: {
        requestId: request.id,
        authorId: actor.id,
        authorRole: 'STAFF',
        body: input.note || 'Here is our quote for your piece.',
        quoteId: quote.id,
      },
    });

    await tx.customRequest.update({
      where: { id: request.id },
      data: { status: 'QUOTED', unreadByCustomer: true, unreadByStaff: false, lastMessageAt: now },
    });

    await enqueue(
      'email.custom_request_to_customer',
      { requestId: request.id },
      { priority: 7, idempotencyKey: `custom-quote:${quote.id}` },
      tx,
    );

    await recordAudit(
      {
        actor: actorFrom(actor),
        action: 'custom_request.update',
        entityType: 'CustomRequest',
        entityId: request.id,
        summary: `Quoted Rs ${(input.amount / 100).toLocaleString('en-PK')} for ${request.number}`,
        after: { amount: input.amount, stitchingDays: input.stitchingDays, expiresAt },
        ...context,
      },
      tx,
    );

    return quote;
  });
}

/** Takes a quote off the table before the customer has answered it. */
export async function withdrawQuote(
  requestId: string,
  quoteId: string,
  actor: Actor,
  context: RequestContext,
) {
  const quote = await prisma.customQuote.findFirst({
    where: { id: quoteId, requestId },
    select: { id: true, status: true, request: { select: { number: true, status: true } } },
  });
  if (!quote) throw new NotFoundError('Quote');
  if (quote.status !== 'PENDING')
    throw new ConflictError('Only a quote still on offer can be withdrawn.');

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.customQuote.update({ where: { id: quote.id }, data: { status: 'WITHDRAWN' } });
    await tx.customRequestMessage.create({
      data: {
        requestId,
        authorId: actor.id,
        authorRole: 'SYSTEM',
        body: 'This quote has been withdrawn.',
      },
    });
    await tx.customRequest.update({
      where: { id: requestId },
      data: {
        ...(quote.request.status === 'QUOTED' ? { status: 'OPEN' as const } : {}),
        unreadByCustomer: true,
        lastMessageAt: now,
      },
    });
    await recordAudit(
      {
        actor: actorFrom(actor),
        action: 'custom_request.update',
        entityType: 'CustomRequest',
        entityId: requestId,
        summary: `Withdrew the quote for ${quote.request.number}`,
        ...context,
      },
      tx,
    );
  });
}

/**
 * A quote the signed-in customer may still accept.
 *
 * Someone else's quote reads as not found. One already answered, withdrawn or
 * past its date is refused with the reason, so the customer knows to ask for
 * a fresh one rather than retrying.
 */
export async function loadAcceptableQuote(requestId: string, quoteId: string, userId: string) {
  const quote = await prisma.customQuote.findFirst({
    where: { id: quoteId, requestId, request: { userId } },
    select: {
      ...quoteSelect,
      request: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          template: true,
          measurementProfileId: true,
          measurementUnit: true,
          measurementSnapshot: true,
          user: { select: { email: true, phone: true } },
        },
      },
    },
  });

  if (!quote) throw new NotFoundError('Quote');
  if (quote.status === 'ACCEPTED') throw new ConflictError('This quote has already been accepted.');
  if (quote.status !== 'PENDING') throw new ConflictError('This quote is no longer on offer.');
  if (quote.expiresAt <= new Date()) {
    throw new ConflictError(
      'This quote has expired. Ask us in the conversation for an updated one.',
    );
  }
  if (CLOSED.includes(quote.request.status)) {
    throw new ConflictError('This request is no longer open.');
  }

  return quote;
}

interface Destination {
  country: string;
  state: string;
  city: string;
}

/**
 * Prices a quote as checkout would price a bag holding only this piece: the
 * same delivery zone, rates, tax rules and cash on delivery surcharge.
 */
export async function priceQuote(
  amount: number,
  destination: Destination,
  options: { shippingRateId?: string | null; paymentMethod?: 'COD' | 'BANK_TRANSFER' },
) {
  const [zones, taxRules] = await Promise.all([getShippingZones(), getTaxRules()]);
  const zone = resolveShippingZone(zones, destination);
  const rates = availableRates(zone);
  const rate = options.shippingRateId
    ? rates.find((candidate) => candidate.id === options.shippingRateId)
    : rates[0];

  if (options.shippingRateId && !rate) {
    throw new ValidationError('That delivery option is not available for your address.');
  }

  const applicableTax = resolveTaxRules(taxRules, destination).map((rule) => ({
    rateBps: rule.rateBps,
    isInclusive: rule.isInclusive,
    taxClass: rule.taxClass,
  }));

  const price = (isCashOnDelivery: boolean) =>
    priceOrder({
      lines: [
        {
          id: 'quote',
          productId: 'custom',
          categoryId: 'custom',
          unitPrice: amount,
          quantity: 1,
          taxClass: 'STANDARD',
        },
      ],
      currency: 'PKR' as Currency,
      shipping: rate
        ? {
            amount: rate.amount,
            freeAbove: rate.freeAbove,
            codSurcharge: rate.codSurcharge,
            taxable: false,
          }
        : null,
      taxRules: applicableTax,
      isCashOnDelivery,
    });

  // Judged on the total before the cash surcharge, so choosing cash on
  // delivery can never tip an order over the limit after it was offered.
  const codAllowed =
    destination.country.toUpperCase() === 'PK' && price(false).grandTotal <= COD_LIMIT;
  const pricing = price(options.paymentMethod === 'COD' && codAllowed);

  return { pricing, rate: rate ?? null, rates, codAllowed };
}

/** Accepts a quote and places the order it describes. */
export async function placeQuoteOrder(ctx: {
  requestId: string;
  quoteId: string;
  userId: string;
  input: z.infer<typeof quoteAcceptSchema>;
  ipHash: string | null;
  userAgent: string | null;
}) {
  const { input } = ctx;
  const quote = await loadAcceptableQuote(ctx.requestId, ctx.quoteId, ctx.userId);
  const request = quote.request;

  const destination = {
    country: input.shippingAddress.country,
    state: input.shippingAddress.state,
    city: input.shippingAddress.city,
  };

  const { pricing, rate, codAllowed } = await priceQuote(quote.amount, destination, {
    shippingRateId: input.shippingRateId,
    paymentMethod: input.paymentMethod,
  });

  if (!rate) throw new ValidationError('Please choose a delivery option.');
  if (input.paymentMethod === 'COD' && !codAllowed) {
    throw new ValidationError(
      'Cash on delivery is available on orders up to Rs 50,000. Choose bank transfer instead.',
      [{ field: 'paymentMethod', message: 'Choose bank transfer for this order.' }],
    );
  }

  const isCod = input.paymentMethod === 'COD';

  return runOrderTransaction(async (tx) => {
    // Claimed before anything else is written. A double click, or the quote
    // open in two tabs, finds it no longer pending and stops here — so one
    // quote can never become two orders.
    const claimed = await tx.customQuote.updateMany({
      where: { id: quote.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictError('This quote has already been accepted.');

    const orderNumber = await nextOrderNumber(tx);
    const now = new Date();

    const order = await tx.order.create({
      data: {
        orderNumber,
        userId: ctx.userId,
        email: request.user.email,
        phone: input.phone,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        paymentMethod: input.paymentMethod,
        currency: pricing.currency,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        shippingTotal: pricing.shippingTotal,
        taxTotal: pricing.taxTotal,
        grandTotal: pricing.grandTotal,
        shippingSnapshot: input.shippingAddress as unknown as Prisma.InputJsonValue,
        billingSnapshot: input.shippingAddress as unknown as Prisma.InputJsonValue,
        customerNote: input.customerNote ?? null,
        courier: rate.name,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        items: {
          create: [
            {
              // Not a catalogue product: the line carries its own name and
              // reference, and the measurements agreed in the conversation.
              productId: null,
              variantId: null,
              productName: request.title,
              variantName: `Custom request ${request.number}`,
              sku: request.number,
              quantity: 1,
              unitPrice: quote.amount,
              lineTotal: quote.amount,
              taxAmount: pricing.lines[0]?.taxAmount ?? 0,
              discountAmount: 0,
              measurementProfileId: request.measurementProfileId,
              measurementUnit: request.measurementUnit,
              measurementSnapshot:
                (request.measurementSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
              measurementTemplate: request.measurementSnapshot ? request.template : null,
              customNote: `Made to order from ${request.number}. Stitching about ${quote.stitchingDays} days.`,
            },
          ],
        },
        events: {
          create: {
            status: 'PENDING',
            title: 'Order placed',
            description: 'We have received your order.',
            isPublic: true,
          },
        },
      },
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        currency: true,
        paymentMethod: true,
      },
    });

    await tx.customQuote.update({ where: { id: quote.id }, data: { orderId: order.id } });

    await tx.customRequest.update({
      where: { id: request.id },
      data: { status: 'ORDERED', unreadByStaff: true, lastMessageAt: now },
    });

    await tx.customRequestMessage.create({
      data: {
        requestId: request.id,
        authorId: ctx.userId,
        authorRole: 'SYSTEM',
        body: `Quote accepted. Order ${order.orderNumber} has been placed.`,
      },
    });

    await enqueue(
      'email.order_confirmation',
      { orderId: order.id },
      { priority: 10, idempotencyKey: `order-confirmation:${order.id}` },
      tx,
    );
    await enqueue(
      'invoice.generate',
      { orderId: order.id },
      { priority: 5, idempotencyKey: `invoice:${order.id}` },
      tx,
    );
    if (isCod) {
      await enqueue(
        'sms.order_confirmed',
        { orderId: order.id },
        { priority: 8, idempotencyKey: `sms-confirmed:${order.id}` },
        tx,
      );
    }
    await enqueue(
      'email.custom_request_to_staff',
      { requestId: request.id },
      { priority: 6, idempotencyKey: `custom-request-ordered:${request.id}` },
      tx,
    );

    return order;
  });
}

/** The customer turns a quote down; the conversation stays open for another. */
export async function declineQuote(
  requestId: string,
  quoteId: string,
  userId: string,
  reason?: string,
) {
  const quote = await prisma.customQuote.findFirst({
    where: { id: quoteId, requestId, request: { userId } },
    select: { id: true, status: true },
  });
  if (!quote) throw new NotFoundError('Quote');
  if (quote.status !== 'PENDING') throw new ConflictError('This quote is no longer on offer.');

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.customQuote.update({
      where: { id: quote.id },
      data: { status: 'DECLINED', respondedAt: now },
    });
    await tx.customRequest.update({
      where: { id: requestId },
      data: { status: 'OPEN', unreadByStaff: true, lastMessageAt: now },
    });
    await tx.customRequestMessage.create({
      data: {
        requestId,
        authorId: userId,
        authorRole: 'SYSTEM',
        body: reason ? `Quote declined: ${reason}` : 'Quote declined.',
      },
    });
    await enqueue(
      'email.custom_request_to_staff',
      { requestId },
      { priority: 6, delaySeconds: 60, idempotencyKey: `custom-quote-declined:${quote.id}` },
      tx,
    );
  });
}
