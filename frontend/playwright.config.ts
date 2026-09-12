import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const apiURL = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'never' }], ['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  /**
   * The suite drives the real system: the API and the storefront in front of
   * it. Locally, servers already running (from `npm run dev`) are reused.
   */
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'npm run build -w @momishop/backend && npm run start -w @momishop/backend',
          cwd: '..',
          // Health answers 503 while the database is unreachable, so the suite
          // does not start against an API that cannot serve it.
          url: `${apiURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'npm run build && npm run start',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ],
});
