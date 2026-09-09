import { checkoutSchema } from '@/lib/validation';
import { getCart, validateCartLines } from '@/server/cart';
import { placeOrder } from '@/server/checkout';
import { getSessionUserId } from '@/server/session';
import { jsonOk, parseJsonBody, rateLimit, withErrorHandling } from '@/server/api';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { clientIp } from '@/lib/rate-limit';
import { hashIp } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { flags } from '@/lib/env';

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
export const POST = withErrorHandling(async (request) => {
  const userId = await getSessionUserId();
  await rateLimit(request, 'checkout', userId);

  const input = await parseJsonBody(request, checkoutSchema);

  if (!userId && !flags.guestCheckout) {
    throw new ValidationError('Please sign in to complete your order.');
  }

  const cart = await getCart();
  if (!cart || cart.items.length === 0) {
    throw new NotFoundError('Cart');
  }

  /**
   * Re-check availability before taking payment details any further.
   *
   * `placeOrder` re-checks again inside its transaction, which is the
   * authoritative check. This earlier pass exists to give a clear, specific
   * error rather than a generic transaction failure.
   */
  const issues = validateCartLines(cart);
  const blocking = issues.filter((issue) => issue.reason !== 'QUANTITY_REDUCED');
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

  // Persist the address for a signed-in customer who asked us to.
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
    ipHash: hashIp(clientIp(request.headers)),
    userAgent: request.headers.get('user-agent'),
  });

  logger.info('Order placed', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.grandTotal,
    method: order.paymentMethod,
  });

  /**
   * Where the customer goes next depends on how they are paying.
   * COD is done; everything else needs a trip to a payment gateway.
   */
  const redirectTo =
    order.paymentMethod === 'COD'
      ? `/order-confirmed/${order.orderNumber}`
      : `/checkout/pay/${order.orderNumber}`;

  return jsonOk(
    {
      ok: true,
      orderNumber: order.orderNumber,
      grandTotal: order.grandTotal,
      currency: order.currency,
      redirectTo,
    },
    { status: 201 },
  );
});
