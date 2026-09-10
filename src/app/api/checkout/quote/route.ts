import { z } from 'zod';
import { getCart } from '@/server/cart';
import { quoteOrder } from '@/server/checkout';
import { getSessionUserId } from '@/server/session';
import { jsonOk, parseJsonBody, rateLimit, withErrorHandling } from '@/server/api';
import { NotFoundError } from '@/lib/errors';

/**
 * Live order quote.
 *
 * The checkout page calls this whenever the address, delivery option, coupon
 * or loyalty redemption changes. It shares `quoteOrder` with order placement,
 * so the total shown here is computed by exactly the same code that will
 * charge the customer - there is no second pricing path to drift out of sync.
 */
const quoteSchema = z.object({
  country: z.string().trim().length(2).default('PK'),
  state: z.string().trim().max(60).default(''),
  city: z.string().trim().max(60).default(''),
  shippingRateId: z.string().max(64).nullish(),
  couponCode: z.string().trim().max(32).nullish(),
  paymentMethod: z.enum(['STRIPE', 'JAZZCASH', 'EASYPAISA', 'COD', 'BANK_TRANSFER']).default('COD'),
  loyaltyPoints: z.coerce.number().int().min(0).default(0),
});

export const POST = withErrorHandling(async (request) => {
  const userId = await getSessionUserId();
  await rateLimit(request, 'api', userId);

  const input = await parseJsonBody(request, quoteSchema);

  const cart = await getCart();
  if (!cart || cart.items.length === 0) throw new NotFoundError('Cart');

  const { pricing, rate, rates, zone, couponError } = await quoteOrder(cart, {
    destination: { country: input.country, state: input.state, city: input.city },
    shippingRateId: input.shippingRateId ?? null,
    couponCode: input.couponCode ?? null,
    isCashOnDelivery: input.paymentMethod === 'COD',
    loyaltyPoints: input.loyaltyPoints,
    userId,
  });

  return jsonOk({
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
