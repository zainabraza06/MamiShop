import { cache } from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { hasPermission, isStaff, type Permission, type Principal } from '@/lib/rbac';
import type { UserRole, UserStatus } from '@prisma/client';

/**
 * Server-side session guards. This is the authorisation boundary.
 *
 * The middleware in src/middleware.ts gives a fast redirect based on the
 * session JWT; these functions decide. The distinction matters because a JWT
 * carries the user's role *as of sign-in*. If an owner demotes a staff member
 * at 09:00, that person's week-old token still claims ADMIN. So anything that
 * grants privilege re-reads the live row.
 *
 * `getCurrentUser` is wrapped in React's `cache()`, which dedupes it per
 * request: a layout, a page and three server components can all call it and
 * the database sees one query.
 */

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
}

/** The signed-in user, or null. Never throws. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      permissions: true,
      deletedAt: true,
    },
  });

  // The token outlived the account, or the account was suspended or erased
  // after the token was issued.
  if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
  };
});

/**
 * The session's user id without a database round-trip.
 *
 * Only safe where the consequence of a stale token is harmless — reading the
 * caller's own cart or wishlist. Never use it to authorise a privileged
 * action; use `requireStaff` or `requirePermission` for that.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requireStaff(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isStaff(user as Principal)) throw new AuthorizationError();
  return user;
}

/**
 * Asserts a specific capability. Prefer this over a bare role check: it keeps
 * the requirement legible at the call site and lets the owner grant one
 * capability without promoting someone to a whole role.
 */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireStaff();
  if (!hasPermission(user as Principal, permission)) {
    throw new AuthorizationError(`This action requires the "${permission}" permission.`);
  }
  return user;
}

/** Non-throwing variant for conditionally rendering admin UI. */
export async function can(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  return hasPermission(user as Principal | null, permission);
}

/**
 * Confirms the caller owns a record, or is staff acting on someone else's.
 *
 * Guards the classic IDOR: /account/orders/<id> with someone else's id. The
 * ownership check has to happen server-side on every single fetch, because
 * nothing stops a customer editing the URL.
 */
export async function assertOwnershipOrStaff(
  ownerId: string | null,
  permission: Permission = 'order.read',
): Promise<CurrentUser> {
  const user = await requireUser();
  if (ownerId && ownerId === user.id) return user;
  if (hasPermission(user as Principal, permission)) return user;
  // Reported as "not found" rather than "forbidden" so probing for valid ids
  // returns nothing useful.
  throw new AuthorizationError('That record could not be found.');
}
