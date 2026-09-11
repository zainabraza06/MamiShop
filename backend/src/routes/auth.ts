import { Router, type CookieOptions, type Response } from 'express';
import { absoluteUrl, safeRedirectPath } from '@momishop/shared/text';
import { registerSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { randomCode, randomToken } from '../lib/crypto';
import { isProduction } from '../lib/env';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { hashPassword } from '../lib/password';
import { authenticateWithPassword } from '../auth/credentials';
import { getCurrentUser } from '../auth/current-user';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_MS,
  OAuthSignInError,
  beginGoogleSignIn,
  completeGoogleSignIn,
} from '../auth/google';
import { endSession, startSession } from '../auth/session-token';
import { cartOwner, ipHash, rateLimit } from '../http/request';
import { parseBody } from '../http/validate';
import { mergeGuestCart } from '../services/cart';
import { enqueue } from '../services/jobs';

export const authRouter = Router();

/**
 * Carries a basket assembled before signing in over to the account.
 *
 * A basket that fails to merge is an inconvenience; a sign-in that fails
 * because of it is a lost customer. So a failure here is logged, not thrown.
 */
async function mergeCartAfterSignIn(userId: string, token: string | null): Promise<void> {
  try {
    await mergeGuestCart(userId, token);
  } catch (error) {
    logger.error('Could not merge guest cart at sign-in', { error, userId });
  }
}

/**
 * Account registration.
 *
 * Deliberately returns the same success response whether or not the email was
 * already registered. Returning "that email is taken" turns this endpoint into
 * an account-enumeration oracle — an attacker can check a leaked email list
 * against the store and learn who shops here, which for a modest-fashion
 * retailer is genuinely sensitive.
 *
 * The existing-account case instead triggers a "someone tried to register with
 * your email" notice to the real owner, which is both safer and more useful.
 */
authRouter.post('/auth/register', async (req, res) => {
  await rateLimit(req, 'authRegister');

  const input = parseBody(req, registerSchema);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true },
  });

  if (existing) {
    logger.info('Registration attempted for an existing email', { ipHash: ipHash(req) });

    await enqueue(
      'email.welcome',
      { userId: existing.id, kind: 'DUPLICATE_REGISTRATION' },
      {
        priority: 5,
        // One notice per account per day, no matter how many attempts.
        idempotencyKey: `dup-register:${existing.id}:${new Date().toISOString().slice(0, 10)}`,
      },
    );

    res.status(201).json({ ok: true, message: 'Check your email to continue.' });
    return;
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        passwordHash,
        marketingOptIn: input.marketingOptIn,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        loyaltyAccount: { create: {} },
      },
      select: { id: true, email: true, name: true },
    });

    // Give the new account its own referral code up front, so the referral
    // screen never has to lazily create one.
    await tx.referral.create({
      data: { referrerId: created.id, code: randomCode(8) },
    });

    // Credit the referrer, if this signup came from a valid code.
    if (input.referralCode) {
      const referral = await tx.referral.findUnique({
        where: { code: input.referralCode.toUpperCase() },
        select: { id: true, referrerId: true, referredId: true },
      });

      // A code can only be claimed once, and never by its own owner.
      if (referral && !referral.referredId && referral.referrerId !== created.id) {
        await tx.referral.update({
          where: { id: referral.id },
          data: { referredId: created.id, rewardedAt: new Date() },
        });

        await tx.loyaltyAccount.upsert({
          where: { userId: referral.referrerId },
          create: {
            userId: referral.referrerId,
            balance: 200,
            lifetimeEarned: 200,
            transactions: { create: { delta: 200, reason: 'REFERRAL' } },
          },
          update: {
            balance: { increment: 200 },
            lifetimeEarned: { increment: 200 },
            transactions: { create: { delta: 200, reason: 'REFERRAL' } },
          },
        });
      }
    }

    if (input.marketingOptIn) {
      await tx.newsletterSubscriber.upsert({
        where: { email: created.email },
        create: {
          email: created.email,
          name: created.name,
          source: 'CHECKOUT',
          confirmedAt: new Date(),
          unsubscribeToken: randomToken(24),
        },
        update: { isActive: true, unsubscribedAt: null },
      });
    }

    await enqueue(
      'email.welcome',
      { userId: created.id, kind: 'WELCOME' },
      { priority: 8, idempotencyKey: `welcome:${created.id}` },
      tx,
    );

    return created;
  });

  logger.info('Account created', { userId: user.id });

  res.status(201).json({ ok: true, message: 'Check your email to continue.' });
});

/**
 * Email and password sign-in.
 *
 * Every failure gets the same 401 and the same message; see
 * authenticateWithPassword for why. On success the session cookie is set and
 * any guest basket is merged into the account.
 */
authRouter.post('/auth/login', async (req, res) => {
  const owner = cartOwner(req);

  const user = await authenticateWithPassword(req.body, {
    ipHash: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  if (!user) {
    throw new AppError('Those details do not match an account. Please check and try again.', {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  }

  await startSession(res, user);
  await mergeCartAfterSignIn(user.id, owner.token);

  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

authRouter.post('/auth/logout', (_req, res) => {
  endSession(res);
  logger.info('User signed out');
  res.json({ ok: true });
});

/** The live signed-in user, or null. */
authRouter.get('/auth/session', async (req, res) => {
  const user = await getCurrentUser(req);

  // A valid token for an account that has since been suspended or erased:
  // stop the browser presenting it.
  if (!user && req.auth) endSession(res);

  res.json({ user });
});

// ── Google ────────────────────────────────────────────────────────────────

function oauthStateCookieOptions(): CookieOptions {
  // Scoped to the OAuth routes, so it is not sent with every API request.
  return { httpOnly: true, sameSite: 'lax', secure: isProduction(), path: '/api/auth/google' };
}

/** Sends the browser back to the sign-in page with a code it knows how to explain. */
function redirectToLogin(res: Response, error: unknown): void {
  const code = error instanceof OAuthSignInError ? error.code : 'OAuthCallbackError';
  if (!(error instanceof OAuthSignInError)) {
    logger.error('Google sign-in failed unexpectedly', { error });
  }
  res.redirect(302, absoluteUrl(`/login?error=${code}`));
}

authRouter.get('/auth/google', async (req, res) => {
  const requested = typeof req.query.callbackUrl === 'string' ? req.query.callbackUrl : null;
  // Checked now and again on return: an absolute or protocol-relative
  // callbackUrl would turn sign-in into an open redirect.
  const callbackUrl = safeRedirectPath(requested, '/account');

  try {
    const { url, stateCookie } = await beginGoogleSignIn(callbackUrl);
    res.cookie(OAUTH_STATE_COOKIE, stateCookie, {
      ...oauthStateCookieOptions(),
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
    res.redirect(302, url);
  } catch (error) {
    redirectToLogin(res, error);
  }
});

authRouter.get('/auth/google/callback', async (req, res) => {
  const owner = cartOwner(req);

  try {
    const { user, callbackUrl } = await completeGoogleSignIn({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      stateCookie: req.cookies?.[OAUTH_STATE_COOKIE],
    });

    res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions());
    await startSession(res, user);
    await mergeCartAfterSignIn(user.id, owner.token);

    res.redirect(302, absoluteUrl(safeRedirectPath(callbackUrl, '/account')));
  } catch (error) {
    res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions());
    redirectToLogin(res, error);
  }
});
