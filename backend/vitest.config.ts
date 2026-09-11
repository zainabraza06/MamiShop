import { defineConfig } from 'vitest/config';

/**
 * API tests.
 *
 * Unit tests cover the infrastructure modules; HTTP tests drive the Express app
 * through supertest with the database mocked, so they run in CI without
 * Postgres. Full flows against a real database are covered by the Playwright
 * suite.
 *
 * Coverage is measured on the code these tests can reach without I/O. The
 * Prisma client, the Redis adapter, the env loader and the logger are
 * infrastructure rather than logic and are excluded, as in the storefront.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts', 'src/http/**/*.ts', 'src/auth/**/*.ts'],
      exclude: [
        'src/lib/db.ts',
        'src/lib/redis.ts',
        'src/lib/env.ts',
        'src/lib/logger.ts',
        // OAuth talks to Google and the database end to end; it has no pure
        // core worth unit testing apart from what the HTTP tests exercise.
        'src/auth/google.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
