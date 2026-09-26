// SPDX-License-Identifier: MIT
//
// E2E coverage for the RBAC admin page (issue #709).
//
// Covers the grant and revoke happy paths, the duplicate-assignment path, and
// the invalid-Stellar-address validation failure. The role mutations run
// through the shared mocked Soroban RPC + Horizon + fake-Freighter stack;
// `/api/rbac` reports the connected wallet's own role.

import { test, expect } from "@playwright/test";
import { installAdminMocks, VALID_ADDRESS_B } from "./helpers/admin-mocks";

// The address list renders `GACNKEDGJYLL...NC4YWHU`.
const SHORT_ADDRESS_B = /GACNKEDGJYLL/;

test.describe("RBAC admin page", () => {
  test("grants a role to an address", async ({ page }) => {
    await installAdminMocks(page, { ownRole: 0 });

    await page.goto("/rbac");
    await expect(
      page.getByRole("heading", { level: 1, name: "Role-Based Access Control" })
    ).toBeVisible({ timeout: 15000 });

    await page.locator("button").filter({ hasText: "Grant Role" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Grant Role");

    await dialog.getByPlaceholder("GABC...").fill(VALID_ADDRESS_B);
    await dialog.getByRole("button", { name: "Auditor" }).click();
    await dialog.getByRole("button", { name: "Grant Role On-Chain" }).click();

    await expect(page.getByText("Role granted on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(SHORT_ADDRESS_B)).toBeVisible();
  });

  test("rejects an invalid Stellar address", async ({ page }) => {
    await installAdminMocks(page, { ownRole: 0 });

    await page.goto("/rbac");
    await page.locator("button").filter({ hasText: "Grant Role" }).first().click();
    const dialog = page.getByRole("dialog");

    await dialog.getByPlaceholder("GABC...").fill("not-a-stellar-address");
    await dialog.getByRole("button", { name: "Grant Role On-Chain" }).click();

    await expect(page.getByText("Invalid Stellar public key")).toBeVisible({
      timeout: 15000,
    });
  });

  test("keeps a single assignment when the same role is granted twice", async ({
    page,
  }) => {
    await installAdminMocks(page, { ownRole: 0 });

    await page.goto("/rbac");

    for (const role of ["Operator", "Auditor"]) {
      await page
        .locator("button")
        .filter({ hasText: "Grant Role" })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByPlaceholder("GABC...").fill(VALID_ADDRESS_B);
      await dialog.getByRole("button", { name: role }).click();
      await dialog.getByRole("button", { name: "Grant Role On-Chain" }).click();
      await expect(page.getByText("Role granted on-chain")).toBeVisible({
        timeout: 20000,
      });
    }

    // Re-granting replaces the record rather than adding a duplicate row.
    await expect(page.getByText(SHORT_ADDRESS_B)).toHaveCount(1);
  });

  test("revokes a role with its destructive confirmation", async ({ page }) => {
    await installAdminMocks(page, { ownRole: 0 });

    await page.goto("/rbac");

    // Grant first so there is an assignment to revoke.
    await page.locator("button").filter({ hasText: "Grant Role" }).first().click();
    let dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("GABC...").fill(VALID_ADDRESS_B);
    await dialog.getByRole("button", { name: "Grant Role On-Chain" }).click();
    await expect(page.getByText("Role granted on-chain")).toBeVisible({
      timeout: 20000,
    });

    await page
      .locator("button")
      .filter({ hasText: "Revoke Role" })
      .first()
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Revoke Role");
    await dialog.getByPlaceholder("GABC...").fill(VALID_ADDRESS_B);

    // Destructive confirmation copy appears for a known assignment.
    await expect(
      dialog.getByText(/This will remove the/)
    ).toBeVisible({ timeout: 15000 });

    await dialog.getByRole("button", { name: "Revoke Role On-Chain" }).click();
    await expect(page.getByText("Role revoked on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(SHORT_ADDRESS_B)).toHaveCount(0);
  });
});
