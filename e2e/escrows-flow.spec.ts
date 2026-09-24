// SPDX-License-Identifier: MIT
//
// End-to-end test for the on-chain escrow management lifecycle.
// Exercises listing escrows, state machine visual indicators, creation modal,
// and detail view inspection.

import { test, expect } from "@playwright/test";

const MOCK_BENEFICIARY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const MOCK_DEPOSITOR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MOCK_ARBITER = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

test.describe("Escrow Management Flow", () => {
  test("renders escrows page with header, metrics, and filter controls", async ({ page }) => {
    await page.goto("/escrows");

    await expect(page.locator("main h1")).toContainText("Escrow Management", {
      timeout: 15000,
    });
    await expect(page.locator("text=Total Escrows")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Active Locked")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Locked Value")).toBeVisible({ timeout: 15000 });
  });

  test("shows Create Escrow button and opens creation dialog with controls", async ({ page }) => {
    await page.goto("/escrows");

    const createBtn = page.locator("button").filter({ hasText: "Create Escrow" }).first();
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click();

    await expect(page.locator("text=Create Secure Escrow")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("input[placeholder*='G...']").first()).toBeVisible();
    await expect(page.locator("input[placeholder*='1000']")).toBeVisible();
    await expect(page.locator("text=Release Deadline")).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "1 Day" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "3 Days" })).toBeVisible();
  });

  test("escrow detail view displays state machine, stats, and contract parameters", async ({ page }) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const mockEscrow = {
      id: 1,
      depositor: MOCK_DEPOSITOR,
      beneficiary: MOCK_BENEFICIARY,
      arbiter: MOCK_ARBITER,
      amount: "2500000000", // 250 XLM
      asset: "native",
      deadline: nowSeconds + 7200, // 2 hrs future
      released: false,
      claimed: false,
      metadata: "Milestone Deliverables Inspection Escrow",
    };

    // Route intercept for single escrow
    await page.route("**/api/escrows/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: mockEscrow,
        }),
      });
    });

    await page.goto("/escrows/1");

    await expect(page.locator("h1")).toContainText("Escrow #1", { timeout: 15000 });
    await expect(page.locator("text=Milestone Deliverables Inspection Escrow")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("text=Escrow State Machine")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=1. Funds Locked")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=2. Release Condition")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=3. Settled")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=250.00 XLM")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=On-Chain Escrow Specification")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("text=Depositor (Owner)")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Beneficiary")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Dispute Arbiter")).toBeVisible({ timeout: 15000 });
  });
});
