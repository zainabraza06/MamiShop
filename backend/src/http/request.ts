import type { Request, Response } from 'express';
import { CART_COOKIE, CART_COOKIE_MAX_AGE_SECONDS } from '@momishop/shared/session-contract';
import { hashIp } from '../lib/crypto';
import { isProduction } from '../lib/env';
import { enforceRateLimit, type RateLimitName } from '../lib/rate-limit';
import type { CartOwner } from '../services/cart';

/**
 * The signed-in user's id, straight from the verified session token.
 *
 * Only for reading the caller's own data — their cart, their wishlist — where
 * a stale token is harmless. Anything privileged goes through requireStaff or
 * requirePermission, which re-read the live user row.
 */
export function sessionUserId(req: Request): string | null {
  return req.auth?.sub ?? null;
}

/**
 * The caller's IP, hashed, for rate-limit keys and audit rows.
 *
 * `req.ip` honours the app's `trust proxy` setting, so a forwarded address is
 * only believed when it arrives from a proxy configured as trusted. Reading
 * X-Forwarded-For directly would let any client choose its own rate-limit key.
 */
export function ipHash(req: Request): string {
  return hashIp(req.ip);
}

/**
 * Applies a rate limit keyed to the caller. The user id is preferred when
 * signed in: keying a signed-in user by IP punishes everyone behind the same
 * office or mobile-carrier NAT.
 */
export async function rateLimit(
  req: Request,
  name: RateLimitName,
  userId?: string | null,
): Promise<void> {
  await enforceRateLimit(name, userId ?? ipHash(req));
}

export function cartOwner(req: Request): CartOwner {
  const token: unknown = req.cookies?.[CART_COOKIE];
  return {
    userId: sessionUserId(req),
    token: typeof token === 'string' && token.length > 0 ? token : null,
  };
}

/**
 * The cart cookie is httpOnly so page scripts cannot read or forge it, and it
 * carries only an opaque random token — never a cart id that could be
 * incremented to walk into someone else's basket.
 */
export function setCartCookie(res: Response, token: string): void {
  res.cookie(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS * 1000,
  });
}
