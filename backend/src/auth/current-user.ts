import type { Request } from 'express';
import type { UserRole, UserStatus } from '@prisma/client';
import { hasPermission, isStaff, type Permission, type Principal } from '@momishop/shared/rbac';
import { prisma } from '../lib/db';
import { AuthenticationError, AuthorizationError } from '../lib/errors';

/**
 * The authorisation boundary.
 *
 * A session token says who the caller is and what their role was when they
 * signed in. That is enough for the storefront's redirects, but not for
 * granting privilege: if an owner demotes a staff member at 09:00, that
 * person's week-old token still claims ADMIN. So everything here re-reads the
 * live user row.
 *
 * The lookup is memoised per request, so a handler that checks a permission
 * and then reads the user runs one query, not two.
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

const perRequest = new WeakMap<Request, Promise<CurrentUser | null>>();

async function loadUser(userId: string | null): Promise<CurrentUser | null> {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
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
}

/** The signed-in, still-active user, or null. */
export function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  let pending = perRequest.get(req);
  if (!pending) {
    pending = loadUser(req.auth?.sub ?? null);
    perRequest.set(req, pending);
  }
  return pending;
}

export async function requireUser(req: Request): Promise<CurrentUser> {
  const user = await getCurrentUser(req);
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requireStaff(req: Request): Promise<CurrentUser> {
  const user = await requireUser(req);
  if (!isStaff(user as Principal)) throw new AuthorizationError();
  return user;
}

/**
 * Asserts a specific capability. Prefer this over a bare role check: it keeps
 * the requirement legible at the call site and lets the owner grant one
 * capability without promoting someone to a whole role.
 */
export async function requirePermission(
  req: Request,
  permission: Permission,
): Promise<CurrentUser> {
  const user = await requireStaff(req);
  if (!hasPermission(user as Principal, permission)) {
    throw new AuthorizationError(`This action requires the "${permission}" permission.`);
  }
  return user;
}

/**
 * Confirms the caller owns a record, or is staff acting on someone else's.
 *
 * Guards the classic IDOR: /account/orders/<id> with someone else's id.
 * Reported as "not found" rather than "forbidden", so probing for valid ids
 * returns nothing useful.
 */
export async function assertOwnershipOrStaff(
  req: Request,
  ownerId: string | null,
  permission: Permission = 'order.read',
): Promise<CurrentUser> {
  const user = await requireUser(req);
  if (ownerId && ownerId === user.id) return user;
  if (hasPermission(user as Principal, permission)) return user;
  throw new AuthorizationError('That record could not be found.');
}
