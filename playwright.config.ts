/**
 * Playwright configuration for the `integration/staging` branch.
 *
 * NOTE:
 * - This configuration **does not** start a web server. The E2E test suite
 *   expects a server to be already listening at the URL defined by the
 *   `E2E_BASE_URL` environment variable (or `http://localhost:3000` by default).
 *   Run `npm run dev` (or the appropriate production server) before executing
 *   `npm run test:e2e`.
 *
 * - The original configuration referenced a "blob" reporter that was used
 *   when the CI pipeline sharded the test suite across parallel runners and
 *   later merged the generated blobs in an `e2e-report` job.
 *   The shard jobs were removed in commit `2b2173d`, and the `e2e-report`
 *   workflow no longer exists. Consequently the blob reporter is now dead
 *   code and has been removed.
 *
 * - The current reporters generate a human‑readable HTML report and a concise
 *   list output, which work for both local development and the existing CI
 *   workflow.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Do not start a web server; the test runner expects the app to be up already.
  // If you need to run the server automatically, consider adding a `webServer`
  // block here, but it is intentionally omitted for the CI environment.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // Use the base URL from the environment or fallback to localhost.
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  // Projects for different browsers / devices.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Reporters: HTML for visual inspection and List for concise CI output.
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
  ],
});
