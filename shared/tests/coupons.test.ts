import { describe, expect, it } from 'vitest';
import {
  describeCoupon,
  evaluateCoupon,
  normalizeCouponCode,
  type CouponContext,
  type CouponRecord,
} from '../src/coupons';

const NOW = new Date('2026-06-15T12:00:00Z');

function coupon(over: Partial<CouponRecord> = {}): CouponRecord {
  return {
    id: 'c1',
    code: 'WELCOME10',
    type: 'PERCENTAGE',
    value: 10,
    maxDiscount: null,
    minOrderSubtotal: 0,
    usageLimit: null,
    usageLimitPerUser: 1,
    usedCount: 0,
    appliesToCategoryIds: [],
    appliesToProductIds: [],
    firstOrderOnly: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    ...over,
  };
}

function ctx(over: Partial<CouponContext> = {}): CouponContext {
  return {
    subtotal: 500_000,
    productIds: ['p1'],
    categoryIds: ['cat1'],
    userRedemptions: 0,
    customerOrderCount: 0,
    now: NOW,
    ...over,
  };
}

describe('evaluateCoupon', () => {
  it('accepts a valid coupon', () => {
    expect(evaluateCoupon(coupon(), ctx()).valid).toBe(true);
  });

  it('rejects an unknown code', () => {
    const result = evaluateCoupon(null, ctx());
    expect(result.valid).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('rejects a deactivated coupon', () => {
    expect(evaluateCoupon(coupon({ isActive: false }), ctx()).code).toBe('INACTIVE');
  });

  it('rejects a coupon whose window has not opened', () => {
    const future = new Date('2026-07-01T00:00:00Z');
    expect(evaluateCoupon(coupon({ startsAt: future }), ctx()).code).toBe('NOT_STARTED');
  });

  it('rejects an expired coupon', () => {
    const past = new Date('2026-06-01T00:00:00Z');
    expect(evaluateCoupon(coupon({ endsAt: past }), ctx()).code).toBe('EXPIRED');
  });

  it('accepts a coupon inside its window', () => {
    const record = coupon({
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-06-30T00:00:00Z'),
    });
    expect(evaluateCoupon(record, ctx()).valid).toBe(true);
  });

  it('rejects once the global usage limit is reached', () => {
    const record = coupon({ usageLimit: 100, usedCount: 100 });
    expect(evaluateCoupon(record, ctx()).code).toBe('USAGE_LIMIT_REACHED');
  });

  it('rejects once this customer has used their allowance', () => {
    const result = evaluateCoupon(coupon({ usageLimitPerUser: 1 }), ctx({ userRedemptions: 1 }));
    expect(result.code).toBe('USER_LIMIT_REACHED');
  });

  it('allows unlimited per-user redemptions when the limit is null', () => {
    const result = evaluateCoupon(
      coupon({ usageLimitPerUser: null }),
      ctx({ userRedemptions: 50 }),
    );
    expect(result.valid).toBe(true);
  });

  it('enforces a first-order-only coupon', () => {
    const record = coupon({ firstOrderOnly: true });
    expect(evaluateCoupon(record, ctx({ customerOrderCount: 0 })).valid).toBe(true);
    expect(evaluateCoupon(record, ctx({ customerOrderCount: 1 })).code).toBe('FIRST_ORDER_ONLY');
  });

  it('enforces the minimum subtotal', () => {
    const record = coupon({ minOrderSubtotal: 1_000_000 });
    expect(evaluateCoupon(record, ctx({ subtotal: 999_999 })).code).toBe('MIN_SUBTOTAL_NOT_MET');
    expect(evaluateCoupon(record, ctx({ subtotal: 1_000_000 })).valid).toBe(true);
  });

  it('requires a scoped coupon to match something in the basket', () => {
    const record = coupon({ appliesToCategoryIds: ['cat-abaya'] });
    expect(evaluateCoupon(record, ctx({ categoryIds: ['cat1'] })).code).toBe('NO_ELIGIBLE_ITEMS');
    expect(evaluateCoupon(record, ctx({ categoryIds: ['cat-abaya'] })).valid).toBe(true);
  });

  it('matches a product-scoped coupon on product id', () => {
    const record = coupon({ appliesToProductIds: ['p-special'] });
    expect(evaluateCoupon(record, ctx({ productIds: ['p-special'] })).valid).toBe(true);
  });

  it('never leaks how many uses remain', () => {
    const result = evaluateCoupon(coupon({ usageLimit: 100, usedCount: 100 }), ctx());
    expect(result.message).not.toMatch(/\d/);
  });
});

describe('normalizeCouponCode', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeCouponCode('  welcome 10 ')).toBe('WELCOME10');
  });
});

describe('describeCoupon', () => {
  const fmt = (minor: number) => `Rs ${(minor / 100).toLocaleString('en-PK')}`;

  it('describes a percentage coupon with a cap', () => {
    const text = describeCoupon(
      { type: 'PERCENTAGE', value: 20, maxDiscount: 200_000, minOrderSubtotal: 0 },
      fmt,
    );
    expect(text).toContain('20% off');
    expect(text).toContain('max');
  });

  it('describes a fixed-amount coupon with a minimum', () => {
    const text = describeCoupon(
      { type: 'FIXED_AMOUNT', value: 50_000, maxDiscount: null, minOrderSubtotal: 300_000 },
      fmt,
    );
    expect(text).toContain('off');
    expect(text).toContain('on orders over');
  });

  it('describes free shipping', () => {
    const text = describeCoupon(
      { type: 'FREE_SHIPPING', value: 0, maxDiscount: null, minOrderSubtotal: 0 },
      fmt,
    );
    expect(text).toBe('Free shipping');
  });
});
