// SPDX-License-Identifier: MIT
//
// E2E coverage for the notification hooks admin page (issue #709).
//
// The register/deactivate actions run through the mocked Soroban RPC + Horizon
// + fake-Freighter stack; `/api/hooks` is mocked with a mutable store so the
// page's ledger row write is exercised too.

import { test, expect } from "@playwright/test";
import { installAdminMocks, type HookRecord } from "./helpers/admin-mocks";

const activeHook: HookRecord = {
  id: "hk_e2e_active",
  userId: "user_e2e",
  eventType: "payment_recorded",
  webhookUrl: "https://hooks.example.com/ophirpay",
  active: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  onChainId: 42,
};

test.describe("Notification hooks admin page", () => {
  test("registers a hook through the confirmation modal", async ({ page }) => {
    await installAdminMocks(page, { hooks: [] });

    await page.goto("/hooks");
    await expect(
      page.getByRole("heading", { level: 1, name: /Notification Hooks/ })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("No Notification Hooks")).toBeVisible();

    await page.getByRole("button", { name: "+ Register Hook" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Register Notification Hook");

    await dialog
      .getByPlaceholder("https://your-server.com/webhook")
      .fill("https://hooks.example.com/new");
    await dialog.getByRole("button", { name: "Register On-Chain" }).click();

    await expect(
      page.getByText("Notification hook registered on-chain")
    ).toBeVisible({ timeout: 20000 });
    // The persisted row is re-listed after the query invalidates.
    await expect(
      page.getByText("https://hooks.example.com/new")
    ).toBeVisible({ timeout: 15000 });
  });

  test("rejects an empty webhook URL", async ({ page }) => {
    await installAdminMocks(page, { hooks: [] });

    await page.goto("/hooks");
    await page.getByRole("button", { name: "+ Register Hook" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Register On-Chain" }).click();

    await expect(page.getByText("Webhook URL is required")).toBeVisible({
      timeout: 15000,
    });
  });

  test("deactivates an on-chain hook", async ({ page }) => {
    await installAdminMocks(page, { hooks: [{ ...activeHook }] });

    await page.goto("/hooks");
    await expect(
      page.getByText("https://hooks.example.com/ophirpay")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Active")).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Hook deactivated on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("Inactive")).toBeVisible({ timeout: 15000 });
  });
});
