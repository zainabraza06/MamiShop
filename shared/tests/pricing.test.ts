import { describe, expect, it } from 'vitest';
import {
  loyaltyPointsEarned,
  loyaltyPointsToMinor,
  priceOrder,
  type PriceableCoupon,
  type PriceableLine,
  type PricingInput,
} from '../src/pricing';

/** Rs 5,000 abaya and Rs 2,000 stole, both taxed at the standard class. */
function lines(): PriceableLine[] {
  return [
    {
      id: 'l1',
      productId: 'p-abaya',
      categoryId: 'c-abaya',
      unitPrice: 500_000,
      quantity: 1,
      taxClass: 'STANDARD',
    },
    {
      id: 'l2',
      productId: 'p-stole',
      categoryId: 'c-stole',
      unitPrice: 200_000,
      quantity: 1,
      taxClass: 'STANDARD',
    },
  ];
}

function base(overrides: Partial<PricingInput> = {}): PricingInput {
  return { lines: lines(), currency: 'PKR', ...overrides };
}

const percentCoupon = (over: Partial<PriceableCoupon> = {}): PriceableCoupon => ({
  id: 'cp1',
  code: 'WELCOME10',
  type: 'PERCENTAGE',
  value: 10,
  maxDiscount: null,
  minOrderSubtotal: 0,
  appliesToCategoryIds: [],
  appliesToProductIds: [],
  ...over,
});

describe('subtotal', () => {
  it('sums line totals including quantity', () => {
    const result = priceOrder(base());
    expect(result.subtotal).toBe(700_000);
    expect(result.grandTotal).toBe(700_000);
  });

  it('multiplies by quantity', () => {
    const result = priceOrder(base({ lines: [{ ...lines()[0], quantity: 3 }] }));
    expect(result.subtotal).toBe(1_500_000);
  });

  it('handles an empty basket', () => {
    const result = priceOrder(base({ lines: [] }));
    expect(result.subtotal).toBe(0);
    expect(result.grandTotal).toBe(0);
  });
});

describe('discounts', () => {
  it('applies a percentage coupon to the whole basket', () => {
    const result = priceOrder(base({ coupon: percentCoupon() }));
    expect(result.discountTotal).toBe(70_000);
    expect(result.grandTotal).toBe(630_000);
  });

  it('caps a percentage coupon at maxDiscount', () => {
    const result = priceOrder(base({ coupon: percentCoupon({ value: 50, maxDiscount: 100_000 }) }));
    expect(result.discountTotal).toBe(100_000);
  });

  it('ignores a coupon below its minimum subtotal', () => {
    const result = priceOrder(base({ coupon: percentCoupon({ minOrderSubtotal: 1_000_000 }) }));
    expect(result.discountTotal).toBe(0);
  });

  it('only discounts lines a scoped coupon covers', () => {
    const result = priceOrder(
      base({ coupon: percentCoupon({ value: 20, appliesToCategoryIds: ['c-abaya'] }) }),
    );
    // 20% of the Rs 5,000 abaya only — the stole is untouched.
    expect(result.discountTotal).toBe(100_000);
    expect(result.lines.find((l) => l.id === 'l1')?.discountAmount).toBe(100_000);
    expect(result.lines.find((l) => l.id === 'l2')?.discountAmount).toBe(0);
  });

  it('grants nothing when a scoped coupon matches no line', () => {
    const result = priceOrder(
      base({ coupon: percentCoupon({ appliesToCategoryIds: ['c-nothing'] }) }),
    );
    expect(result.discountTotal).toBe(0);
  });

  it('never discounts more than the eligible total', () => {
    const result = priceOrder(
      base({ coupon: percentCoupon({ type: 'FIXED_AMOUNT', value: 99_999_999 }) }),
    );
    expect(result.discountTotal).toBe(700_000);
    expect(result.grandTotal).toBe(0);
  });

  it('apportions the discount across lines without losing a paisa', () => {
    const result = priceOrder(base({ coupon: percentCoupon({ value: 33 }) }));
    const apportioned = result.lines.reduce((sum, l) => sum + l.discountAmount, 0);
    expect(apportioned).toBe(result.discountTotal);
  });
});

describe('shipping', () => {
  const shipping = {
    amount: 30_000,
    freeAbove: null as number | null,
    codSurcharge: 15_000,
    taxable: false,
  };

  it('adds a flat rate', () => {
    const result = priceOrder(base({ shipping }));
    expect(result.shippingTotal).toBe(30_000);
    expect(result.grandTotal).toBe(730_000);
  });

  it('waives shipping above the threshold', () => {
    const result = priceOrder(base({ shipping: { ...shipping, freeAbove: 500_000 } }));
    expect(result.shippingTotal).toBe(0);
    expect(result.freeShippingApplied).toBe(true);
  });

  it('tests the free-shipping threshold against the DISCOUNTED subtotal', () => {
    // Rs 7,000 basket, 10% off = Rs 6,300, threshold Rs 6,500 -> still charged.
    const result = priceOrder(
      base({ shipping: { ...shipping, freeAbove: 650_000 }, coupon: percentCoupon() }),
    );
    expect(result.freeShippingApplied).toBe(false);
    expect(result.shippingTotal).toBe(30_000);
  });

  it('honours a free-shipping coupon', () => {
    const result = priceOrder(
      base({ shipping, coupon: percentCoupon({ type: 'FREE_SHIPPING', value: 0 }) }),
    );
    expect(result.shippingTotal).toBe(0);
    expect(result.discountTotal).toBe(0);
  });

  it('charges the COD surcharge even when delivery is free', () => {
    const result = priceOrder(
      base({ shipping: { ...shipping, freeAbove: 100_000 }, isCashOnDelivery: true }),
    );
    expect(result.shippingTotal).toBe(15_000);
  });
});

describe('tax', () => {
  const inclusive = [{ rateBps: 1700, isInclusive: true, taxClass: 'STANDARD' }];
  const exclusive = [{ rateBps: 1700, isInclusive: false, taxClass: 'STANDARD' }];

  it('extracts inclusive tax without changing the total', () => {
    const result = priceOrder(base({ taxRules: inclusive }));
    expect(result.grandTotal).toBe(700_000);

    // Tax is computed and rounded PER LINE, because an invoice has to show a
    // tax figure against each line that sums to the total shown at the bottom.
    // 500000*1700/11700 -> 72650, 200000*1700/11700 -> 29060.
    // Rounding the Rs 7,000 aggregate instead would give 101709; the one-paisa
    // difference is the price of per-line attribution, and is intended.
    expect(result.taxTotal).toBe(101_710);
    expect(result.lines.map((l) => l.taxAmount)).toEqual([72_650, 29_060]);
  });

  it('always reports a tax total equal to the sum of its line taxes', () => {
    const result = priceOrder(base({ taxRules: inclusive }));
    const summed = result.lines.reduce((total, l) => total + l.taxAmount, 0);
    expect(result.taxTotal).toBe(summed);
  });

  it('adds exclusive tax on top', () => {
    const result = priceOrder(base({ taxRules: exclusive }));
    expect(result.taxTotal).toBe(119_000);
    expect(result.grandTotal).toBe(819_000);
  });

  it('taxes the discounted amount, not the list price', () => {
    const result = priceOrder(base({ taxRules: exclusive, coupon: percentCoupon() }));
    // 17% of Rs 6,300
    expect(result.taxTotal).toBe(107_100);
  });

  it('charges no tax when there are no rules', () => {
    expect(priceOrder(base()).taxTotal).toBe(0);
  });
});

describe('loyalty redemption', () => {
  it('reduces the payable total', () => {
    const result = priceOrder(base({ loyaltyRedemption: 50_000 }));
    expect(result.loyaltyApplied).toBe(50_000);
    expect(result.grandTotal).toBe(650_000);
  });

  it('never redeems more than the order is worth', () => {
    const result = priceOrder(base({ loyaltyRedemption: 99_999_999 }));
    expect(result.loyaltyApplied).toBe(700_000);
    expect(result.grandTotal).toBe(0);
  });

  it('does not reduce the taxable base', () => {
    const withPoints = priceOrder(
      base({
        taxRules: [{ rateBps: 1700, isInclusive: false, taxClass: 'STANDARD' }],
        loyaltyRedemption: 100_000,
      }),
    );
    const without = priceOrder(
      base({ taxRules: [{ rateBps: 1700, isInclusive: false, taxClass: 'STANDARD' }] }),
    );
    expect(withPoints.taxTotal).toBe(without.taxTotal);
  });
});

describe('invariants', () => {
  it('never produces a negative total', () => {
    const result = priceOrder(
      base({
        coupon: percentCoupon({ type: 'FIXED_AMOUNT', value: 10_000_000 }),
        loyaltyRedemption: 10_000_000,
      }),
    );
    expect(result.grandTotal).toBeGreaterThanOrEqual(0);
  });

  it('keeps every monetary output an integer', () => {
    const result = priceOrder(
      base({
        coupon: percentCoupon({ value: 33 }),
        shipping: { amount: 29_999, freeAbove: null, codSurcharge: 0, taxable: true },
        taxRules: [{ rateBps: 1700, isInclusive: true, taxClass: 'STANDARD' }],
      }),
    );
    for (const value of [
      result.subtotal,
      result.discountTotal,
      result.shippingTotal,
      result.taxTotal,
      result.grandTotal,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const line of result.lines) {
      expect(Number.isInteger(line.discountAmount)).toBe(true);
      expect(Number.isInteger(line.taxAmount)).toBe(true);
    }
  });

  it('is deterministic for identical input', () => {
    const input = base({ coupon: percentCoupon({ value: 17 }) });
    expect(priceOrder(input)).toEqual(priceOrder(input));
  });
});

describe('loyalty accrual', () => {
  it('earns one point per Rs 100 of merchandise', () => {
    expect(loyaltyPointsEarned(700_000)).toBe(70);
    expect(loyaltyPointsEarned(0)).toBe(0);
    expect(loyaltyPointsEarned(-100)).toBe(0);
  });

  it('converts points back to a redeemable amount', () => {
    expect(loyaltyPointsToMinor(70)).toBe(7_000);
    expect(loyaltyPointsToMinor(-5)).toBe(0);
  });
});
