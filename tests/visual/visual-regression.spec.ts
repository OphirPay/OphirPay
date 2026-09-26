// SPDX-License-Identifier: MIT
//
// Visual regression tests for the critical OphirPay pages.
//
// Every page is captured once per colour-scheme project defined in
// `playwright.visual.config.ts` (`visual-light`, `visual-dark`), so the dark
// baselines are generated and compared by exactly the same code path as the
// light ones.
//
// Baselines live in `tests/visual/__screenshots__/`, namespaced by project,
// and are compared against the live render on every run. A committed change
// that alters a baseline beyond the configured pixel threshold fails the run
// and emits a diff artifact.
//
// To intentionally update baselines (this regenerates BOTH light and dark):
//   npm run test:visual:update
// then review and commit the regenerated `__screenshots__` files.
//
// Note: the deterministic "a hardcoded colour fails CI" guard lives in
// `src/__tests__/dark-mode-color-guard.test.ts`, because this suite runs
// against a live deployment (E2E_BASE_URL) and is not part of the trimmed CI.

import { test, expect, type Page } from "@playwright/test";

// Desktop viewport used for all baselines (matches the app's primary layout).
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// localStorage key the ThemeProvider persists the preference under
// (see src/lib/storage-keys.ts → STORAGE_KEYS.THEME).
const THEME_STORAGE_KEY = "ophirpay-theme";

// A stable payment id for the detail baseline. Override with VISUAL_PAYMENT_ID
// when running against a deployment that does not have payment id `1`.
const PAYMENT_ID = process.env.VISUAL_PAYMENT_ID || "1";

// Critical pages under visual coverage. The four pages required to have dark
// baselines (dashboard, payments list, payments detail, audit log) come first;
// the remaining pages keep their existing coverage.
//
// The colour-sensitive components called out in issue #715 are captured through
// their host pages: status badges on the dashboard and payments list, the
// payment timeline on the detail page, and the AnalyticsDashboard charts on
// /analytics. Toasts are transient, so they are covered by the static colour
// guard instead of a screenshot.
const PAGES = [
  { path: "/", name: "dashboard" },
  { path: "/payments", name: "payments-list" },
  { path: `/payments/${PAYMENT_ID}`, name: "payments-detail" },
  { path: "/audit-log", name: "audit-log" },
  { path: "/analytics", name: "analytics" },
  { path: "/send", name: "send" },
  { path: "/batches", name: "batches" },
  { path: "/batches/new", name: "batches-new" },
  { path: "/contracts", name: "contracts" },
  { path: "/address-book", name: "address-book" },
  { path: "/events", name: "events" },
  { path: "/fee-config", name: "fee-config" },
  { path: "/governance", name: "governance" },
  { path: "/hooks", name: "hooks" },
  { path: "/keys", name: "keys" },
  { path: "/multisig", name: "multisig" },
  { path: "/pause-controls", name: "pause-controls" },
  { path: "/policy-versions", name: "policy-versions" },
  { path: "/rbac", name: "rbac" },
  { path: "/receive", name: "receive" },
  { path: "/recurring", name: "recurring" },
  { path: "/refunds", name: "refunds" },
  { path: "/requests", name: "requests" },
  { path: "/timelock", name: "timelock" },
  { path: "/webhooks", name: "webhooks" },
] as const;

// Small pixel threshold: allow up to 0.1% of pixels to differ (anti-aliasing,
// font rendering, hydration timing) before flagging a regression.
const MAX_DIFF_PIXEL_RATIO = 0.001;

/** Derive the colour scheme from the Playwright project name. */
function schemeFor(projectName: string): "light" | "dark" {
  return projectName.endsWith("dark") ? "dark" : "light";
}

/**
 * Pin the persisted theme before first paint so the render is deterministic and
 * does not depend on the host's system preference. The project's `colorScheme`
 * still drives `prefers-color-scheme`, so the "system" path is exercised too.
 */
async function pinTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: scheme }
  );
}

/** Wait for hydration and for dynamic content (skeletons/on-chain reads). */
async function settle(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
}

for (const { path, name } of PAGES) {
  test.describe(`Visual regression: ${name}`, () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("matches the committed baseline", async ({ page }, testInfo) => {
      const scheme = schemeFor(testInfo.project.name);

      await pinTheme(page, scheme);
      await page.goto(path);
      await settle(page);

      // A screenshot of the wrong theme must never be committed as a dark
      // baseline, so assert the app actually switched before capturing.
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

      await expect(page).toHaveScreenshot(`${name}-${scheme}`, {
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        animations: "disabled",
      });
    });
  });
}
