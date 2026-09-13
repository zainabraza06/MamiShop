import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { absoluteUrl, addBusinessDays, formatDate } from '@momishop/shared/text';
import { describeMeasurements, type MeasurementTemplateKey } from '@momishop/shared/measurements';
import {
  abandonedCartEmail,
  duplicateRegistrationEmail,
  orderConfirmationEmail,
  orderShippedEmail,
  sendEmail,
  welcomeEmail,
  customRequestCustomerEmail,
  customRequestStaffEmail,
} from './email';
import { sendSms, smsTemplates } from './sms';
import { generateInvoicePdf, invoiceDataFromOrder } from './invoice';

/**
 * Job handlers.
 *
 * Every handler must be idempotent. The queue guarantees at-least-once
 * delivery, and a worker killed mid-job (a serverless timeout, say) has its
 * lock reclaimed and the job retried — so "send the email" has to mean "ensure
 * the email has been sent", not "send another one".
 *
 * Handlers that reference a record which no longer exists return quietly
 * rather than throwing. An order deleted before its confirmation job ran is
 * not a failure worth five retries and a DEAD row.
 */

type Payload = Record<string, unknown>;

function requireString(payload: Payload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Job payload is missing "${key}"`);
  }
  return value;
}

async function handleOrderConfirmation(payload: Payload): Promise<void> {
  const orderId = requireString(payload, 'orderId');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    logger.warn('Order confirmation skipped: order no longer exists', { orderId });
    return;
  }

  const currency = order.currency as Currency;
  const address = order.shippingSnapshot as {
    fullName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode?: string;
  };

  const maxStitching = 12;
  const email = orderConfirmationEmail({
    orderNumber: order.orderNumber,
    customerName: address.fullName,
    email: order.email,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      lineTotal: formatMoney(item.lineTotal, currency),
      measurementSummary:
        item.measurementSnapshot && item.measurementTemplate
          ? describeMeasurements(
              item.measurementTemplate as MeasurementTemplateKey,
              item.measurementSnapshot as Record<string, number>,
              item.measurementUnit === 'CM' ? 'CM' : 'INCH',
            )
          : null,
    })),
    subtotal: formatMoney(order.subtotal, currency),
    shipping: order.shippingTotal === 0 ? 'Free' : formatMoney(order.shippingTotal, currency),
    discount: order.discountTotal > 0 ? formatMoney(order.discountTotal, currency) : null,
    total: formatMoney(order.grandTotal, currency),
    paymentMethod:
      order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod.toLowerCase(),
    estimatedDelivery: `${formatDate(addBusinessDays(order.placedAt, maxStitching))} – ${formatDate(
      addBusinessDays(order.placedAt, maxStitching + 5),
    )}`,
    shippingAddress: [
      address.line1,
      address.line2,
      `${address.city}, ${address.state}`,
      address.postalCode,
    ]
      .filter(Boolean)
      .join(', '),
  });

  await sendEmail({ to: order.email, ...email });
}

async function handleOrderShipped(payload: Payload): Promise<void> {
  const orderId = requireString(payload, 'orderId');

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  const address = order.shippingSnapshot as { fullName: string };

  const email = orderShippedEmail({
    orderNumber: order.orderNumber,
    customerName: address.fullName,
    courier: order.courier ?? 'our courier partner',
    trackingNumber: order.trackingNumber ?? 'will follow shortly',
  });

  await sendEmail({ to: order.email, ...email });
}

async function handleWelcome(payload: Payload): Promise<void> {
  const userId = requireString(payload, 'userId');
  const kind = typeof payload.kind === 'string' ? payload.kind : 'WELCOME';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) return;

  const name = user.name ?? 'there';

  const email =
    kind === 'DUPLICATE_REGISTRATION'
      ? duplicateRegistrationEmail({ customerName: name })
      : welcomeEmail({ customerName: name });

  await sendEmail({ to: user.email, ...email });
}

async function handleAbandonedCart(payload: Payload): Promise<void> {
  const cartId = requireString(payload, 'cartId');

  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: { items: { include: { product: { select: { name: true } } } } },
  });

  // The customer came back and bought, or emptied the basket. Either way there
  // is nothing to recover, and emailing them anyway would be a bad experience.
  if (!cart || !cart.email || cart.convertedOrderId || cart.items.length === 0) return;
  if (cart.recoveryEmailSentAt) return;

  const email = abandonedCartEmail({
    customerName: 'there',
    itemNames: cart.items.map((item) => `${item.quantity} × ${item.product.name}`),
    recoveryUrl: absoluteUrl(`/cart?recover=${cart.token}`),
  });

  await sendEmail({ to: cart.email, ...email });

  await prisma.cart.update({
    where: { id: cart.id },
    data: { recoveryEmailSentAt: new Date() },
  });
}

async function handleSms(payload: Payload, kind: 'confirmed' | 'shipped' | 'delivered') {
  const orderId = requireString(payload, 'orderId');

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order?.phone) return;

  const body =
    kind === 'confirmed'
      ? smsTemplates.orderConfirmed(order.orderNumber)
      : kind === 'shipped'
        ? smsTemplates.orderShipped(
            order.orderNumber,
            order.courier ?? 'courier',
            order.trackingNumber ?? '-',
          )
        : smsTemplates.orderDelivered(order.orderNumber);

  await sendSms(order.phone, body);
}

/**
 * Invoice generation.
 *
 * The PDF is generated and immediately discarded here — the download endpoint
 * regenerates it on demand instead of storing a file. For a store this size
 * that is the right trade: no object storage to secure, expire or back up, and
 * an invoice always reflects the current order record. This job exists to fail
 * loudly at order time if a particular order cannot be rendered at all, rather
 * than surprising the customer when they click Download.
 */
async function handleInvoice(payload: Payload): Promise<void> {
  const orderId = requireString(payload, 'orderId');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;

  const pdf = await generateInvoicePdf(invoiceDataFromOrder(order));

  logger.info('Invoice rendered successfully', {
    orderId,
    orderNumber: order.orderNumber,
    bytes: pdf.byteLength,
  });
}

/** Dispatch table. An unknown type throws, so it lands in DEAD for a human. */

/** Where messages for the shop land. Falls back to the from-address so none is lost. */
function shopInbox(): string {
  return process.env.EMAIL_REPLY_TO ?? process.env.EMAIL_FROM ?? 'hello@momishop.pk';
}

const preview = (body: string | undefined) =>
  body && body.length > 400 ? `${body.slice(0, 400)}…` : (body ?? 'Sent a photo.');

/**
 * Tells the shop a customer wrote. Sent a couple of minutes after the message
 * and at most once per quiet spell (see the enqueue), and skipped entirely
 * when someone has already opened the conversation in the admin.
 */
async function handleCustomRequestToStaff(payload: Payload): Promise<void> {
  const requestId = requireString(payload, 'requestId');

  const request = await prisma.customRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      title: true,
      unreadByStaff: true,
      user: { select: { name: true, email: true } },
      messages: {
        where: { authorRole: 'CUSTOMER' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true },
      },
      _count: { select: { messages: true } },
    },
  });

  if (!request || !request.unreadByStaff) return;

  const email = customRequestStaffEmail({
    number: request.number,
    title: request.title,
    customerName: request.user.name ?? request.user.email,
    preview: preview(request.messages[0]?.body),
    isNew: request._count.messages <= 1,
    adminUrl: absoluteUrl(`/admin/custom-requests/${request.id}`),
  });

  await sendEmail({ to: shopInbox(), ...email, replyTo: request.user.email });
}

/** Tells the customer the shop replied, unless they have already read it. */
async function handleCustomRequestToCustomer(payload: Payload): Promise<void> {
  const requestId = requireString(payload, 'requestId');

  const request = await prisma.customRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      title: true,
      unreadByCustomer: true,
      user: { select: { name: true, email: true } },
      messages: {
        where: { authorRole: { in: ['STAFF', 'SYSTEM'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true },
      },
    },
  });

  if (!request || !request.unreadByCustomer) return;

  const email = customRequestCustomerEmail({
    number: request.number,
    title: request.title,
    customerName: request.user.name ?? 'Hello',
    preview: preview(request.messages[0]?.body),
    url: absoluteUrl(`/account/custom-requests/${request.id}`),
  });

  await sendEmail({ to: request.user.email, ...email });
}

const HANDLERS: Record<string, (payload: Payload) => Promise<void>> = {
  'email.order_confirmation': handleOrderConfirmation,
  'email.order_shipped': handleOrderShipped,
  'email.welcome': handleWelcome,
  'email.custom_request_to_staff': handleCustomRequestToStaff,
  'email.custom_request_to_customer': handleCustomRequestToCustomer,
  'email.abandoned_cart': handleAbandonedCart,
  'invoice.generate': handleInvoice,
  'sms.order_confirmed': (p) => handleSms(p, 'confirmed'),
  'sms.order_shipped': (p) => handleSms(p, 'shipped'),
  'sms.order_delivered': (p) => handleSms(p, 'delivered'),
};

export async function runJob(type: string, payload: unknown): Promise<void> {
  const handler = HANDLERS[type];
  if (!handler) {
    throw new Error(`No handler registered for job type "${type}"`);
  }
  await handler((payload ?? {}) as Payload);
}

export function isKnownJobType(type: string): boolean {
  return type in HANDLERS;
}
