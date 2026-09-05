/**
 * Vitest global setup.
 *
 * Provides the minimum environment the modules under test expect, so a unit
 * test never depends on a developer's local .env.
 */
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET ??= 'test-secret-value-at-least-32-characters-long';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.LOG_LEVEL = 'error';
