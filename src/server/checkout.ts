import 'server-only';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { priceOrder, loyaltyPointsEarned, loyaltyPointsToMinor } from '@/lib/pricing';
import { evaluateCoupon, normalizeCouponCode } from '@/lib/coupons';
import { resolveShippingZone, resolveTaxRules, availableRates } from '@/lib/shipping';
import { CACHE_KEYS, CACHE_TTL, cached } from '@/lib/cache';
import { formatOrderNumber } from '@/lib/utils';
import { describeMeasurements, type MeasurementTemplateKey } from '@/lib/measurements';
import { ConflictError, NotFoundError, OutOfStockError, ValidationError } from '@/lib/errors';
import { enqueue } from '@/server/jobs';
import type { CartWithItems } from '@/server/cart';
import type { Currency } from '@/lib/money';
import type { CheckoutInput } from '@/lib/validation';

/**
 * Order placement.
 *
 * The whole thing happens inside one database transaction. Half a placed order
 * is the worst possible outcome: stock decremented with no order row, or an
 * order the customer paid for whose items were never written. Either requires
 * a human to unpick it.
 *
 * Prices are recomputed here from the database, never taken from the client.
 * The browser sends what it wants to buy; the server decides what it costs.
 */

export interface PlaceOrderContext {
  cart: CartWithItems;
  input: CheckoutInput;
  userId: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  /** Set when an admin is entering a phone or WhatsApp order. */
  staffId?: string | null;
}

export interface PlacedOrder {
  id: string;
  orderNumber: string;
  grandTotal: number;
  currency: string;
  paymentMethod: string;
}

async function getShippingZones() {
  return cached(CACHE_KEYS.shippingRules, CACHE_TTL.shippingRules, async () =>
    prisma.shippingZone.findMany({
      where: { isActive: true },
      include: { rates: { where: { isActive: true } } },
    }),
  );
}

async function getTaxRules() {
  return cached(CACHE_KEYS.taxRules, CACHE_TTL.taxRules, async () =>
    prisma.taxRule.findMany({ where: { isActive: true } }),
  );
}

/**
 * Generates the next human-readable order number.
 *
 * Derived from a count within the transaction rather than a global sequence,
 * so numbering restarts cleanly each year. The unique constraint on
 * `orderNumber` is the real guarantee — under concurrency two transactions can
 * compute the same count, and the loser retries.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);

  const count = await tx.order.count({ where: { placedAt: { gte: startOfYear } } });
  return formatOrderNumber(count + 1, year);
}

/**
 * Computes what the order will cost, without writing anything.
 *
 * Used by the checkout page to show a live summary and by `placeOrder` to
 * produce the figures it stores — one code path, so the total quoted is always
 * the total charged.
 */
export async function quoteOrder(
  cart: CartWithItems,
  options: {
    destination: { country: string; state: string; city: string };
    shippingRateId?: string | null;
    couponCode?: string | null;
    isCashOnDelivery?: boolean;
    loyaltyPoints?: number;
    userId?: string | null;
  },
) {
  if (cart.items.length === 0) throw new ValidationError('Your bag is empty.');

  const currency = (cart.currency ?? 'PKR') as Currency;

  const lines = cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    categoryId: item.product.categoryId,
    unitPrice: item.product.basePrice + (item.variant?.priceDelta ?? 0),
    quantity: item.quantity,
    taxClass: item.product.taxClass,
  }));

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  // Coupon
  let coupon = null;
  let couponError: string | null = null;

  if (options.couponCode) {
    const code = normalizeCouponCode(options.couponCode);
    const record = await prisma.coupon.findUnique({ where: { code } });

    const [userRedemptions, customerOrderCount] = options.userId
      ? await Promise.all([
          record
            ? prisma.order.count({
                where: {
                  userId: options.userId,
                  couponId: record.id,
                  status: { not: 'CANCELLED' },
                },
              })
            : Promise.resolve(0),
          prisma.order.count({
            where: { userId: options.userId, status: { not: 'CANCELLED' } },
          }),
        ])
      : [0, 0];

    const evaluation = evaluateCoupon(record, {
      subtotal,
      productIds: lines.map((l) => l.productId),
      categoryIds: lines.map((l) => l.categoryId),
      userRedemptions,
      customerOrderCount,
      now: new Date(),
    });

    if (evaluation.valid && record) coupon = record;
    else couponError = evaluation.message;
  }

  // Shipping
  const zones = await getShippingZones();
  const zone = resolveShippingZone(zones, options.destination);
  const rates = availableRates(zone);

  const rate = options.shippingRateId
    ? rates.find((r) => r.id === options.shippingRateId)
    : rates[0];

  if (options.shippingRateId && !rate) {
    throw new ValidationError('That delivery option is not available for your address.');
  }

  // Tax
  const taxRules = resolveTaxRules(await getTaxRules(), options.destination);

  // Loyalty
  const loyaltyRedemption = options.loyaltyPoints ? loyaltyPointsToMinor(options.loyaltyPoints) : 0;

  const pricing = priceOrder({
    lines,
    currency,
    coupon: coupon
      ? {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          maxDiscount: coupon.maxDiscount,
          minOrderSubtotal: coupon.minOrderSubtotal,
          appliesToCategoryIds: coupon.appliesToCategoryIds,
          appliesToProductIds: coupon.appliesToProductIds,
        }
      : null,
    shipping: rate
      ? {
          amount: rate.amount,
          freeAbove: rate.freeAbove,
          codSurcharge: rate.codSurcharge,
          // Pakistani GST is quoted inclusive, so shipping is not separately taxed.
          taxable: false,
        }
      : null,
    taxRules: taxRules.map((r) => ({
      rateBps: r.rateBps,
      isInclusive: r.isInclusive,
      taxClass: r.taxClass,
    })),
    isCashOnDelivery: options.isCashOnDelivery ?? false,
    loyaltyRedemption,
  });

  return { pricing, coupon, rate, rates, zone, couponError };
}

/**
 * Places the order.
 *
 * Everything below runs in one transaction: stock reservation, order creation,
 * coupon usage increment, loyalty movement, cart conversion and job enqueue.
 * If any step throws, none of it happened.
 */
export async function placeOrder(ctx: PlaceOrderContext): Promise<PlacedOrder> {
  const { cart, input, userId } = ctx;

  if (cart.items.length === 0) throw new ValidationError('Your bag is empty.');

  const destination = {
    country: input.shippingAddress.country,
    state: input.shippingAddress.state,
    city: input.shippingAddress.city,
  };

  const isCod = input.paymentMethod === 'COD';

  const quote = await quoteOrder(cart, {
    destination,
    shippingRateId: input.shippingRateId,
    couponCode: input.couponCode,
    isCashOnDelivery: isCod,
    loyaltyPoints: input.loyaltyPoints,
    userId,
  });

  if (quote.couponError) throw new ValidationError(quote.couponError);

  const { pricing, coupon, rate } = quote;
  if (!rate) throw new ValidationError('Please choose a delivery option.');

  const discountByLine = new Map(pricing.lines.map((l) => [l.id, l]));

  return prisma.$transaction(
    async (tx) => {
      /**
       * Re-check and reserve stock inside the transaction.
       *
       * The cart page checked availability, but that was a separate request.
       * Between then and now someone else may have bought the last piece, so
       * the authoritative check has to be here, under the same lock as the
       * decrement.
       */
      for (const item of cart.items) {
        if (!item.variantId || !item.variant?.trackInventory) continue;

        const updated = await tx.productVariant.updateMany({
          where: {
            id: item.variantId,
            // The predicate is the lock: the update matches zero rows if
            // someone else reserved the stock first, which we detect below.
            stockOnHand: { gte: item.quantity },
          },
          data: {
            stockOnHand: { decrement: item.quantity },
          },
        });

        if (updated.count === 0) {
          throw new OutOfStockError(item.product.name);
        }

        await tx.inventoryLedger.create({
          data: {
            variantId: item.variantId,
            delta: -item.quantity,
            reason: 'SALE',
            note: `Reserved at checkout for ${input.email}`,
          },
        });
      }

      // Loyalty redemption must be affordable at the moment of purchase.
      if (userId && pricing.loyaltyApplied > 0) {
        const account = await tx.loyaltyAccount.findUnique({ where: { userId } });
        const requiredPoints = input.loyaltyPoints;

        if (!account || account.balance < requiredPoints) {
          throw new ConflictError('You do not have enough loyalty points for that redemption.');
        }

        await tx.loyaltyAccount.update({
          where: { userId },
          data: {
            balance: { decrement: requiredPoints },
            lifetimeSpent: { increment: requiredPoints },
            transactions: {
              create: { delta: -requiredPoints, reason: 'ORDER_REDEEMED' },
            },
          },
        });
      }

      const orderNumber = await nextOrderNumber(tx);
      const pointsEarned = loyaltyPointsEarned(pricing.subtotal - pricing.discountTotal);

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId,
          email: input.email,
          phone: input.phone,
          status: 'PENDING',
          // COD is confirmed immediately; card and wallet orders wait for the
          // gateway to tell us the money actually arrived.
          paymentStatus: 'UNPAID',
          paymentMethod: input.paymentMethod,
          currency: pricing.currency,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          shippingTotal: pricing.shippingTotal,
          taxTotal: pricing.taxTotal,
          grandTotal: pricing.grandTotal,
          loyaltyPointsUsed: input.loyaltyPoints,
          loyaltyPointsEarned: pointsEarned,
          couponId: coupon?.id ?? null,
          couponCode: coupon?.code ?? null,
          // Snapshot, not a reference: the customer may edit or delete the
          // address later, and the invoice must still show where it was sent.
          shippingSnapshot: input.shippingAddress as unknown as Prisma.InputJsonValue,
          billingSnapshot: input.billingSameAsShipping
            ? (input.shippingAddress as unknown as Prisma.InputJsonValue)
            : ((input.billingAddress ?? input.shippingAddress) as unknown as Prisma.InputJsonValue),
          customerNote: input.customerNote ?? null,
          courier: rate.name,
          isManual: Boolean(ctx.staffId),
          createdByStaffId: ctx.staffId ?? null,
          ipHash: ctx.ipHash ?? null,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,

          items: {
            create: cart.items.map((item) => {
              const priced = discountByLine.get(item.id);
              const unitPrice = item.product.basePrice + (item.variant?.priceDelta ?? 0);

              return {
                productId: item.productId,
                variantId: item.variantId,
                // Snapshot every display field: the catalogue can change or be
                // archived, but this invoice must render identically in a year.
                productName: item.product.name,
                variantName: item.variant?.name ?? null,
                sku: item.variant?.sku ?? item.product.slug,
                imageUrl: item.product.images[0]?.url ?? null,
                quantity: item.quantity,
                unitPrice,
                lineTotal: unitPrice * item.quantity,
                taxAmount: priced?.taxAmount ?? 0,
                discountAmount: priced?.discountAmount ?? 0,
                measurementProfileId: item.measurementProfileId,
                measurementUnit: item.measurementUnit,
                // Frozen measurements. Editing the saved profile later must
                // never change a garment already being cut.
                measurementSnapshot: item.measurementValues ?? Prisma.JsonNull,
                // Resolved through the same product -> category -> default
                // chain the product page used to render the form. Storing the
                // product's own (usually null) template would leave the tailor
                // sheet unable to label the numbers it was given.
                measurementTemplate: item.measurementValues
                  ? (item.product.sizingTemplate ??
                    item.product.category.sizingTemplate ??
                    'WOMENS_STITCHED')
                  : null,
                customNote: item.customNote,
              };
            }),
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

      if (coupon) {
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Mark the cart converted rather than deleting it, so abandoned-cart
      // reporting can distinguish "recovered" from "never existed".
      await tx.cart.update({
        where: { id: cart.id },
        data: { convertedOrderId: order.id, recoveredAt: new Date() },
      });

      /**
       * Jobs are enqueued inside the transaction. If anything above fails, the
       * confirmation email is rolled back with the order rather than being
       * sent for an order that does not exist.
       */
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

      return order;
    },
    {
      // Stock contention on a popular piece can make this transaction wait;
      // the default 5s timeout is too tight for a checkout under load.
      timeout: 15_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

/**
 * Human-readable production sheet for the workshop.
 *
 * Built from the ORDER's frozen snapshot, not the live profile — the whole
 * point of snapshotting is that this stays correct.
 */
export function buildTailorSheet(
  items: {
    productName: string;
    variantName: string | null;
    quantity: number;
    measurementUnit: string | null;
    measurementSnapshot: unknown;
    measurementTemplate: string | null;
    customNote: string | null;
  }[],
): string[] {
  return items.map((item) => {
    const parts = [`${item.quantity} x ${item.productName}`];
    if (item.variantName) parts.push(`(${item.variantName})`);

    if (item.measurementSnapshot && item.measurementTemplate) {
      const summary = describeMeasurements(
        item.measurementTemplate as MeasurementTemplateKey,
        item.measurementSnapshot as Record<string, number>,
        item.measurementUnit === 'CM' ? 'CM' : 'INCH',
      );
      if (summary) parts.push(`— ${summary}`);
    }

    if (item.customNote) parts.push(`| Note: ${item.customNote}`);
    return parts.join(' ');
  });
}

/** Loads an order for the customer's own tracking page. */
export async function getOrderForCustomer(orderNumber: string, email: string) {
  const order = await prisma.order.findFirst({
    where: { orderNumber, email: email.toLowerCase() },
    include: {
      items: true,
      events: { where: { isPublic: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  if (!order) throw new NotFoundError('Order');
  return order;
}
