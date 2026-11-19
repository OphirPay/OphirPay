// SPDX-License-Identifier: MIT
//
// Visual regression for the mobile payment-confirmation modal (issue #1400).
//
// The batch payment flow's confirmation dialog surfaces the recipient address
// and the "Confirm & Sign" action — exactly the elements that clip or overflow
// a narrow screen when Tailwind/modal styling shifts. Functional E2E tests pass
// through such a regression because the elements are still *present*; only a
// screenshot catches the layout.
//
// The dialog is driven under the four `visual-mobile*` projects defined in
// `playwright.visual.config.ts` (iPhone SE 375×667 and Galaxy S21 / iPhone 11
// Pro Max 414×896, each in light and dark), and the desktop projects exclude
// this spec. Baselines live in `tests/visual/__screenshots__/`, namespaced by
// project, and are regenerated with `npm run test:visual:update`.
//
// A wallet connection is required for the form (and therefore the dialog) to
// render, so the spec injects the same fake Freighter the E2E suite uses and
// stubs the auth session. External Stellar origins are aborted so the capture
// is deterministic and offline.

import { test, expect, type Page } from "@playwright/test";
import {
  fakeFreighterInitScript,
  randomAddress,
} from "../../e2e/helpers/stellar-mock";

// localStorage key the ThemeProvider persists the preference under
// (src/lib/storage-keys.ts → STORAGE_KEYS.THEME).
const THEME_STORAGE_KEY = "ophirpay-theme";

// The issue's threshold: fail when more than 0.5% of pixels differ.
const MAX_DIFF_PIXEL_RATIO = 0.005;

// Any text/border change must not introduce a horizontal scroll on mobile.
const OVERFLOW_TOLERANCE_PX = 1;

/** Derive the colour scheme from the Playwright project name. */
function schemeFor(projectName: string): "light" | "dark" {
  return projectName.endsWith("dark") ? "dark" : "light";
}

/** Pin the persisted theme before first paint so the render is deterministic. */
async function pinTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: scheme }
  );
}

/** Inject a connected fake wallet and stub the auth + contract boundaries. */
async function installWallet(page: Page): Promise<string> {
  const address = randomAddress();
  await page.addInitScript(fakeFreighterInitScript(address));

  // The wallet hook opens a session after connect; accept any proof.
  await page.route("**/api/auth/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { authenticated: true } }),
    })
  );

  // Keep the run offline/deterministic — the dialog itself needs no chain data.
  await page.route(
    (url) => url.hostname.includes("stellar.org"),
    (route) => route.abort()
  );

  return address;
}

/** Wait for hydration and any skeleton content to settle. */
async function settle(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

/** Fill one recipient and open the confirmation dialog. */
async function openConfirmationDialog(page: Page): Promise<void> {
  const addressInput = page.locator('input[placeholder*="G... destination address"]').first();
  await expect(addressInput).toBeVisible({ timeout: 10000 });
  await addressInput.fill(randomAddress());

  const amountInput = page.locator('input[placeholder="0.00"]').first();
  await amountInput.fill("10");

  await page.getByText("Send Batch Payment").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5000 });
  // Let the open animation finish before capturing.
  await page.waitForTimeout(350);
}

test.describe("Visual regression: mobile payment confirmation dialog", () => {
  test("renders the confirmation dialog without clipping or overflow", async ({
    page,
  }, testInfo) => {
    const scheme = schemeFor(testInfo.project.name);
    const viewport = page.viewportSize();
    expect(viewport, "the visual-mobile* projects must set a mobile viewport").not.toBeNull();

    await pinTheme(page, scheme);
    await installWallet(page);
    await page.goto("/batches/new");
    await settle(page);

    // A capture of the wrong theme must never be committed as a baseline.
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

    await openConfirmationDialog(page);

    const dialog = page.getByRole("dialog");

    // ── Layout invariants (baseline-independent, always enforced) ──────────
    // The dialog must fit the viewport horizontally …
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE_PX);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      viewport!.width + OVERFLOW_TOLERANCE_PX
    );

    // … the page must not scroll sideways …
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(
      overflow.clientWidth + OVERFLOW_TOLERANCE_PX
    );

    // … and both actions must stay comfortably tappable.
    for (const button of [
      dialog.getByTestId("batch-confirm-send"),
      dialog.getByRole("button", { name: "Back", exact: true }),
    ]) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
        viewport!.width + OVERFLOW_TOLERANCE_PX
      );
    }

    // ── Pixel comparison (<0.5% of pixels may differ) ─────────────────────
    await expect(dialog).toHaveScreenshot(`payment-confirm-modal-${scheme}`, {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: "disabled",
    });
  });
});
