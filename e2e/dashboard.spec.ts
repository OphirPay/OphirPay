import { test, expect } from "@playwright/test";

test.describe("OphirPay Dashboard", () => {
  test("loads dashboard page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OphirPay/i);
    // Sidebar brand is also an h1 — target the page heading inside <main>.
    // h1 renders after client-side hydration — allow time in production.
    await expect(page.locator("main h1")).toBeVisible({ timeout: 15000 });
  });

  test("sidebar navigation is visible", async ({ page }) => {
    await page.goto("/");
    // Desktop sidebar should be visible on wide viewports
    await expect(page.locator("aside").first()).toBeVisible();
  });

  test("navigates to Payments via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.locator("a[href='/payments']").first().click();
    await expect(page).toHaveURL(/\/payments/);
  });

  test("navigates to Send page", async ({ page }) => {
    await page.goto("/");
    await page.locator("a[href='/send']").first().click();
    await expect(page).toHaveURL(/\/send/);
  });
});

test.describe("Navigation smoke test", () => {
  const pages = [
    "/",
    "/send",
    "/payments",
    "/batches",
    "/contracts",
    "/events",
    "/analytics",
    "/webhooks",
    "/requests",
    "/recurring",
    "/multisig",
    "/governance",
    "/audit-log",
  ];    for (const path of pages) {
    test(`${path} returns 200 and renders content`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      // Every page renders its content inside <main>; wallet-gated pages
      // (send, contracts) show a connect prompt instead of a page heading,
      // so assert the rendered main container rather than an h1.
      await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
    });
  }
});
