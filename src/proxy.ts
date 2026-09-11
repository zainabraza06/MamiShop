import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';
import { STAFF_ROLES } from '@/lib/rbac';
import type { UserRole } from '@prisma/client';

/**
 * Proxy (formerly middleware): the first of two authorisation gates.
 *
 * Next 16 renamed the `middleware.ts` convention to `proxy.ts`; the build warns
 * on the old name. Behaviour is unchanged, and a default export remains valid.
 *
 * This runs before the page and gives a fast redirect for the obvious cases —
 * an anonymous visitor hitting /admin, a customer hitting /account. It reads
 * the signed session JWT, which is cheap but reflects the user's state at
 * sign-in rather than right now.
 *
 * It is therefore NOT the security boundary. Every admin page and every
 * mutating route handler independently re-checks the live user record via
 * `requireStaff()` / `requirePermission()`. If this file were deleted the app
 * would still be secure, only less pleasant to use. That redundancy is
 * deliberate: matchers are easy to get subtly wrong, and a matcher bug should
 * not become a privilege escalation.
 */
const { auth } = NextAuth(authConfig);

/** Paths that require any signed-in user. */
const CUSTOMER_PREFIXES = ['/account', '/checkout/confirm'];

/** Paths that require a staff-level role. */
const STAFF_PREFIXES = ['/admin'];

/** Auth pages a signed-in user should be bounced away from. */
const GUEST_ONLY = ['/login', '/register', '/forgot-password'];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((request) => {
  const { nextUrl } = request;
  const { pathname, search } = nextUrl;
  const session = request.auth;
  const isSignedIn = Boolean(session?.user);
  const role = session?.user?.role as UserRole | undefined;
  const status = session?.user?.status;

  // A suspended session is terminated everywhere except the sign-out route,
  // so the user can still clear their own cookie.
  if (isSignedIn && status && status !== 'ACTIVE' && !pathname.startsWith('/api/auth')) {
    const url = new URL('/login', nextUrl);
    url.searchParams.set('error', 'AccountSuspended');
    return NextResponse.redirect(url);
  }

  if (startsWithAny(pathname, STAFF_PREFIXES)) {
    if (!isSignedIn) {
      const url = new URL('/login', nextUrl);
      url.searchParams.set('callbackUrl', `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    if (!role || !STAFF_ROLES.includes(role)) {
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

  if (startsWithAny(pathname, CUSTOMER_PREFIXES) && !isSignedIn) {
    const url = new URL('/login', nextUrl);
    url.searchParams.set('callbackUrl', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (startsWithAny(pathname, GUEST_ONLY) && isSignedIn) {
    const destination = role && STAFF_ROLES.includes(role) ? '/admin' : '/account';
    return NextResponse.redirect(new URL(destination, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Runs on everything except static assets, image optimisation output, and
   * the files search engines and browsers fetch directly.
   *
   * Note that `/api/*` IS matched: API routes need the suspended-account check
   * above. Stripe and gateway webhooks live under /api/webhooks and carry no
   * session, so they fall through untouched and verify their own signatures.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|monitoring|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf)$).*)',
  ],
};
