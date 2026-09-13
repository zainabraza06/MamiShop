import type { AdminCoupon } from '@momishop/shared/api-types';

/**
 * Where a code stands right now, from the shopper's side.
 *
 * Mirrors the API's list filter: "active" means switched on, started and not
 * yet ended. A code that is switched on but past its end date is "expired",
 * not "active" — the switch alone does not make it usable.
 */
export type CouponState = 'active' | 'scheduled' | 'expired' | 'inactive';

export const COUPON_STATE_LABEL: Record<CouponState, string> = {
  active: 'live',
  scheduled: 'scheduled',
  expired: 'ended',
  inactive: 'switched off',
};

export function couponState(
  coupon: Pick<AdminCoupon, 'isActive' | 'startsAt' | 'endsAt'>,
  now: Date,
): CouponState {
  if (coupon.endsAt && new Date(coupon.endsAt) <= now) return 'expired';
  if (!coupon.isActive) return 'inactive';
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return 'scheduled';
  return 'active';
}
