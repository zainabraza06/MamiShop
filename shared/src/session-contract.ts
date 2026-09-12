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
 * The name to issue the session cookie under.
 *
 * `__Host-` makes the browser refuse the cookie unless it is Secure, host-only
 * and scoped to `/`, so neither a sibling subdomain nor a plain-HTTP response
 * can plant or overwrite it. The flip side is that the prefix *requires*
 * Secure: a browser silently drops a `__Host-` cookie delivered over plain
 * HTTP, which would sign every visitor out.
 *
 * So the choice follows whether the deployment actually serves HTTPS — not
 * NODE_ENV, which each service reads for itself and which therefore let a
 * production storefront look for a cookie its development-mode API had never
 * issued.
 */
export function sessionCookieName(secureCookies: boolean): string {
  return secureCookies ? '__Host-momishop.session' : 'momishop.session';
}

/**
 * Every name a reader should accept, most specific first.
 *
 * Readers take either, because a token is only trusted once its signature
 * verifies — the name proves nothing on its own. Accepting both costs nothing
 * and removes a whole class of failure where the service issuing the cookie and
 * the service reading it disagree about which name to use.
 */
export const SESSION_COOKIE_NAMES = ['__Host-momishop.session', 'momishop.session'] as const;

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
