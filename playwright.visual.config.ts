// SPDX-License-Identifier: MIT
//
// Playwright config for visual regression tests only.
//
//   Compare against committed baselines:  npm run test:visual
//   Regenerate every baseline (light + dark):  npm run test:visual:update
//
// Every page is captured once per colour-scheme project below, so a single
// `--update-snapshots` run regenerates BOTH the light and the dark baselines.
//
// Mobile dialog coverage (issue #1400) is a separate spec
// (`tests/visual/visual-payment-modal.spec.ts`) driven by the four
// `visual-mobile*` projects at the two viewports the issue calls out
// (iPhone SE 375×667, Galaxy S21 / iPhone 11 Pro Max 414×896). The desktop
// projects exclude that spec so each capture runs under exactly one project.
// Regenerate its baselines the same way: `npm run test:visual:update`.

import { defineConfig, devices } from "@playwright/test";

// Mobile viewports for the payment-confirmation dialog (issue #1400).
const MOBILE_SMALL = { width: 375, height: 667 } as const; // iPhone SE
const MOBILE_WIDE = { width: 414, height: 896 } as const; // Galaxy S21 / iPhone 11 Pro Max

// The mobile-only spec: matched by the `visual-mobile*` projects and ignored by
// the desktop ones, so it is never captured twice.
const MOBILE_SPEC = /visual-payment-modal\.spec\.ts/;

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
  // Store baselines next to the spec, namespaced by project so light and dark
  // captures can never collide (the project name is part of the path).
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}",
  //
  // Two colour-scheme projects (issue #715). `colorScheme` drives
  // `prefers-color-scheme`, so the app's ThemeProvider resolves dark mode even
  // before any persisted preference is read; the spec additionally pins the
  // persisted theme per project so the render is deterministic.
  //
  projects: [
    {
      name: "visual-light",
      testIgnore: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "visual-dark",
      testIgnore: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    // ── Mobile payment-confirmation dialog (issue #1400) ──────────────────
    {
      name: "visual-mobile-light",
      testMatch: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "light", viewport: MOBILE_SMALL },
    },
    {
      name: "visual-mobile-dark",
      testMatch: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark", viewport: MOBILE_SMALL },
    },
    {
      name: "visual-mobile-wide-light",
      testMatch: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "light", viewport: MOBILE_WIDE },
    },
    {
      name: "visual-mobile-wide-dark",
      testMatch: MOBILE_SPEC,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark", viewport: MOBILE_WIDE },
    },
  ],
  // No webServer — visual tests run against a live deployment (same as E2E).
  // Set E2E_BASE_URL env var to override (default: localhost for local dev).
});
