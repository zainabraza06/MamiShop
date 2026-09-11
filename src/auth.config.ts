import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Lightweight auth configuration for the proxy.
 *
 * `src/proxy.ts` only needs to read and verify the session JWT, so it imports
 * this slim config rather than `src/auth.ts`. The Credentials provider (bcrypt)
 * and the Prisma adapter are added in `src/auth.ts` for everything else.
 *
 * The split predates Next 16. Middleware used to run on the edge runtime, which
 * could not load bcrypt or Prisma at all. Next 16's `proxy.ts` runs on Node, so
 * the runtime no longer forces the split — it is kept because it keeps the
 * per-request proxy bundle small and free of database code it has no use for.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
    newUser: '/account',
  },

  session: {
    // JWT rather than database sessions: the Credentials provider requires it,
    // and it avoids a database round-trip on every request. The trade-off is
    // that a revoked session stays valid until it expires, so `maxAge` is kept
    // short and privileged mutations re-check the user's live role and status
    // against the database (see requireStaff() in src/server/session.ts).
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  callbacks: {
    /**
     * Copies role and status onto the token at sign-in.
     *
     * `trigger === 'update'` re-reads them when the app calls `session.update()`,
     * so a role change can be pushed without forcing a sign-out.
     */
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? 'CUSTOMER';
        token.status = (user as { status?: string }).status ?? 'ACTIVE';
        token.permissions = (user as { permissions?: string[] }).permissions ?? [];
      }

      if (trigger === 'update' && session) {
        const next = session as { role?: string; status?: string; permissions?: string[] };
        if (next.role) token.role = next.role;
        if (next.status) token.status = next.status;
        if (next.permissions) token.permissions = next.permissions;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.status = token.status as string;
        session.user.permissions = (token.permissions as string[]) ?? [];
      }
      return session;
    },
  },

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // Secure cookies in production; the __Secure- prefix additionally makes
        // the browser reject the cookie if it ever arrives over plain HTTP.
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  trustHost: true,
} satisfies NextAuthConfig;
