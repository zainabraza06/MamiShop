import type { UserRole } from './rbac';

/**
 * The cookie contract between the API, which issues the session and cart
 * cookies, and the storefront proxy, which reads the session cookie to make
 * fast redirect decisions.
 *
 * Kept in one place because a mismatch fails silently: rename the cookie or
 * change the audience on one side only, and every visitor just looks signed
 * out.
 */

export const SESSION_ISSUER = 'momishop-api';
export const SESSION_AUDIENCE = 'momishop-web';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * A token older than this is reissued on the caller's next request, so someone
 * who shops every few days is not signed out mid-visit by a fixed expiry.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 60 * 60 * 24;

export const CART_COOKIE = 'momishop_cart';
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The session cookie name.
 *
 * `__Host-` in production makes the browser refuse the cookie unless it is
 * Secure, host-only and scoped to `/`, so neither a sibling subdomain nor a
 * plain-HTTP response can plant or overwrite it. Development has no HTTPS for
 * the prefix to require, so it is dropped there.
 */
export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? '__Host-momishop.session' : 'momishop.session';
}

/** The verified contents of a session token. */
export interface SessionClaims {
  /** User id. */
  sub: string;
  /** Role as of sign-in. Anything privileged re-reads the live row. */
  role: UserRole;
  status: string;
  permissions: string[];
  iat: number;
  exp: number;
}
