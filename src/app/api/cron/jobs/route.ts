import { claimJobs, completeJob, failJob } from '@/server/jobs';
import { runJob } from '@/server/job-handlers';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { jsonOk, withErrorHandling } from '@/server/api';
import { logger } from '@/lib/logger';

/**
 * Job queue worker.
 *
 * Invoked on a schedule by Vercel Cron (see vercel.json). Claims a bounded
 * batch, runs each job, and records the outcome. Jobs are processed
 * sequentially rather than in parallel: the batch is small, the work is
 * network-bound against rate-limited providers, and a serial loop makes the
 * per-job error handling obvious.
 *
 * A failing job never aborts the batch — one bad email address must not stop
 * the other nine orders from being confirmed.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 10;

export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);

  const workerId = `cron-${crypto.randomUUID().slice(0, 8)}`;
  const jobs = await claimJobs(BATCH_SIZE, workerId);

  if (jobs.length === 0) {
    return jsonOk({ ok: true, claimed: 0, succeeded: 0, failed: 0 });
  }

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

  logger.info('Job batch processed', { workerId, claimed: jobs.length, succeeded, failed });

  return jsonOk({ ok: true, claimed: jobs.length, succeeded, failed });
});

/** GET is accepted too, since some schedulers only issue GET requests. */
export const GET = POST;
