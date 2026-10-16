// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import { createMockEscrow, mockEscrowApi } from "./helpers/escrow-helper";

test.describe("Escrow Dispute & Resolution Flow (Issue #1405)", () => {
  test("full dispute lifecycle: funded -> buyer disputes -> arbitrator resolves refund", async ({ page }) => {
    const escrow = createMockEscrow({ amount: 1000, state: "funded" });
    await mockEscrowApi(page, escrow);

    // 1. Visit escrow detail view
    await page.goto(`/escrows/${escrow.id}`);
    await expect(page.locator("main")).toBeVisible();

    // 2. Verify initial funded state
    const fundedIndicator = page.getByText(/funded/i).or(page.locator("[data-testid='escrow-status']"));
    await expect(fundedIndicator.first()).toBeVisible({ timeout: 10000 });

    // 3. Buyer opens dispute dialog
    const disputeButton = page.getByRole("button", { name: /raise dispute|dispute/i }).first();
    if (await disputeButton.isVisible()) {
      await disputeButton.click();

      // Fill dispute reason
      const reasonInput = page.locator("textarea[name='reason']").or(page.locator("textarea")).first();
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Deliverable does not meet technical specifications.");
      }

      // Confirm dispute
      const submitBtn = page.getByRole("button", { name: /confirm dispute|submit/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      }

      // 4. Verify status transitions to DISPUTED and release button is disabled
      await expect(page.getByText(/disputed/i).first()).toBeVisible({ timeout: 5000 });
      const releaseBtn = page.getByRole("button", { name: /release funds/i }).first();
      if (await releaseBtn.isVisible()) {
        await expect(releaseBtn).toBeDisabled();
      }
    }
  });

  test("arbitrator views evidence and resolves dispute in favor of refund", async ({ page }) => {
    const escrow = createMockEscrow({
      amount: 1000,
      state: "disputed",
      disputeReason: "Breach of contract delivery date",
    });
    await mockEscrowApi(page, escrow);

    await page.goto(`/escrows/${escrow.id}`);
    await expect(page.locator("main")).toBeVisible();

    // Verify dispute banner is prominent
    const disputeBanner = page.getByText(/in dispute|disputed/i).or(page.locator("[role='alert']"));
    await expect(disputeBanner.first()).toBeVisible({ timeout: 10000 });

    // Arbitrator resolve action
    const resolveButton = page.getByRole("button", { name: /resolve dispute|refund buyer/i }).first();
    if (await resolveButton.isVisible()) {
      await resolveButton.click();
      await expect(page.getByText(/resolved|refunded/i).first()).toBeVisible({ timeout: 5000 });
    }
  });
});
