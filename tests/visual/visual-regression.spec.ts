// SPDX-License-Identifier: MIT
//
// Visual regression tests for the critical OphirPay pages.
//
// Baselines are stored in `tests/visual/__screenshots__/` and are compared
// against the live render on every run. A committed change that alters a
// baseline beyond the configured pixel threshold fails the CI job and emits
// an artifact diff.
//
// To intentionally update baselines, run:
//   npm run test:visual:update
// and commit the regenerated `__screenshots__` files.

import { test, expect } from "@playwright/test";

// Desktop viewport used for all baselines (matches the app's primary layout).
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// Critical pages under visual coverage.
const PAGES = [
  { path: "/", name: "dashboard" },
  { path: "/send", name: "send" },
  { path: "/batches", name: "batches" },
  { path: "/contracts", name: "contracts" },
] as const;

// Small pixel threshold: allow up to 0.1% of pixels to differ (anti-aliasing,
// font rendering, hydration timing) before flagging a regression.
const MAX_DIFF_PIXEL_RATIO = 0.001;

for (const { path, name } of PAGES) {
  test.describe(`Visual regression: ${name}`, () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("light theme", async ({ page }) => {
      // Force light theme before first paint to avoid FOUC.
      await page.addInitScript(() => {
        localStorage.setItem("ophirpay-theme", "light");
      });
      await page.goto(path);
      // Wait for client-side hydration so the page heading / content renders.
      await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
      // Give dynamic content (skeletons, on-chain reads) time to settle.
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`${name}-light`, {
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        animations: "disabled",
      });
    });

    test("dark theme", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("ophirpay-theme", "dark");
      });
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`${name}-dark`, {
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        animations: "disabled",
      });
    });
  });
}
