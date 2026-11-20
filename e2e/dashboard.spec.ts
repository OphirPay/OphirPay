import { expect, type Page,test } from "@playwright/test";

/** Below Tailwind's `lg` breakpoint the sidebar is an on-demand drawer. */
const DESKTOP_SIDEBAR_MIN_WIDTH = 1024;

/**
 * Click a primary-navigation link on any viewport: the static sidebar on
 * desktop, the slide-out drawer (opened via "Toggle menu") on phones/tablets.
 */
async function clickNavLink(page: Page, href: string): Promise<void> {
  const isDesktop =
    (page.viewportSize()?.width ?? DESKTOP_SIDEBAR_MIN_WIDTH) >=
    DESKTOP_SIDEBAR_MIN_WIDTH;
  if (isDesktop) {
    await page.locator(`aside a[href='${href}']`).first().click();
    return;
  }
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page.locator(`#mobile-navigation a[href='${href}']`).click();
}

test.describe("OphirPay Dashboard", () => {
  test("loads dashboard page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OphirPay/i);
    // Sidebar brand is also an h1 — target the page heading inside <main>.
    // h1 renders after client-side hydration — allow time in production.
    await expect(page.locator("main h1")).toBeVisible({ timeout: 15000 });
  });

  test("sidebar navigation is visible", async ({ page }) => {
    const width = page.viewportSize()?.width ?? DESKTOP_SIDEBAR_MIN_WIDTH;
    test.skip(
      width < DESKTOP_SIDEBAR_MIN_WIDTH,
      "The sidebar is a drawer below the lg breakpoint"
    );
    await page.goto("/");
    // Desktop sidebar should be visible on wide viewports
    await expect(page.locator("aside").first()).toBeVisible();
  });

  test("opens the navigation drawer on small viewports", async ({ page }) => {
    const width = page.viewportSize()?.width ?? DESKTOP_SIDEBAR_MIN_WIDTH;
    test.skip(width >= DESKTOP_SIDEBAR_MIN_WIDTH, "Desktop uses the static sidebar");
    await page.goto("/");
    await page.getByRole("button", { name: "Toggle menu" }).click();
    await expect(page.locator("#mobile-navigation")).toBeVisible();
  });

  test("navigates to Payments via sidebar", async ({ page }) => {
    await page.goto("/");
    await clickNavLink(page, "/payments");
    await expect(page).toHaveURL(/\/payments/);
  });

  test("navigates to Send page", async ({ page }) => {
    await page.goto("/");
    await clickNavLink(page, "/send");
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
