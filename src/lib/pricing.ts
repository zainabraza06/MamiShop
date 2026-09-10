import {
  allocate,
  applyBps,
  clampNonNegative,
  percentOf,
  sumMinor,
  type Currency,
} from '@/lib/money';

/**
 * Order pricing.
 *
 * Deliberately pure: no database, no I/O, no dates read from the clock. The
 * caller loads coupons, shipping rates and tax rules and passes them in. That
 * makes every pricing rule exhaustively testable, and means the checkout API
 * and the admin's manual-order screen compute identical totals from identical
 * inputs.
 *
 * Order of operations (this order is a business decision, not an accident):
 *   1. line subtotals
 *   2. product/category-scoped discount, then order-level discount
 *   3. shipping, with free-shipping thresholds applied to the DISCOUNTED
 *      subtotal — otherwise a coupon could unlock free shipping the customer
 *      did not actually qualify for
 *   4. tax on (discounted subtotal + taxable shipping)
 *   5. loyalty points redeemed last, as a payment instrument rather than a
 *      discount, so they never reduce the taxable base
 */

export interface PriceableLine {
  /** Stable identifier used to map results back to the caller's items. */
  id: string;
  productId: string;
  categoryId: string;
  /** Unit price in minor units, variant delta already applied. */
  unitPrice: number;
  quantity: number;
  taxClass: string;
}

export type CouponKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface PriceableCoupon {
  id: string;
  code: string;
  type: CouponKind;
  /** Percent (0-100) for PERCENTAGE; minor units for FIXED_AMOUNT. */
  value: number;
  maxDiscount: number | null;
  minOrderSubtotal: number;
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
}

export interface PriceableShipping {
  amount: number;
  freeAbove: number | null;
  codSurcharge: number;
  /** Whether tax applies to the shipping fee in this jurisdiction. */
  taxable: boolean;
}

export interface PriceableTax {
  /** Basis points: 1700 = 17%. */
  rateBps: number;
  /** True when catalogue prices already include this tax. */
  isInclusive: boolean;
  taxClass: string;
}

export interface PricingInput {
  lines: PriceableLine[];
  currency: Currency;
  coupon?: PriceableCoupon | null;
  shipping?: PriceableShipping | null;
  taxRules?: PriceableTax[];
  isCashOnDelivery?: boolean;
  /** Loyalty points to redeem, already converted to minor units. */
  loyaltyRedemption?: number;
}

export interface PricedLine {
  id: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  discountAmount: number;
  taxAmount: number;
}

export interface PricingResult {
  currency: Currency;
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  loyaltyApplied: number;
  grandTotal: number;
  /** Explains each adjustment for the order summary UI and the invoice. */
  breakdown: { label: string; amount: number; kind: 'charge' | 'credit' }[];
  freeShippingApplied: boolean;
}

/** Whether a coupon is scoped to specific products/categories at all. */
function couponIsScoped(coupon: PriceableCoupon): boolean {
  return coupon.appliesToCategoryIds.length > 0 || coupon.appliesToProductIds.length > 0;
}

function couponCoversLine(coupon: PriceableCoupon, line: PriceableLine): boolean {
  if (!couponIsScoped(coupon)) return true;
  return (
    coupon.appliesToProductIds.includes(line.productId) ||
    coupon.appliesToCategoryIds.includes(line.categoryId)
  );
}

/**
 * Computes the discount a coupon grants, and which lines it applies to.
 * A scoped coupon only ever discounts its eligible lines, so a 20%-off-abayas
 * code cannot quietly discount an unrelated stole in the same basket.
 */
function computeDiscount(
  coupon: PriceableCoupon | null | undefined,
  lines: PriceableLine[],
  lineTotals: number[],
  subtotal: number,
): { amount: number; eligibleWeights: number[] } {
  const zeroWeights = lines.map(() => 0);
  if (!coupon) return { amount: 0, eligibleWeights: zeroWeights };
  if (subtotal < coupon.minOrderSubtotal) return { amount: 0, eligibleWeights: zeroWeights };
  if (coupon.type === 'FREE_SHIPPING') return { amount: 0, eligibleWeights: zeroWeights };

  const eligibleWeights = lines.map((line, i) =>
    couponCoversLine(coupon, line) ? lineTotals[i] : 0,
  );
  const eligibleTotal = sumMinor(eligibleWeights);
  if (eligibleTotal === 0) return { amount: 0, eligibleWeights: zeroWeights };

  let amount = coupon.type === 'PERCENTAGE' ? percentOf(eligibleTotal, coupon.value) : coupon.value;

  if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined) {
    amount = Math.min(amount, coupon.maxDiscount);
  }
  // A discount can never exceed what it is discounting.
  amount = Math.min(amount, eligibleTotal);

  return { amount: clampNonNegative(amount), eligibleWeights };
}

/**
 * Tax for one line.
 *
 * Pakistani retail prices are quoted tax-inclusive, so the default path
 * *extracts* the tax already inside the price rather than adding to it.
 * Exclusive rules (used for some export destinations) add on top.
 */
function taxForAmount(amount: number, rule: PriceableTax | undefined): number {
  if (!rule || rule.rateBps === 0 || amount <= 0) return 0;
  if (rule.isInclusive) {
    // amount includes tax T where T = amount * rate / (1 + rate)
    return Math.round((amount * rule.rateBps) / (10_000 + rule.rateBps));
  }
  return applyBps(amount, rule.rateBps);
}

export function priceOrder(input: PricingInput): PricingResult {
  const {
    lines,
    currency,
    coupon,
    shipping,
    taxRules = [],
    isCashOnDelivery = false,
    loyaltyRedemption = 0,
  } = input;

  const breakdown: PricingResult['breakdown'] = [];

  // 1. Line subtotals
  const lineTotals = lines.map((l) => l.unitPrice * l.quantity);
  const subtotal = sumMinor(lineTotals);
  breakdown.push({ label: 'Subtotal', amount: subtotal, kind: 'charge' });

  // 2. Discount, apportioned back onto the eligible lines
  const { amount: discountTotal, eligibleWeights } = computeDiscount(
    coupon,
    lines,
    lineTotals,
    subtotal,
  );
  const perLineDiscount =
    discountTotal > 0 ? allocate(discountTotal, eligibleWeights) : lines.map(() => 0);

  if (discountTotal > 0 && coupon) {
    breakdown.push({ label: `Discount (${coupon.code})`, amount: discountTotal, kind: 'credit' });
  }

  const discountedSubtotal = clampNonNegative(subtotal - discountTotal);

  // 3. Shipping — threshold tested against the DISCOUNTED subtotal
  let shippingTotal = 0;
  let freeShippingApplied = false;

  if (shipping) {
    const qualifiesByThreshold =
      shipping.freeAbove !== null && discountedSubtotal >= shipping.freeAbove;
    const qualifiesByCoupon =
      coupon?.type === 'FREE_SHIPPING' && subtotal >= coupon.minOrderSubtotal;

    if (qualifiesByThreshold || qualifiesByCoupon) {
      freeShippingApplied = true;
      shippingTotal = 0;
    } else {
      shippingTotal = shipping.amount;
    }

    if (isCashOnDelivery && shipping.codSurcharge > 0) {
      // The COD handling fee is charged even when delivery itself is free:
      // it covers cash collection, not transport.
      shippingTotal += shipping.codSurcharge;
    }

    if (shippingTotal > 0) {
      breakdown.push({ label: 'Shipping', amount: shippingTotal, kind: 'charge' });
    } else if (freeShippingApplied) {
      breakdown.push({ label: 'Shipping (free)', amount: 0, kind: 'charge' });
    }
  }

  // 4. Tax
  const ruleByClass = new Map(taxRules.map((r) => [r.taxClass, r]));
  const defaultRule = ruleByClass.get('STANDARD') ?? taxRules[0];

  const perLineTax = lines.map((line, i) => {
    const taxable = clampNonNegative(lineTotals[i] - perLineDiscount[i]);
    return taxForAmount(taxable, ruleByClass.get(line.taxClass) ?? defaultRule);
  });

  const shippingTax =
    shipping?.taxable && shippingTotal > 0 ? taxForAmount(shippingTotal, defaultRule) : 0;

  const taxTotal = sumMinor(perLineTax) + shippingTax;
  const taxIsInclusive = defaultRule?.isInclusive ?? true;

  if (taxTotal > 0) {
    breakdown.push({
      label: taxIsInclusive ? 'Includes GST' : 'GST',
      amount: taxTotal,
      // Inclusive tax is already inside the subtotal, so surfacing it as a
      // charge would double-count it in the visible arithmetic.
      kind: taxIsInclusive ? 'credit' : 'charge',
    });
  }

  // 5. Total, then loyalty redemption as a payment instrument
  const beforeLoyalty = clampNonNegative(
    discountedSubtotal + shippingTotal + (taxIsInclusive ? 0 : taxTotal),
  );

  const loyaltyApplied = Math.min(clampNonNegative(loyaltyRedemption), beforeLoyalty);
  if (loyaltyApplied > 0) {
    breakdown.push({ label: 'Loyalty points', amount: loyaltyApplied, kind: 'credit' });
  }

  const grandTotal = clampNonNegative(beforeLoyalty - loyaltyApplied);

  const pricedLines: PricedLine[] = lines.map((line, i) => ({
    id: line.id,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    lineTotal: lineTotals[i],
    discountAmount: perLineDiscount[i],
    taxAmount: perLineTax[i],
  }));

  return {
    currency,
    lines: pricedLines,
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal,
    loyaltyApplied,
    grandTotal,
    breakdown,
    freeShippingApplied,
  };
}

/**
 * Points earned on an order. Earned on the discounted merchandise value only —
 * not on shipping or tax, which are pass-through costs.
 */
export function loyaltyPointsEarned(
  discountedSubtotal: number,
  pointsPerCurrencyUnit = 1,
  minorUnitsPerPoint = 10_000,
): number {
  if (discountedSubtotal <= 0) return 0;
  return Math.floor((discountedSubtotal / minorUnitsPerPoint) * pointsPerCurrencyUnit);
}

/** Converts a point balance into a redeemable amount in minor units. */
export function loyaltyPointsToMinor(points: number, minorUnitsPerPoint = 100): number {
  return Math.max(0, Math.floor(points)) * minorUnitsPerPoint;
}
