import { Router } from 'express';
import { prisma } from '../lib/db';
import { kv } from '../lib/redis';

/**
 * Health check for uptime monitoring.
 *
 * Distinguishes two things deliberately:
 *   - the database is a HARD dependency; without it the store cannot take an
 *     order, so its failure returns 503 and should page someone.
 *   - Redis is a SOFT dependency; the API degrades to in-memory rate limiting
 *     and uncached queries, which is slower but correct, so its failure is
 *     reported as "degraded" with a 200. Paging at 3am for a cache is how
 *     on-call rotations get ignored.
 *
 * Deliberately unauthenticated but deliberately thin: it exposes liveness and
 * version, never counts, configuration or connection strings.
 */
export const healthRouter = Router();

interface Check {
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
  message?: string;
}

async function timed(probe: () => Promise<unknown>): Promise<Check> {
  const start = Date.now();
  try {
    await probe();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message.slice(0, 120) : 'unknown error',
    };
  }
}

healthRouter.get('/health', async (_req, res) => {
  const [database, cache] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(async () => {
      const key = 'health:probe';
      await kv().set(key, Date.now(), 30);
      await kv().get(key);
    }),
  ]);

  const healthy = database.status === 'ok';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? (cache.status === 'ok' ? 'ok' : 'degraded') : 'down',
    timestamp: new Date().toISOString(),
    version:
      (process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) ?? 'local',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    checks: {
      database,
      // Reported as degraded rather than down: the API still works without it.
      cache: cache.status === 'down' ? { ...cache, status: 'degraded' as const } : cache,
    },
  });
});
