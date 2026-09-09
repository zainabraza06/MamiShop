/**
 * Vitest global setup.
 *
 * Provides the minimum environment the modules under test expect, so a unit
 * test never depends on whatever happens to be in a developer's .env.
 *
 * NODE_ENV is typed read-only by @types/node, so it is assigned through a
 * widened reference rather than suppressed with a ts-expect-error.
 */
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV = 'test';
env.AUTH_SECRET ??= 'test-secret-value-at-least-32-characters-long';
env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
env.LOG_LEVEL = 'error';
