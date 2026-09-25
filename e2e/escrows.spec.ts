import { test, expect } from "@playwright/test";

test.describe("Escrows (issue #798)", () => {
  test("escrows list renders with heading and sidebar link", async ({ page }) => {
    await page.goto("/escrows");
    await expect(page.locator("main h1")).toContainText("Escrows", { timeout: 15000 });
    await expect(page.locator("a[href='/escrows']").first()).toBeVisible();
  });

  test("create modal opens from the list", async ({ page }) => {
    await page.goto("/escrows");
    await expect(page.locator("main h1")).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "+ New Escrow" }).click();
    await expect(page.getByText("Lock XLM for a beneficiary")).toBeVisible();
  });

  test("detail route renders for an id", async ({ page }) => {
    await page.goto("/escrows/1");
    await expect(page.locator("main h1")).toBeVisible({ timeout: 15000 });
  });
});
