import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/db';
import { assertCronAuthorized } from '../lib/cron-auth';
import { logger } from '../lib/logger';
import { runJob } from '../services/job-handlers';
import { claimJobs, completeJob, enqueue, failJob } from '../services/jobs';

/**
 * Scheduled tasks. Both accept GET as well as POST, since some schedulers only
 * issue GET requests.
 */
export const cronRouter = Router();

const BATCH_SIZE = 10;

/**
 * Job queue worker.
 *
 * Claims a bounded batch, runs each job, and records the outcome. Jobs run
 * sequentially rather than in parallel: the batch is small, the work is
 * network-bound against rate-limited providers, and a serial loop keeps the
 * per-job error handling obvious.
 *
 * A failing job never aborts the batch — one bad email address must not stop
 * the other nine orders from being confirmed.
 */
async function processJobs(req: Request, res: Response): Promise<void> {
  assertCronAuthorized(req.get('authorization'));

  const workerId = `cron-${randomUUID().slice(0, 8)}`;
  const jobs = await claimJobs(BATCH_SIZE, workerId);

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runJob(job.type, job.payload);
      await completeJob(job.id);
      succeeded++;
    } catch (error) {
      await failJob(job.id, job.attempts, job.maxAttempts, error);
      failed++;
    }
  }

  if (jobs.length > 0) {
    logger.info('Job batch processed', { workerId, claimed: jobs.length, succeeded, failed });
  }

  res.json({ ok: true, claimed: jobs.length, succeeded, failed });
}

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
async function sweepAbandonedCarts(req: Request, res: Response): Promise<void> {
  assertCronAuthorized(req.get('authorization'));

  const now = Date.now();
  const carts = await prisma.cart.findMany({
    where: {
      email: { not: null },
      convertedOrderId: null,
      recoveryEmailSentAt: null,
      updatedAt: {
        lte: new Date(now - 4 * 60 * 60 * 1000),
        gte: new Date(now - 72 * 60 * 60 * 1000),
      },
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

  res.json({ ok: true, queued: carts.length });
}

cronRouter.route('/cron/jobs').get(processJobs).post(processJobs);
cronRouter.route('/cron/abandoned-carts').get(sweepAbandonedCarts).post(sweepAbandonedCarts);
