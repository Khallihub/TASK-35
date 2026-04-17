import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for HarborStone E2E coverage (PRD §Phase-4 exit).
 *
 * Tests live under apps/web/e2e/ and run against the docker-compose stack
 * brought up by run_tests.sh. BASE_URL defaults to the in-network web
 * service hostname; locally it can be overridden to point at `http://localhost`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
