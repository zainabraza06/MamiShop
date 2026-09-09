import { prisma } from '@/lib/db';
import { enqueue } from '@/server/jobs';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { jsonOk, withErrorHandling } from '@/server/api';
import { logger } from '@/lib/logger';

/**
 * Abandoned-cart recovery.
 *
 * Finds carts that captured an email at checkout, have not converted, and have
 * been idle for between 4 and 72 hours.
 *
 * The lower bound matters: emailing someone 20 minutes after they stepped away
 * reads as surveillance, not service. The upper bound stops us mailing a
 * three-week-old cart whose prices and stock have since moved.
 *
 * Enqueue is idempotent per cart, and the handler re-checks recoveryEmailSentAt
 * before sending, so a cart can never be mailed twice even if this runs twice.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);

  const now = Date.now();
  const idleSince = new Date(now - 4 * 60 * 60 * 1000);
  const notOlderThan = new Date(now - 72 * 60 * 60 * 1000);

  const carts = await prisma.cart.findMany({
    where: {
      email: { not: null },
      convertedOrderId: null,
      recoveryEmailSentAt: null,
      updatedAt: { lte: idleSince, gte: notOlderThan },
      items: { some: {} },
    },
    select: { id: true },
    take: 100,
  });

  for (const cart of carts) {
    await enqueue(
      'email.abandoned_cart',
      { cartId: cart.id },
      { priority: 2, idempotencyKey: `abandoned-cart:${cart.id}` },
    );
  }

  logger.info('Abandoned cart sweep complete', { queued: carts.length });

  return jsonOk({ ok: true, queued: carts.length });
});

export const GET = POST;
