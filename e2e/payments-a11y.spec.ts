import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TABLE_SELECTOR = "table[aria-label='On-chain payments']";

test.describe("Payments table accessibility", () => {
  // On-chain payment reads are Soroban simulations (N+1 RPC calls), so the
  // table can take a while to populate against a live deployment.
  test.setTimeout(90_000);

  /** Waits until the table has either data rows, the empty state, or an error. */
  async function waitForTableData(page: import("@playwright/test").Page) {
    const rows = page.locator(`${TABLE_SELECTOR} tbody tr[data-row-index]`);
    const emptyState = page.getByText(/No on-chain payments yet/);
    const errorState = page.getByText(/Failed to load on-chain payments/);

    await Promise.race([
      rows.first().waitFor({ state: "visible", timeout: 45_000 }),
      emptyState.waitFor({ state: "visible", timeout: 45_000 }),
      errorState.waitFor({ state: "visible", timeout: 45_000 }),
    ]).catch(() => {});
  }

  test("payments table passes an axe scan", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 15000 });

    await waitForTableData(page);

    const results = await new AxeBuilder({ page })
      .include(TABLE_SELECTOR)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("arrow keys navigate between payment rows", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible({ timeout: 15000 });

    await waitForTableData(page);

    const rows = page.locator(`${TABLE_SELECTOR} tbody tr[data-row-index]`);
    const rowCount = await rows.count();
    test.skip(rowCount < 2, "requires at least two on-chain payment rows");

    // The active row is the only one in the tab order.
    await expect(rows.first()).toHaveAttribute("tabindex", "0");

    await rows.first().focus();
    await expect(rows.first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toBeFocused();
    await expect(rows.first()).toHaveAttribute("tabindex", "0");
  });
});
