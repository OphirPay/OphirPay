// SPDX-License-Identifier: MIT
//
// E2E coverage for the RBAC admin page (issue #709).
//
// Covers the grant and revoke happy paths, the duplicate-assignment path, and
// the invalid-Stellar-address validation failure. The role mutations run
// through the shared mocked Soroban RPC + Horizon + fake-Freighter stack;
// `/api/rbac` reports the connected wallet's own role.

import { test, expect } from "@playwright/test";
import {
  installAdminMocks,
  VALID_ADDRESS_A,
  VALID_ADDRESS_B,
} from "./helpers/admin-mocks";

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

  // Issue #1389 — sudo mode. A role change is a critical admin action, so the
  // page must first pass a server-side step-up gate. When the server reports
  // the session's cryptographic verification is stale (SUDO_REQUIRED), the
  // re-authentication modal appears and the on-chain write only proceeds after
  // the user re-signs.
  test("requires wallet re-authentication before a role change (sudo mode)", async ({
    page,
  }) => {
    await installAdminMocks(page, { ownRole: 0 });

    // Replace the default /api/rbac mock with one that enforces step-up: the
    // first mutation is refused with SUDO_REQUIRED + a challenge, and the retry
    // carrying the challenge proof is authorized.
    let reauthenticated = false;
    await page.unroute("**/api/rbac**");
    await page.route("**/api/rbac**", (route) => {
      const request = route.request();
      if (request.method().toUpperCase() !== "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { address: VALID_ADDRESS_A, role: 0 } }),
        });
      }
      const body = (request.postDataJSON() ?? {}) as {
        challenge?: string;
        signature?: string;
      };
      if (!body.challenge || !body.signature) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: {
              code: "SUDO_REQUIRED",
              message: "Re-authentication required",
              details: {
                challenge: "sudo-challenge-token",
                message: "ophirpay:login:op-challenge",
                expiresInSeconds: 900,
              },
            },
          }),
        });
      }
      reauthenticated = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { authorized: true } }),
      });
    });

    await page.goto("/rbac");
    await page.locator("button").filter({ hasText: "Grant Role" }).first().click();
    const grantDialog = page.getByRole("dialog").filter({ hasText: "Grant Role" });
    await grantDialog.getByPlaceholder("GABC...").fill(VALID_ADDRESS_B);
    await grantDialog.getByRole("button", { name: "Grant Role On-Chain" }).click();

    // Step-up prompt appears; the role is NOT granted yet.
    await expect(
      page.getByRole("button", { name: "Re-authenticate" })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Role granted on-chain")).toHaveCount(0);

    // Re-signing authorizes the mutation, and the on-chain write completes.
    await page.getByRole("button", { name: "Re-authenticate" }).click();
    await expect(page.getByText("Role granted on-chain")).toBeVisible({
      timeout: 20000,
    });
    expect(reauthenticated).toBe(true);
  });
});
