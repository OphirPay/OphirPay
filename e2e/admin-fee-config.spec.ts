// SPDX-License-Identifier: MIT
//
// E2E coverage for the fee-config admin page (issue #709).
//
// Covers the edit-fees and set-collector happy paths plus the out-of-range
// fee validation (the Save control is closed and the field is flagged). The
// on-chain writes reuse the shared Soroban RPC + Horizon + fake-Freighter mocks.

import { test, expect } from "@playwright/test";
import { installAdminMocks, VALID_ADDRESS_B } from "./helpers/admin-mocks";

test.describe("Fee configuration admin page", () => {
  test("saves a new fee configuration", async ({ page }) => {
    await installAdminMocks(page);

    await page.goto("/fee-config");
    await expect(
      page.getByRole("heading", { level: 1, name: "Fee Configuration" })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("0.10%")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Edit Fees" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Configure Protocol Fees");

    await dialog.getByLabel("Payment Fee (bps)").fill("100");
    await dialog
      .getByRole("button", { name: "Save Fee Configuration" })
      .click();

    await expect(
      page.getByText("Fee configuration saved on-chain")
    ).toBeVisible({ timeout: 20000 });
  });

  test("blocks and flags an out-of-range fee", async ({ page }) => {
    await installAdminMocks(page);

    await page.goto("/fee-config");
    await page.getByRole("button", { name: "Edit Fees" }).click();
    const dialog = page.getByRole("dialog");

    // MAX_FEE_BPS is 1000 (10%); 5000 is rejected by the client-side validation.
    const paymentFee = dialog.getByLabel("Payment Fee (bps)");
    await paymentFee.fill("5000");

    await expect(paymentFee).toHaveValue("5000");
    // The invalid field is flagged and the save control is closed so the
    // invalid config can never be submitted.
    await expect(paymentFee).toHaveClass(/border-red-500/);
    await expect(
      dialog.getByRole("button", { name: "Save Fee Configuration" })
    ).toBeDisabled();
  });

  test("updates the fee collector", async ({ page }) => {
    await installAdminMocks(page);

    await page.goto("/fee-config");
    await page.getByRole("button", { name: "Set Collector" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Set Fee Collector");

    await dialog.getByLabel("Collector Address").fill(VALID_ADDRESS_B);
    await dialog.getByRole("button", { name: "Set Fee Collector" }).click();

    await expect(
      page.getByText("Fee collector updated on-chain")
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(VALID_ADDRESS_B)).toBeVisible({
      timeout: 15000,
    });
  });

  test("rejects a too-short collector address", async ({ page }) => {
    await installAdminMocks(page);

    await page.goto("/fee-config");
    await page.getByRole("button", { name: "Set Collector" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Collector Address").fill("GABC");
    await expect(
      dialog.getByRole("button", { name: "Set Fee Collector" })
    ).toBeDisabled();
  });
});
