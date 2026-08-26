// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

/**
 * Visual regression tests for critical pages (Issue #86)
 *
 * Acceptance Criteria:
 * - Capture baseline screenshots (light + dark) for Dashboard, Send, Batches, Contracts at desktop width
 * - CI job fails when a committed change alters a baseline beyond a small pixel threshold
 * - Documented workflow for updating baselines intentionally
 *
 * Strategy: Uses Playwright's built-in screenshot comparison with toMatchSnapshot().
 * Baselines are stored in e2e/visual/visual-regression.spec.ts-snapshots/ and committed to the repo.
 * To update baselines after intentional UI changes: npx playwright test --update-snapshots
 */

const CRITICAL_PAGES = [
  { name: "dashboard", path: "/" },
  { name: "send", path: "/send" },
  { name: "batches", path: "/batches" },
  { name: "contracts", path: "/contracts" },
] as const;

const VIEWPORT = { width: 1440, height: 900 };

test.describe("Visual regression — light mode", () => {
  test.use({ viewport: VIEWPORT });

  for (const page of CRITICAL_PAGES) {
    test(`${page.name} matches baseline (light)`, async ({ page: p }) => {
      await p.goto(page.path);
      await p.waitForLoadState("networkidle");
      // Ensure light mode is active
      await p.evaluate(() => {
        document.documentElement.classList.remove("dark");
        document.documentElement.setAttribute("data-theme", "light");
      });
      await p.waitForTimeout(500);
      
      const screenshot = await p.screenshot({ fullPage: true });
      expect(screenshot).toMatchSnapshot(`${page.name}-light.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

test.describe("Visual regression — dark mode", () => {
  test.use({ viewport: VIEWPORT });

  for (const page of CRITICAL_PAGES) {
    test(`${page.name} matches baseline (dark)`, async ({ page: p }) => {
      await p.goto(page.path);
      await p.waitForLoadState("networkidle");
      // Force dark mode
      await p.evaluate(() => {
        document.documentElement.classList.add("dark");
        document.documentElement.setAttribute("data-theme", "dark");
      });
      await p.waitForTimeout(500);
      
      const screenshot = await p.screenshot({ fullPage: true });
      expect(screenshot).toMatchSnapshot(`${page.name}-dark.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
