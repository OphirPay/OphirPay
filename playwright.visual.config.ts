// SPDX-License-Identifier: MIT
//
// Playwright config for visual regression tests only.
//
//   Compare against committed baselines:  npm run test:visual
//   Regenerate every baseline (light + dark):  npm run test:visual:update
//
// Every page is captured once per colour-scheme project below, so a single
// `--update-snapshots` run regenerates BOTH the light and the dark baselines.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testMatch: ["tests/visual/**/*.spec.ts", "e2e/visual-*.spec.ts"],
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
  // Store baselines next to the spec, namespaced by project so light and dark
  // captures can never collide (the project name is part of the path).
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}",
  //
  // Colour-scheme and mobile viewport projects (issues #715, #1400).
  // `colorScheme` drives `prefers-color-scheme`, and mobile viewports
  // capture responsive modals on iPhone SE (375x667) and Galaxy (414x896).
  //
  projects: [
    {
      name: "visual-light",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "visual-dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    {
      name: "visual-mobile-se-light",
      use: {
        viewport: { width: 375, height: 667 },
        colorScheme: "light",
      },
    },
    {
      name: "visual-mobile-se-dark",
      use: {
        viewport: { width: 375, height: 667 },
        colorScheme: "dark",
      },
    },
    {
      name: "visual-mobile-galaxy-light",
      use: {
        viewport: { width: 414, height: 896 },
        colorScheme: "light",
      },
    },
    {
      name: "visual-mobile-galaxy-dark",
      use: {
        viewport: { width: 414, height: 896 },
        colorScheme: "dark",
      },
    },
  ],
  // No webServer — visual tests run against a live deployment (same as E2E).
  // Set E2E_BASE_URL env var to override (default: localhost for local dev).
});
