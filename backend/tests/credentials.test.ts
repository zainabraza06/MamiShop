import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Password sign-in, with the database and bcrypt mocked.
 *
 * What is under test is the policy: one generic failure for every bad case,
 * a timing decoy wherever the real comparison is skipped, and the lockout
 * counter.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  loginAttempt: { create: vi.fn() },
}));

const passwordMock = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  fakeVerify: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/password', () => passwordMock);

import { authenticateWithPassword } from '../src/auth/credentials';
import { __setStoreForTesting } from '../src/lib/redis';

const ctx = { ipHash: 'hashed-ip', userAgent: 'vitest' };
const credentials = { email: 'customer@momishop.pk', password: 'CorrectHorse99' };

function storedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: credentials.email,
    name: 'Customer',
    image: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    permissions: [],
    passwordHash: '$2a$12$stored-hash',
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function lastAttemptReason(): string | null {
  const calls = prismaMock.loginAttempt.create.mock.calls;
  return calls.at(-1)?.[0].data.reason ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  // The login limiter uses fixed windows; pin the clock inside one.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T12:00:10Z'));

  prismaMock.user.update.mockResolvedValue({});
  prismaMock.loginAttempt.create.mockResolvedValue({});
  passwordMock.fakeVerify.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  __setStoreForTesting(null);
});

describe('authenticateWithPassword', () => {
  it('signs in with the right password and clears the failure counter', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser({ failedLoginCount: 3 }));
    passwordMock.verifyPassword.mockResolvedValue(true);

    const user = await authenticateWithPassword(credentials, ctx);

    expect(user).toMatchObject({ id: 'user_1', role: 'CUSTOMER' });
    expect(user).not.toHaveProperty('passwordHash');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      }),
    );
    expect(lastAttemptReason()).toBeNull();
  });

  it('rejects an unknown email while still spending the time of a real check', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(passwordMock.fakeVerify).toHaveBeenCalledOnce();
    expect(passwordMock.verifyPassword).not.toHaveBeenCalled();
    expect(lastAttemptReason()).toBe('UNKNOWN_EMAIL');
  });

  it('counts a wrong password without locking the account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser({ failedLoginCount: 1 }));
    passwordMock.verifyPassword.mockResolvedValue(false);

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: 2, lockedUntil: null } }),
    );
    expect(lastAttemptReason()).toBe('BAD_PASSWORD');
  });

  it('locks the account for 15 minutes on the fifth consecutive failure', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser({ failedLoginCount: 4 }));
    passwordMock.verifyPassword.mockResolvedValue(false);

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();

    const { data } = prismaMock.user.update.mock.calls[0][0];
    expect(data.failedLoginCount).toBe(5);
    expect(data.lockedUntil.getTime() - Date.now()).toBe(15 * 60 * 1000);
    expect(lastAttemptReason()).toBe('LOCKED_OUT');
  });

  it('refuses a locked account even with the right password', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      storedUser({ lockedUntil: new Date(Date.now() + 60_000) }),
    );
    passwordMock.verifyPassword.mockResolvedValue(true);

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(passwordMock.verifyPassword).not.toHaveBeenCalled();
    expect(passwordMock.fakeVerify).toHaveBeenCalledOnce();
    expect(lastAttemptReason()).toBe('ACCOUNT_LOCKED');
  });

  it('lets a customer back in once the lock has expired', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      storedUser({ failedLoginCount: 5, lockedUntil: new Date(Date.now() - 1000) }),
    );
    passwordMock.verifyPassword.mockResolvedValue(true);

    expect(await authenticateWithPassword(credentials, ctx)).not.toBeNull();
  });

  it('refuses a suspended account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser({ status: 'SUSPENDED' }));
    passwordMock.verifyPassword.mockResolvedValue(true);

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(lastAttemptReason()).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('refuses an OAuth-only account that has no password', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser({ passwordHash: null }));

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(lastAttemptReason()).toBe('NO_PASSWORD_SET');
  });

  it('rejects malformed input without touching the database', async () => {
    expect(await authenticateWithPassword({ email: 'not-an-email' }, ctx)).toBeNull();
    expect(await authenticateWithPassword(undefined, ctx)).toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('stops querying the database once an IP has used its attempts', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    for (let i = 0; i < 5; i++) await authenticateWithPassword(credentials, ctx);
    prismaMock.user.findUnique.mockClear();

    expect(await authenticateWithPassword(credentials, ctx)).toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(lastAttemptReason()).toBe('RATE_LIMITED');
  });

  it('still signs the customer in when the attempt log cannot be written', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser());
    passwordMock.verifyPassword.mockResolvedValue(true);
    prismaMock.loginAttempt.create.mockRejectedValue(new Error('database unavailable'));

    expect(await authenticateWithPassword(credentials, ctx)).not.toBeNull();
  });
});
