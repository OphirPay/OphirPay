import { test, expect } from "@playwright/test";

test.describe("Governance Page", () => {
  test("renders governance page with header", async ({ page }) => {
    await page.goto("/governance");
    // Sidebar brand is also an h1 — target the page heading inside <main>.
    // h1 renders after client-side hydration — allow time in production.
    await expect(page.locator("main h1")).toContainText("Governance", {
      timeout: 15000,
    });
  });

  test("shows New Proposal button", async ({ page }) => {
    await page.goto("/governance");
    const btn = page.locator("button").filter({ hasText: "New Proposal" });
    await expect(btn).toBeVisible({ timeout: 15000 });
  });

  test("opens create proposal modal", async ({ page }) => {
    await page.goto("/governance");
    await page.locator("button").filter({ hasText: "New Proposal" }).click();
    await expect(page.locator("text=Create Governance Proposal")).toBeVisible({
      timeout: 15000,
    });
  });

  test("create proposal form has required fields", async ({ page }) => {
    await page.goto("/governance");
    await page.locator("button").filter({ hasText: "New Proposal" }).click();
    await expect(page.locator("input[placeholder*='Upgrade']")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("textarea[placeholder*='upgrades']")).toBeVisible({
      timeout: 15000,
    });
  });
});
