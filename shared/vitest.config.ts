import { defineConfig } from 'vitest/config';

/**
 * Tests for the shared domain package.
 *
 * Everything in this package is pure — no database, no network, no framework —
 * so it is held to a higher coverage bar than code that needs I/O to exercise.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // A table of constants, not logic.
      exclude: ['src/regions.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
