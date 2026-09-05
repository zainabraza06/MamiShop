/**
 * Coupon eligibility.
 *
 * Kept separate from `pricing.ts` because the two answer different questions:
 * this module decides *whether* a code may be used, pricing decides *how much*
 * it is worth. Both are pure — the caller supplies the coupon record, the
 * customer's usage history, and the current time.
 *
 * `now` is always passed in rather than read from the clock, so time-window
 * behaviour is testable without freezing global time.
 */

export type CouponRejectionCode =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'USER_LIMIT_REACHED'
  | 'MIN_SUBTOTAL_NOT_MET'
  | 'FIRST_ORDER_ONLY'
  | 'NO_ELIGIBLE_ITEMS';

export interface CouponRecord {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
  value: number;
  maxDiscount: number | null;
  minOrderSubtotal: number;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
  firstOrderOnly: boolean;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface CouponContext {
  subtotal: number;
  /** Product and category ids present in the basket. */
  productIds: string[];
  categoryIds: string[];
  /** How many times THIS customer has already redeemed this code. */
  userRedemptions: number;
  /** Used by `firstOrderOnly`. Guests are treated as first-time buyers. */
  customerOrderCount: number;
  now: Date;
}

export interface CouponEvaluation {
  valid: boolean;
  code: CouponRejectionCode | null;
  /** Message safe to show the shopper. Never reveals internal limits. */
  message: string | null;
}

const OK: CouponEvaluation = { valid: true, code: null, message: null };

function reject(code: CouponRejectionCode, message: string): CouponEvaluation {
  return { valid: false, code, message };
}

/**
 * Full eligibility check.
 *
 * Rejection messages are intentionally vague about *why* a code is exhausted.
 * Telling an attacker "this code has 3 uses left" turns coupon codes into an
 * enumerable resource.
 */
export function evaluateCoupon(
  coupon: CouponRecord | null,
  ctx: CouponContext,
): CouponEvaluation {
  if (!coupon) {
    return reject('NOT_FOUND', 'That code is not valid.');
  }

  if (!coupon.isActive) {
    return reject('INACTIVE', 'That code is no longer available.');
  }

  if (coupon.startsAt && ctx.now < coupon.startsAt) {
    return reject('NOT_STARTED', 'That code is not active yet.');
  }

  if (coupon.endsAt && ctx.now > coupon.endsAt) {
    return reject('EXPIRED', 'That code has expired.');
  }

  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return reject('USAGE_LIMIT_REACHED', 'That code is no longer available.');
  }

  if (
    coupon.usageLimitPerUser !== null &&
    ctx.userRedemptions >= coupon.usageLimitPerUser
  ) {
    return reject('USER_LIMIT_REACHED', 'You have already used this code.');
  }

  if (coupon.firstOrderOnly && ctx.customerOrderCount > 0) {
    return reject('FIRST_ORDER_ONLY', 'That code is only valid on a first order.');
  }

  if (ctx.subtotal < coupon.minOrderSubtotal) {
    return reject(
      'MIN_SUBTOTAL_NOT_MET',
      'Your basket does not yet meet the minimum for this code.',
    );
  }

  const isScoped =
    coupon.appliesToProductIds.length > 0 || coupon.appliesToCategoryIds.length > 0;

  if (isScoped) {
    const matches =
      coupon.appliesToProductIds.some((id) => ctx.productIds.includes(id)) ||
      coupon.appliesToCategoryIds.some((id) => ctx.categoryIds.includes(id));

    if (!matches) {
      return reject(
        'NO_ELIGIBLE_ITEMS',
        'That code does not apply to anything in your basket.',
      );
    }
  }

  return OK;
}

/** Codes are stored and compared uppercase, so "welcome10" matches "WELCOME10". */
export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Human summary for the admin list and the cart chip, e.g. "20% off, max Rs 2,000".
 * `formatAmount` is injected so this module stays free of currency concerns.
 */
export function describeCoupon(
  coupon: Pick<CouponRecord, 'type' | 'value' | 'maxDiscount' | 'minOrderSubtotal'>,
  formatAmount: (minor: number) => string,
): string {
  const parts: string[] = [];

  switch (coupon.type) {
    case 'PERCENTAGE':
      parts.push(`${coupon.value}% off`);
      if (coupon.maxDiscount) parts.push(`max ${formatAmount(coupon.maxDiscount)}`);
      break;
    case 'FIXED_AMOUNT':
      parts.push(`${formatAmount(coupon.value)} off`);
      break;
    case 'FREE_SHIPPING':
      parts.push('Free shipping');
      break;
  }

  if (coupon.minOrderSubtotal > 0) {
    parts.push(`on orders over ${formatAmount(coupon.minOrderSubtotal)}`);
  }

  return parts.join(', ');
}
