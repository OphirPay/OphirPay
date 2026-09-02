// SPDX-License-Identifier: MIT
//
// Playwright config for visual regression tests only.
// Run with: npm run test:visual  (compare against committed baselines)
// Update baselines with: npm run test:visual:update

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { open: "never", outputFolder: "playwright-visual-report" }],
    ["list"],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Store baselines next to the spec.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  projects: [
    {
      name: "visual-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // No webServer — visual tests run against a live deployment (same as E2E).
  // Set E2E_BASE_URL env var to override (default: localhost for local dev).
});
