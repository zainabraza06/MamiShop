import type { DefaultSession } from 'next-auth';

/**
 * Augments the NextAuth session and JWT with MomiShop's authorisation fields.
 *
 * These are convenience only. Nothing here is trusted for authorisation: the
 * token is signed by us but reflects the user's state at sign-in, so a role
 * revoked five minutes ago would still appear valid. Privileged server
 * entry points re-read `role` and `status` from the database — see
 * `requireStaff()` in src/server/session.ts.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
      status: string;
      permissions: string[];
    } & DefaultSession['user'];
  }

  interface User {
    role?: string;
    status?: string;
    permissions?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: string;
    status?: string;
    permissions?: string[];
  }
}

export {};
