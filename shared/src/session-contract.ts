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

/**
 * Reads a session token's claims **without verifying its signature**.
 *
 * For redirect decisions only, and deliberately so. The storefront's proxy
 * sends an anonymous visitor to sign in and a customer away from /admin; none
 * of that is a security decision, because every route behind it gets its data
 * from the API, which verifies the signature and re-reads the live user row.
 * A forged cookie therefore buys nothing: the page it reaches answers 401 and
 * bounces the visitor straight back.
 *
 * What this buys is one less shared secret. Verifying here would mean the
 * storefront and the API must hold the identical AUTH_SECRET, and when they
 * drift — a trailing space, a value set after the last build — every signed-in
 * visitor silently looks anonymous. That failure is invisible until someone
 * tries to sign in, and it cost this deployment twice.
 *
 * Expiry is honoured, because an expired token is not a session by any
 * reading. Anything malformed is treated as no session at all.
 */
export function readUnverifiedClaims(token: string, now = Date.now()): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let payload: unknown;
  try {
    // JWT payloads are base64url; atob wants base64 with padding. Claims here
    // are ids, roles and numbers, so the ASCII-only limitation never bites.
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const { sub, role, status, permissions, iat, exp } = payload as Record<string, unknown>;

  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof role !== 'string' || typeof status !== 'string') return null;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;
  if (exp * 1000 <= now) return null;

  return {
    sub,
    role: role as UserRole,
    status,
    permissions: Array.isArray(permissions) ? permissions.filter((p) => typeof p === 'string') : [],
    iat,
    exp,
  };
}

/** The contents of a session token. */
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
