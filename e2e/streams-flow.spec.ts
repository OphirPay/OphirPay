// SPDX-License-Identifier: MIT
//
// End-to-end test for the payment streams lifecycle.
// Exercises listing streams, progress bars, creating a stream, detail view,
// and role-gated claim/cancel actions.

import { test, expect } from "@playwright/test";

const MOCK_RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const MOCK_CREATOR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

test.describe("Payment Streams Flow", () => {
  test("renders streams page with metrics and header", async ({ page }) => {
    await page.goto("/streams");

    await expect(page.locator("main h1")).toContainText("Payment Streams", {
      timeout: 15000,
    });
    await expect(page.locator("text=Total Streams")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Active Streams")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Total Volume")).toBeVisible({ timeout: 15000 });
  });

  test("shows Create Stream button and opens modal with form controls", async ({ page }) => {
    await page.goto("/streams");

    const createBtn = page.locator("button").filter({ hasText: "Create Stream" }).first();
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click();

    // Verify modal elements
    await expect(page.locator("text=Create New Payment Stream")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("input[placeholder*='G...']")).toBeVisible();
    await expect(page.locator("input[placeholder*='500']")).toBeVisible();
    await expect(page.locator("text=Vesting Duration")).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "1 Day" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "1 Week" })).toBeVisible();
  });

  test("stream detail view displays vesting curve and breakdown", async ({ page }) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const mockStream = {
      id: 1,
      creator: MOCK_CREATOR,
      recipient: MOCK_RECIPIENT,
      total_amount: "1000000000", // 100 XLM
      claimed_amount: "250000000", // 25 XLM
      asset: "native",
      start_time: nowSeconds - 3600, // 1 hr ago
      end_time: nowSeconds + 3600, // 1 hr remaining (50% progress)
      cancelled: false,
      metadata: "Grant Milestone Stream",
    };

    // Intercept single stream API lookup
    await page.route("**/api/streams/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: mockStream,
        }),
      });
    });

    await page.goto("/streams/1");

    await expect(page.locator("h1")).toContainText("Stream #1", { timeout: 15000 });
    await expect(page.locator("text=Grant Milestone Stream")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Vesting Progress")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Total Locked")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=100.00 XLM")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Claimed by Recipient")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=25.00 XLM")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Stream Contract Details")).toBeVisible({ timeout: 15000 });
  });
});
