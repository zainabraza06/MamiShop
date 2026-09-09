import { prisma } from '@/lib/db';
import { registerSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/password';
import { randomCode, randomToken, hashIp } from '@/lib/crypto';
import { jsonOk, parseJsonBody, rateLimit, withErrorHandling } from '@/server/api';
import { clientIp } from '@/lib/rate-limit';
import { enqueue } from '@/server/jobs';
import { logger } from '@/lib/logger';

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
export const POST = withErrorHandling(async (request) => {
  await rateLimit(request, 'authRegister');

  const input = await parseJsonBody(request, registerSchema);
  const ipHash = hashIp(clientIp(request.headers));

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true },
  });

  if (existing) {
    logger.info('Registration attempted for an existing email', { ipHash });

    await enqueue(
      'email.welcome',
      { userId: existing.id, kind: 'DUPLICATE_REGISTRATION' },
      {
        priority: 5,
        // One notice per account per day, no matter how many attempts.
        idempotencyKey: `dup-register:${existing.id}:${new Date().toISOString().slice(0, 10)}`,
      },
    );

    return jsonOk({ ok: true, message: 'Check your email to continue.' }, { status: 201 });
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

  return jsonOk({ ok: true, message: 'Check your email to continue.' }, { status: 201 });
});
