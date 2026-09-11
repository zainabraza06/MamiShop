/**
 * Vitest global setup for the API.
 *
 * Provides the minimum environment the modules under test expect, so a test
 * never depends on whatever happens to be in a developer's .env.
 */
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV = 'test';
env.AUTH_SECRET ??= 'test-secret-value-at-least-32-characters-long';
env.APP_URL ??= 'http://localhost:3000';
env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
env.LOG_LEVEL = 'error';
