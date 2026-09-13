import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Background jobs via a transactional outbox.
 *
 * Why not an in-process queue: this app runs on serverless functions that are
 * frozen the moment a response is returned. A `setTimeout` or an in-memory
 * queue silently loses work. Why not Redis alone: enqueueing to Redis is not
 * part of the database transaction, so a crash between "order committed" and
 * "email queued" loses the confirmation email — or worse, a rolled-back order
 * still sends one.
 *
 * So jobs are rows, written inside the same transaction as the business
 * change, and drained by /api/cron/jobs. If the transaction rolls back, the
 * job disappears with it. Delivery is at-least-once, so every handler must be
 * idempotent.
 */

export type JobType =
  | 'email.order_confirmation'
  | 'email.order_shipped'
  | 'email.order_delivered'
  | 'email.order_cancelled'
  | 'email.refund_issued'
  | 'email.abandoned_cart'
  | 'email.welcome'
  | 'email.password_reset'
  | 'email.review_request'
  | 'email.return_update'
  | 'email.low_stock_alert'
  | 'email.custom_request_to_staff'
  | 'email.custom_request_to_customer'
  | 'sms.order_confirmed'
  | 'sms.order_shipped'
  | 'sms.order_delivered'
  | 'invoice.generate'
  | 'data_request.export'
  | 'data_request.delete'
  | 'search.reindex_product';

export interface EnqueueOptions {
  /** Higher runs first. Customer-facing mail outranks housekeeping. */
  priority?: number;
  /** Delay before the job becomes eligible to run. */
  delaySeconds?: number;
  maxAttempts?: number;
  /**
   * Collision key that makes enqueueing idempotent.
   *
   * A payment webhook may be delivered several times; giving the resulting job
   * a key of `order-confirmation:<orderId>` means the customer gets exactly
   * one email no matter how many duplicates arrive.
   */
  idempotencyKey?: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function enqueue(
  type: JobType,
  payload: Prisma.InputJsonValue,
  options: EnqueueOptions = {},
  db: Db = prisma,
): Promise<void> {
  const { priority = 0, delaySeconds = 0, maxAttempts = 5, idempotencyKey } = options;

  const data = {
    type,
    payload,
    priority,
    maxAttempts,
    runAfter: new Date(Date.now() + delaySeconds * 1000),
    idempotencyKey: idempotencyKey ?? null,
  };

  if (idempotencyKey) {
    // A duplicate key means the job is already queued or already ran. Both are
    // successes from the caller's point of view.
    const existing = await db.job.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return;
  }

  try {
    await db.job.create({ data });
  } catch (error) {
    // Two concurrent webhooks can both pass the check above and race to insert.
    // The unique constraint is the real guarantee; losing that race is fine.
    if (isUniqueViolation(error)) return;
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

/**
 * Exponential backoff with a ceiling: 1m, 2m, 4m, 8m, 16m.
 *
 * Slow enough to let a transient provider outage recover, capped so a job is
 * not deferred past the point of usefulness — a shipping SMS three hours late
 * is worse than no SMS.
 */
export function backoffSeconds(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 16 * 60);
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

/**
 * Atomically claims a batch of due jobs for one worker.
 *
 * `FOR UPDATE SKIP LOCKED` is the reason this is raw SQL: it lets several
 * concurrent cron invocations pull disjoint batches without blocking each
 * other, which a read-then-update in Prisma cannot express. Without it, two
 * overlapping runs would claim the same jobs and send duplicate emails.
 *
 * `lockedAt` older than the stale threshold is reclaimed, so a worker killed
 * mid-job (serverless timeout) does not strand its work forever.
 */
export async function claimJobs(batchSize = 10, workerId = 'cron'): Promise<ClaimedJob[]> {
  const staleBefore = new Date(Date.now() - 5 * 60_000);

  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE jobs
    SET status = 'PROCESSING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE "runAfter" <= NOW()
        AND (
          status = 'PENDING'
          OR (status = 'PROCESSING' AND "lockedAt" < ${staleBefore})
        )
      ORDER BY priority DESC, "runAfter" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, "maxAttempts";
  `;
}

export async function completeJob(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: 'COMPLETED', completedAt: new Date(), lastError: null, lockedAt: null },
  });
}

/**
 * Records a failure and either schedules a retry or moves the job to DEAD.
 *
 * A DEAD job is never retried automatically — it needs a human to look at it.
 * Silently dropping it would hide a systematic failure (an expired API key,
 * say) behind a queue that looks empty.
 */
export async function failJob(
  id: string,
  attempts: number,
  maxAttempts: number,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = attempts >= maxAttempts;

  await prisma.job.update({
    where: { id },
    data: {
      status: exhausted ? 'DEAD' : 'PENDING',
      lastError: message.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAfter: exhausted ? new Date() : new Date(Date.now() + backoffSeconds(attempts) * 1000),
    },
  });

  if (exhausted) {
    logger.error('Job exhausted its retries and was marked DEAD', { jobId: id, attempts, message });
  } else {
    logger.warn('Job failed and will retry', {
      jobId: id,
      attempts,
      retryInSeconds: backoffSeconds(attempts),
      message,
    });
  }
}

/** Queue depth for the admin ops panel and uptime checks. */
export async function queueStats(): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}
