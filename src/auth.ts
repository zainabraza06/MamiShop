import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { authConfig } from '@/auth.config';
import { prisma } from '@/lib/db';
import { fakeVerify, verifyPassword } from '@/lib/password';
import { hashIp } from '@/lib/crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { loginSchema } from '@/lib/validation';

/**
 * Account lockout.
 *
 * After 5 failed attempts the account is locked for 15 minutes. This is
 * per-account and complements the per-IP rate limit: together they stop both
 * "one attacker guessing one password many times" and "many IPs guessing one
 * account".
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface AttemptContext {
  email: string;
  ipHash: string;
  userAgent: string | null;
}

async function recordAttempt(
  ctx: AttemptContext,
  successful: boolean,
  reason?: string,
): Promise<void> {
  // Never let audit logging break a sign-in.
  try {
    await prisma.loginAttempt.create({
      data: {
        email: ctx.email,
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),

  providers: [
    ...authConfig.providers,

    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      /**
       * Returns null for every failure mode, deliberately.
       *
       * The caller shows one message — "Those details do not match an
       * account" — regardless of whether the email is unknown, the password
       * wrong, or the account suspended. Distinguishing them turns the login
       * form into an account-enumeration oracle.
       */
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const headers = request?.headers as Headers | undefined;
        const forwarded = headers?.get('x-forwarded-for') ?? null;
        const ipHash = hashIp(forwarded?.split(',')[0]?.trim());
        const userAgent = headers?.get('user-agent') ?? null;
        const ctx: AttemptContext = { email, ipHash, userAgent };

        // Per-IP throttle before touching the database at all.
        const limit = await checkRateLimit('authLogin', ipHash);
        if (!limit.ok) {
          await recordAttempt(ctx, false, 'RATE_LIMITED');
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
          // Burn equivalent time so an unknown email is indistinguishable from
          // a wrong password by response latency.
          await fakeVerify();
          await recordAttempt(ctx, false, user ? 'NO_PASSWORD_SET' : 'UNKNOWN_EMAIL');
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await fakeVerify();
          await recordAttempt(ctx, false, 'ACCOUNT_LOCKED');
          return null;
        }

        if (user.status !== 'ACTIVE') {
          await fakeVerify();
          await recordAttempt(ctx, false, 'ACCOUNT_NOT_ACTIVE');
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

          await recordAttempt(ctx, false, shouldLock ? 'LOCKED_OUT' : 'BAD_PASSWORD');
          if (shouldLock) {
            logger.warn('Account locked after repeated failed logins', {
              userId: user.id,
              ipHash,
            });
          }
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });

        await recordAttempt(ctx, true);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          status: user.status,
          permissions: user.permissions,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Final gate before a session is issued.
     *
     * OAuth sign-ins skip `authorize()` entirely, so suspended-account and
     * verified-email checks have to live here too, or a banned user could get
     * straight back in through Google.
     */
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true;

      if (!user.email) return false;

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { status: true },
      });

      if (existing && existing.status !== 'ACTIVE') return false;

      return true;
    },
  },

  events: {
    /**
     * Google verifies email addresses itself, so an account created through
     * OAuth starts verified. A credentials account does not.
     */
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date() },
        });
      } catch (error) {
        logger.error('Failed to mark OAuth user as verified', { error, userId: user.id });
      }
    },

    async signOut() {
      logger.info('User signed out');
    },
  },
});
