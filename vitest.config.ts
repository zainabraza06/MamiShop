import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit test configuration.
 *
 * Coverage is scoped to the pure domain logic in `src/lib`, and that scoping is
 * the fix for a CI failure rather than a way around one. Coverage previously
 * also counted `src/server/**` — Prisma transactions, email, PDF rendering, the
 * job worker — which cannot run without a database and is exercised by the
 * Playwright suite instead. Measuring I/O code against a *unit* threshold held
 * the total at 25% no matter how thoroughly the domain logic was tested, so CI
 * failed on every run and the number stopped meaning anything.
 *
 * Excluded below are the modules that are infrastructure rather than logic:
 * the Prisma client singleton, the Redis/Upstash adapter, the boot-time env
 * loader and the stdout logger. Everything else in
 * `src/lib` must meet the thresholds.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        'src/lib/db.ts',
        'src/lib/redis.ts',
        'src/lib/env.ts',
        'src/lib/logger.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
