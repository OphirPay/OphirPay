// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

test.describe("Recurring Payments E2E Workflow", () => {
  test("renders recurring page with header and create action", async ({ page }) => {
    await page.goto("/recurring");
    await expect(page.locator("main h1")).toContainText("Recurring Payments", {
      timeout: 15000,
    });
    await expect(page.getByTestId("create-recurring-btn")).toBeVisible({
      timeout: 15000,
    });
  });

  test("opens create modal and calculates next-run preview dynamically", async ({ page }) => {
    await page.goto("/recurring");

    // Open modal
    await page.getByTestId("create-recurring-btn").click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Create Recurring Payment" })).toBeVisible();

    // Verify all form fields exist
    await expect(page.getByTestId("recipient-input")).toBeVisible();
    await expect(page.getByTestId("amount-input")).toBeVisible();
    await expect(page.getByTestId("schedule-select")).toBeVisible();
    await expect(page.getByTestId("remaining-input")).toBeVisible();

    // Verify next-run preview exists with Daily cadence default
    const preview = page.getByTestId("next-run-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Every 24 hours (Daily)");

    // Switch to Weekly and assert preview updates
    await page.getByTestId("schedule-select").selectOption("Weekly");
    await expect(preview).toContainText("Every 7 days (Weekly)");

    // Switch to Monthly and assert preview updates
    await page.getByTestId("schedule-select").selectOption("Monthly");
    await expect(preview).toContainText("Every 30 days (Monthly)");

    // Fill in amount and payment count to verify total volume preview
    await page.getByTestId("amount-input").fill("50.00");
    await page.getByTestId("remaining-input").fill("6");
    await expect(preview).toContainText("Total Volume: 300.00 XLM");
    await expect(preview).toContainText("6 scheduled runs");
  });

  test("creates a recurring schedule and verifies card details", async ({ page }) => {
    await page.goto("/recurring");

    await page.getByTestId("create-recurring-btn").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByTestId("recipient-input").fill("GBZX4364PEPQTDICMIQDZ56K4T75QGKCRFHSVJFVODVFBRR6XOQNFB2C");
    await page.getByTestId("amount-input").fill("150.00");
    await page.getByTestId("schedule-select").selectOption("Weekly");
    await page.getByTestId("remaining-input").fill("4");

    await page.getByTestId("submit-create-btn").click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    // Assert card is rendered in the list
    const card = page.getByTestId("recurring-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("recurring-status-badge")).toContainText("Active");
    await expect(card.getByTestId("recurring-amount-display")).toContainText("150.00 XLM");
    await expect(card.getByTestId("execution-count")).toContainText("Executed: 0×");
    await expect(card.getByTestId("remaining-count")).toContainText("4 left");
    await expect(card.getByTestId("pause-recurring-btn")).toBeVisible();
    await expect(card.getByTestId("simulate-execution-btn")).toBeVisible();
    await expect(card.getByTestId("cancel-recurring-btn")).toBeVisible();
  });

  test("covers pause and resume lifecycle for recurring schedule", async ({ page }) => {
    await page.goto("/recurring");

    // Create a schedule
    await page.getByTestId("create-recurring-btn").click();
    await page.getByTestId("recipient-input").fill("GABC12345678901234567890");
    await page.getByTestId("amount-input").fill("80.00");
    await page.getByTestId("submit-create-btn").click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    const card = page.getByTestId("recurring-card").first();
    await expect(card.getByTestId("recurring-status-badge")).toContainText("Active");

    // Click Pause
    await card.getByTestId("pause-recurring-btn").click();
    await expect(card.getByTestId("recurring-status-badge")).toContainText("Paused");
    await expect(card.getByTestId("pause-recurring-btn")).not.toBeVisible();
    await expect(card.getByTestId("resume-recurring-btn")).toBeVisible();

    // Click Resume
    await card.getByTestId("resume-recurring-btn").click();
    await expect(card.getByTestId("recurring-status-badge")).toContainText("Active");
    await expect(card.getByTestId("resume-recurring-btn")).not.toBeVisible();
    await expect(card.getByTestId("pause-recurring-btn")).toBeVisible();
  });

  test("simulates execution and reflects execution history in UI", async ({ page }) => {
    await page.goto("/recurring");

    // Create schedule with 3 payments
    await page.getByTestId("create-recurring-btn").click();
    await page.getByTestId("recipient-input").fill("GEXEC98765432109876543210");
    await page.getByTestId("amount-input").fill("60.00");
    await page.getByTestId("remaining-input").fill("3");
    await page.getByTestId("submit-create-btn").click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    const card = page.getByTestId("recurring-card").first();
    await expect(card.getByTestId("execution-count")).toContainText("Executed: 0×");

    // Open history drawer
    await card.getByTestId("toggle-history-btn").click();
    const historySection = card.getByTestId("execution-history");
    await expect(historySection).toBeVisible();
    await expect(card.getByTestId("empty-history")).toBeVisible();

    // Simulate first execution
    await card.getByTestId("simulate-execution-btn").click();
    await expect(card.getByTestId("execution-count")).toContainText("Executed: 1×");
    await expect(card.getByTestId("remaining-count")).toContainText("2 left");

    // History now has 1 execution record
    const records = historySection.getByTestId("execution-record");
    await expect(records).toHaveCount(1);
    await expect(records.first()).toContainText("60.00 XLM");
    await expect(records.first()).toContainText("Success");

    // Simulate second execution
    await card.getByTestId("simulate-execution-btn").click();
    await expect(card.getByTestId("execution-count")).toContainText("Executed: 2×");
    await expect(card.getByTestId("remaining-count")).toContainText("1 left");
    await expect(records).toHaveCount(2);

    // Simulate third execution (completing schedule)
    await card.getByTestId("simulate-execution-btn").click();
    await expect(card.getByTestId("execution-count")).toContainText("Executed: 3×");
    await expect(card.getByTestId("remaining-count")).toContainText("0 left");
    await expect(records).toHaveCount(3);
  });

  test("cancels a recurring schedule", async ({ page }) => {
    await page.goto("/recurring");

    await page.getByTestId("create-recurring-btn").click();
    await page.getByTestId("recipient-input").fill("GCANCEL1234567890123456");
    await page.getByTestId("amount-input").fill("20.00");
    await page.getByTestId("submit-create-btn").click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    const card = page.getByTestId("recurring-card").first();
    await expect(card.getByTestId("cancel-recurring-btn")).toBeVisible();

    await card.getByTestId("cancel-recurring-btn").click();
    await expect(card.getByTestId("recurring-status-badge")).toContainText("Cancelled");
    await expect(card.getByTestId("pause-recurring-btn")).not.toBeVisible();
    await expect(card.getByTestId("simulate-execution-btn")).not.toBeVisible();
  });
});

test.describe("Recurring API Auth Gate", () => {
  test("GET /api/recurring returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/recurring`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/recurring/[id] returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/recurring/1`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/recurring returns 401 without auth", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/recurring`, {
      data: {
        name: "Test Recurring",
        frequency: "DAILY",
        amount: "50",
        assetCode: "XLM",
        destAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      },
    });
    expect(res.status()).toBe(401);
  });
});
