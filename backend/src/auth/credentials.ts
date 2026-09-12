import type { UserRole, UserStatus } from '@prisma/client';
import { loginSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { fakeVerify, verifyPassword } from '../lib/password';
import { checkRateLimit, releaseRateLimit } from '../lib/rate-limit';

/**
 * Email and password sign-in.
 *
 * Account lockout: after 5 failed attempts the account is locked for 15
 * minutes. This is per-account and complements the per-IP rate limit, so
 * together they stop both "one attacker guessing one password many times" and
 * "many IPs guessing one account".
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface LoginContext {
  ipHash: string;
  userAgent: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
}

async function recordAttempt(
  email: string,
  ctx: LoginContext,
  successful: boolean,
  reason?: string,
): Promise<void> {
  // Never let audit logging break a sign-in.
  try {
    await prisma.loginAttempt.create({
      data: {
        email,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        successful,
        reason: reason ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to record login attempt', { error });
  }
}

/**
 * Returns null for every failure mode, deliberately.
 *
 * The caller shows one message — "Those details do not match an account" —
 * whether the email is unknown, the password wrong, or the account locked.
 * Distinguishing them turns the login form into an account-enumeration
 * oracle, and every failure path burns a bcrypt comparison so the cases cannot
 * be told apart by response time either.
 */
export async function authenticateWithPassword(
  credentials: unknown,
  ctx: LoginContext,
): Promise<AuthenticatedUser | null> {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;

  // Per-IP throttle before touching the database at all.
  const limit = await checkRateLimit('authLogin', ctx.ipHash);
  if (!limit.ok) {
    await recordAttempt(email, ctx, false, 'RATE_LIMITED');
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      permissions: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!user || !user.passwordHash) {
    await fakeVerify();
    await recordAttempt(email, ctx, false, user ? 'NO_PASSWORD_SET' : 'UNKNOWN_EMAIL');
    return null;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await fakeVerify();
    await recordAttempt(email, ctx, false, 'ACCOUNT_LOCKED');
    return null;
  }

  if (user.status !== 'ACTIVE') {
    await fakeVerify();
    await recordAttempt(email, ctx, false, 'ACCOUNT_NOT_ACTIVE');
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    await recordAttempt(email, ctx, false, shouldLock ? 'LOCKED_OUT' : 'BAD_PASSWORD');
    if (shouldLock) {
      logger.warn('Account locked after repeated failed logins', {
        userId: user.id,
        ipHash: ctx.ipHash,
      });
    }
    return null;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  // The throttle exists to stop guessing; this caller did not guess.
  await releaseRateLimit('authLogin', ctx.ipHash);

  await recordAttempt(email, ctx, true);

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
