import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The authorisation boundary. The scenario these tests exist for is the stale
 * token: a session issued while someone was an admin must stop granting admin
 * access the moment their live role changes.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import {
  assertOwnershipOrStaff,
  getCurrentUser,
  requirePermission,
  requireStaff,
  requireUser,
} from '../src/auth/current-user';
import { AuthenticationError, AuthorizationError } from '../src/lib/errors';

/** A request whose session token claims the given role. */
function requestFor(sub: string | null, claimedRole = 'CUSTOMER'): Request {
  const auth = sub
    ? { sub, role: claimedRole, status: 'ACTIVE', permissions: [], iat: 0, exp: 0 }
    : null;
  return { auth } as unknown as Request;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'someone@momishop.pk',
    name: 'Someone',
    image: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    permissions: [],
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCurrentUser', () => {
  it('is null for an anonymous request, without a query', async () => {
    expect(await getCurrentUser(requestFor(null))).toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('reads the user once per request, however many times it is asked', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    const req = requestFor('user_1');

    await getCurrentUser(req);
    await requireUser(req);

    expect(prismaMock.user.findUnique).toHaveBeenCalledOnce();
  });

  it('is null once the account is suspended, even though the token is valid', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ status: 'SUSPENDED' }));
    expect(await getCurrentUser(requestFor('user_1'))).toBeNull();
  });

  it('is null once the account is erased', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ deletedAt: new Date() }));
    expect(await getCurrentUser(requestFor('user_1'))).toBeNull();
  });

  it('never exposes the soft-delete marker', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    expect(await getCurrentUser(requestFor('user_1'))).not.toHaveProperty('deletedAt');
  });
});

describe('guards', () => {
  it('requires a signed-in user', async () => {
    await expect(requireUser(requestFor(null))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('refuses admin access to a demoted user whose token still claims ADMIN', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ role: 'CUSTOMER' }));

    await expect(requireStaff(requestFor('user_1', 'ADMIN'))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('grants a permission the live role holds', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ role: 'SUPER_ADMIN' }));

    await expect(requirePermission(requestFor('user_1'), 'order.read')).resolves.toMatchObject({
      role: 'SUPER_ADMIN',
    });
  });

  it('lets a customer act on their own record', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    await expect(assertOwnershipOrStaff(requestFor('user_1'), 'user_1')).resolves.toBeTruthy();
  });

  it("reports someone else's record as not found", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());

    await expect(assertOwnershipOrStaff(requestFor('user_1'), 'user_2')).rejects.toThrow(
      'That record could not be found.',
    );
  });

  it("lets staff with the permission act on a customer's record", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ role: 'SUPER_ADMIN' }));
    await expect(assertOwnershipOrStaff(requestFor('user_1'), 'user_2')).resolves.toBeTruthy();
  });
});
