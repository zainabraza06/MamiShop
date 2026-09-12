import { NextResponse, type NextRequest } from 'next/server';
import { STAFF_ROLES } from '@momishop/shared/rbac';
import {
  SESSION_COOKIE_NAMES,
  readUnverifiedClaims,
  type SessionClaims,
} from '@momishop/shared/session-contract';

/**
 * Proxy (formerly middleware): the first of two authorisation gates.
 *
 * This runs before the page and gives a fast redirect for the obvious cases —
 * an anonymous visitor hitting /admin, a customer hitting /account. It reads
 * the session cookie the API issued, **without verifying its signature**.
 *
 * That is deliberate. This is NOT the security boundary: every route behind it
 * gets its data from the API, which verifies the token and re-reads the live
 * user row on each request. A forged cookie gets a visitor as far as a page
 * that immediately answers 401 and sends them back to sign in.
 *
 * Verifying here would mean holding the same AUTH_SECRET as the API, and a
 * mismatch between the two silently signs everybody out — a failure that looks
 * exactly like "sign-in is broken" and says nothing about its cause. Not
 * sharing the secret removes that whole class of problem, at the cost of a
 * redirect that a determined visitor can mislead into showing them a page that
 * then refuses them.
 */

/** Paths that require any signed-in user. */
const CUSTOMER_PREFIXES = ['/account', '/checkout/confirm'];

/** Paths that require a staff-level role. */
const STAFF_PREFIXES = ['/admin'];

/** Auth pages a signed-in user should be bounced away from. */
const GUEST_ONLY = ['/login', '/register', '/forgot-password'];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The session's claims, or null when there is no usable cookie. */
function readSession(request: NextRequest): SessionClaims | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(name)?.value;
    if (!value) continue;

    const claims = readUnverifiedClaims(value);
    if (claims) return claims;
  }
  return null;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const url = new URL('/login', request.nextUrl);
  url.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = readSession(request);
  const isStaff = Boolean(session && STAFF_ROLES.includes(session.role));

  // A session whose account was not active when issued is sent to the sign-in
  // page to be told why — but not from the sign-in page itself, which would loop.
  if (session && session.status !== 'ACTIVE' && pathname !== '/login') {
    const url = new URL('/login', request.nextUrl);
    url.searchParams.set('error', 'AccountSuspended');
    return NextResponse.redirect(url);
  }

  if (startsWithAny(pathname, STAFF_PREFIXES)) {
    if (!session) return redirectToLogin(request);
    if (!isStaff) {
      /**
       * Signed in, but not staff. Sent home rather than shown a 403.
       *
       * An earlier version rewrote to a synthetic /not-found path to avoid
       * confirming the admin area exists. That was a mistake: the path is not
       * a real route, so Next.js treated it as an external proxy target and
       * returned a 500. Concealing /admin was marginal anyway — a redirect is
       * honest, cannot break, and leaks nothing a customer could act on.
       */
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  if (startsWithAny(pathname, CUSTOMER_PREFIXES) && !session) {
    return redirectToLogin(request);
  }

  if (startsWithAny(pathname, GUEST_ONLY) && session) {
    return NextResponse.redirect(new URL(isStaff ? '/admin' : '/account', request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Runs on pages only. Excluded are static assets, image optimisation output,
   * the files search engines and browsers fetch directly, and /api — which is
   * proxied to the API, and the API makes its own authorisation decisions.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|monitoring|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf)$).*)',
  ],
};
