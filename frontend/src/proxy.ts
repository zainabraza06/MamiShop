import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { STAFF_ROLES, type UserRole } from '@momishop/shared/rbac';
import {
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  sessionCookieName,
} from '@momishop/shared/session-contract';

/**
 * Proxy (formerly middleware): the first of two authorisation gates.
 *
 * This runs before the page and gives a fast redirect for the obvious cases —
 * an anonymous visitor hitting /admin, a customer hitting /account. It verifies
 * the session token the API issued, which is cheap but reflects the user's
 * state at sign-in rather than right now.
 *
 * It is therefore NOT the security boundary. The API re-checks the live user
 * record on every privileged request, and the admin pages get their data from
 * those checked endpoints. If this file were deleted the store would still be
 * secure, only less pleasant to use. That redundancy is deliberate: matchers
 * are easy to get subtly wrong, and a matcher bug should not become a
 * privilege escalation.
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

interface ProxySession {
  role: UserRole;
  status: string;
}

/** The session claims, or null when there is no valid token. */
async function readSession(request: NextRequest): Promise<ProxySession | null> {
  const token = request.cookies.get(sessionCookieName(process.env.NODE_ENV === 'production'));
  const secret = process.env.AUTH_SECRET;
  if (!token?.value || !secret) return null;

  try {
    const { payload } = await jwtVerify(token.value, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (typeof payload.role !== 'string' || typeof payload.status !== 'string') return null;
    return { role: payload.role as UserRole, status: payload.status };
  } catch {
    return null;
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const url = new URL('/login', request.nextUrl);
  url.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await readSession(request);
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
