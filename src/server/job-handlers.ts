import 'server-only';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { formatMoney, type Currency } from '@/lib/money';
import { absoluteUrl, addBusinessDays, formatDate } from '@/lib/utils';
import { describeMeasurements, type MeasurementTemplateKey } from '@/lib/measurements';
import {
  abandonedCartEmail,
  duplicateRegistrationEmail,
  orderConfirmationEmail,
  orderShippedEmail,
  sendEmail,
  welcomeEmail,
} from '@/server/email';
import { sendSms, smsTemplates } from '@/server/sms';
import { generateInvoicePdf } from '@/server/invoice';

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

  // shippingSnapshot is Prisma.JsonValue, which includes arrays and scalars,
  // so it needs the two-step cast through unknown.
  const address = order.shippingSnapshot as unknown as InvoiceAddress;

  const pdf = await generateInvoicePdf({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    currency: order.currency,
    customerName: address.fullName,
    customerEmail: order.email,
    customerPhone: order.phone,
    shippingAddress: address,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      measurementUnit: item.measurementUnit,
      measurementSnapshot: item.measurementSnapshot,
      measurementTemplate: item.measurementTemplate,
    })),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    couponCode: order.couponCode,
    storeName: 'MomiShop',
    storeEmail: 'hello@momishop.pk',
    storePhone: '+92 300 1234567',
  });

  logger.info('Invoice rendered successfully', {
    orderId,
    orderNumber: order.orderNumber,
    bytes: pdf.byteLength,
  });
}

interface InvoiceAddress {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  country: string;
}

/** Dispatch table. An unknown type throws, so it lands in DEAD for a human. */
const HANDLERS: Record<string, (payload: Payload) => Promise<void>> = {
  'email.order_confirmation': handleOrderConfirmation,
  'email.order_shipped': handleOrderShipped,
  'email.welcome': handleWelcome,
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
