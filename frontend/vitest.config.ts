import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Storefront unit tests.
 *
 * The logic the storefront renders — money, measurements, validation — lives
 * in @momishop/shared and is tested there, and everything server-side is tested
 * in the API. What remains here is UI plumbing, so this suite is small by
 * design; the storefront's behaviour is covered end to end by Playwright.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/utils.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
