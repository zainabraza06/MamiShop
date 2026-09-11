import { Router } from 'express';
import { z } from 'zod';
import { checkoutSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { flags } from '../lib/env';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import { hashPassword } from '../lib/password';
import { getCurrentUser } from '../auth/current-user';
import { cartOwner, ipHash, rateLimit } from '../http/request';
import { parseBody } from '../http/validate';
import { getCart, validateCartLines } from '../services/cart';
import { placeOrder, quoteOrder } from '../services/checkout';

export const checkoutRouter = Router();

/**
 * Everything the checkout page needs, or the reason it cannot be shown.
 *
 * An empty cart, or one with lines that can no longer be fulfilled, goes back
 * to the cart page, which is built to explain the problem. The status is
 * returned rather than a redirect, because redirects are the storefront's
 * business.
 */
checkoutRouter.get('/checkout/context', async (req, res) => {
  const cart = await getCart(cartOwner(req));

  if (!cart || cart.items.length === 0) {
    res.json({ status: 'EMPTY' });
    return;
  }

  const blocking = validateCartLines(cart).filter((issue) => issue.reason !== 'QUANTITY_REDUCED');
  if (blocking.length > 0) {
    res.json({ status: 'BLOCKED' });
    return;
  }

  const user = await getCurrentUser(req);

  if (!user && !flags.guestCheckout) {
    res.json({ status: 'SIGN_IN_REQUIRED' });
    return;
  }

  const [savedAddresses, loyalty] = await Promise.all([
    user
      ? prisma.address.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        })
      : Promise.resolve([]),
    user
      ? prisma.loyaltyAccount.findUnique({
          where: { userId: user.id },
          select: { balance: true },
        })
      : Promise.resolve(null),
  ]);

  res.json({
    status: 'READY',
    lines: cart.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      productName: item.product.name,
      variantName: item.variant?.name ?? null,
      unitPrice: item.product.basePrice + (item.variant?.priceDelta ?? 0),
      imageUrl: item.product.images[0]?.url ?? null,
      imageAlt: item.product.images[0]?.alt ?? item.product.name,
    })),
    currency: cart.currency,
    savedAddresses,
    loyaltyBalance: loyalty?.balance ?? 0,
    loyaltyEnabled: flags.loyalty,
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    appliedCouponCode: cart.coupon?.code ?? null,
    maxStitchingDays: Math.max(...cart.items.map((i) => i.product.stitchingDays)),
  });
});

const quoteSchema = z.object({
  country: z.string().trim().length(2).default('PK'),
  state: z.string().trim().max(60).default(''),
  city: z.string().trim().max(60).default(''),
  shippingRateId: z.string().max(64).nullish(),
  couponCode: z.string().trim().max(32).nullish(),
  paymentMethod: z.enum(['STRIPE', 'JAZZCASH', 'EASYPAISA', 'COD', 'BANK_TRANSFER']).default('COD'),
  loyaltyPoints: z.coerce.number().int().min(0).default(0),
});

/**
 * Live order quote.
 *
 * Called whenever the address, delivery option, coupon or loyalty redemption
 * changes. It shares `quoteOrder` with order placement, so the total shown is
 * computed by exactly the same code that will charge the customer — there is
 * no second pricing path to drift out of sync.
 */
checkoutRouter.post('/checkout/quote', async (req, res) => {
  const owner = cartOwner(req);
  await rateLimit(req, 'api', owner.userId);

  const input = parseBody(req, quoteSchema);

  const cart = await getCart(owner);
  if (!cart || cart.items.length === 0) throw new NotFoundError('Cart');

  const { pricing, rate, rates, zone, couponError } = await quoteOrder(cart, {
    destination: { country: input.country, state: input.state, city: input.city },
    shippingRateId: input.shippingRateId ?? null,
    couponCode: input.couponCode ?? null,
    isCashOnDelivery: input.paymentMethod === 'COD',
    loyaltyPoints: input.loyaltyPoints,
    userId: owner.userId,
  });

  res.json({
    pricing,
    selectedRateId: rate?.id ?? null,
    zoneName: zone?.name ?? null,
    // Surfaced so the customer can see why a code was not applied, without
    // the quote itself failing.
    couponError,
    rates: rates.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      amount: r.amount,
      freeAbove: r.freeAbove,
      minDays: r.minDays,
      maxDays: r.maxDays,
    })),
  });
});

/**
 * Order placement.
 *
 * Rate limited under the `checkout` policy, which is deliberately tighter than
 * general API traffic: repeated checkout attempts from one source is what card
 * testing looks like.
 *
 * Everything of consequence happens inside `placeOrder`'s transaction. This
 * handler's job is to authenticate the request, confirm the cart is still
 * fulfillable, and translate the result into a response.
 */
checkoutRouter.post('/checkout', async (req, res) => {
  const owner = cartOwner(req);
  const userId = owner.userId;
  await rateLimit(req, 'checkout', userId);

  const input = parseBody(req, checkoutSchema);

  if (!userId && !flags.guestCheckout) {
    throw new ValidationError('Please sign in to complete your order.');
  }

  const cart = await getCart(owner);
  if (!cart || cart.items.length === 0) {
    throw new NotFoundError('Cart');
  }

  /**
   * Re-check availability before going any further.
   *
   * `placeOrder` re-checks again inside its transaction, which is the
   * authoritative check. This earlier pass exists to give a clear, specific
   * error rather than a generic transaction failure.
   */
  const blocking = validateCartLines(cart).filter((issue) => issue.reason !== 'QUANTITY_REDUCED');
  if (blocking.length > 0) {
    throw new ConflictError(blocking[0].message);
  }

  /**
   * Optional account creation at checkout.
   *
   * Done before the order so the order can be attached to the new user. If
   * account creation fails the checkout still proceeds as a guest order —
   * losing a sale because a password was too short would be absurd.
   */
  let effectiveUserId = userId;

  if (!userId && input.createAccount && input.password) {
    try {
      const existing = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      if (existing) {
        // The email is already registered. Continue as a guest rather than
        // revealing that fact or silently attaching the order to an account
        // this visitor has not authenticated against.
        logger.info('Checkout account creation skipped: email already registered');
      } else {
        const created = await prisma.user.create({
          data: {
            email: input.email,
            name: input.shippingAddress.fullName,
            phone: input.phone,
            passwordHash: await hashPassword(input.password),
            marketingOptIn: false,
          },
          select: { id: true },
        });
        effectiveUserId = created.id;
      }
    } catch (error) {
      logger.error('Failed to create account during checkout; continuing as guest', { error });
    }
  }

  // Persist the address for a signed-in customer who asked for it.
  if (effectiveUserId && input.saveAddress) {
    try {
      if (input.shippingAddress.isDefault) {
        await prisma.address.updateMany({
          where: { userId: effectiveUserId, isDefault: true },
          data: { isDefault: false },
        });
      }
      await prisma.address.create({
        data: { ...input.shippingAddress, userId: effectiveUserId },
      });
    } catch (error) {
      // A failed address save must never fail the order.
      logger.warn('Could not save address during checkout', { error });
    }
  }

  const order = await placeOrder({
    cart,
    input,
    userId: effectiveUserId,
    ipHash: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  logger.info('Order placed', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.grandTotal,
    method: order.paymentMethod,
  });

  // Where the customer goes next depends on how they are paying: COD is done,
  // everything else needs a trip to a payment gateway.
  const redirectTo =
    order.paymentMethod === 'COD'
      ? `/order-confirmed/${order.orderNumber}`
      : `/checkout/pay/${order.orderNumber}`;

  res.status(201).json({
    ok: true,
    orderNumber: order.orderNumber,
    grandTotal: order.grandTotal,
    currency: order.currency,
    redirectTo,
  });
});
