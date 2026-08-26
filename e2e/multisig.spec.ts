import { test, expect } from "@playwright/test";

test.describe("Multisig Approvals Page", () => {
  test("renders multisig page with header", async ({ page }) => {
    await page.goto("/multisig");
    // Sidebar brand is also an h1 — target the page heading inside <main>.
    // h1 renders after client-side hydration — allow time in production.
    await expect(page.locator("main h1")).toContainText("Multisig", {
      timeout: 15000,
    });
  });

  test("shows Configure button", async ({ page }) => {
    await page.goto("/multisig");
    // The header also shows a "Configure Multisig" empty-state action button,
    // so target the dedicated header button by name to avoid a strict-mode clash.
    await expect(page.getByRole("button", { name: "⚙ Configure" })).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows Propose Payment button", async ({ page }) => {
    await page.goto("/multisig");
    const proposeBtn = page.locator("button").filter({ hasText: "Propose Payment" });
    await expect(proposeBtn).toBeVisible({ timeout: 15000 });
  });

  test("opens config modal when Configure is clicked", async ({ page }) => {
    await page.goto("/multisig");
    await page.getByRole("button", { name: "⚙ Configure" }).click();
    // "Configure Multisig" also appears on the empty-state action button, so
    // scope the assertion to the opened dialog.
    await expect(page.getByRole("dialog")).toContainText("Configure Multisig", {
      timeout: 15000,
    });
    // Unique label inside the config modal
    await expect(page.getByText("Threshold (N of M)")).toBeVisible({
      timeout: 15000,
    });
  });

  test("Propose Payment is disabled until multisig is configured", async ({ page }) => {
    await page.goto("/multisig");
    // By design, payments can only be proposed after multisig is configured
    // (N-of-M threshold) — without it the button is disabled.
    await expect(page.locator("button").filter({ hasText: "Propose Payment" })).toBeDisabled({
      timeout: 15000,
    });
  });
});
