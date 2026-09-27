// SPDX-License-Identifier: MIT
//
// E2E coverage for the API keys admin page (issue #709).
//
// Covers the create → copy-once, edit-scopes and revoke happy paths plus the
// empty-name validation failure. The `/api/keys` and `/api/keys/stats` routes
// are mocked with a mutable store (see helpers/admin-mocks.ts).

import { test, expect } from "@playwright/test";
import { installAdminMocks, type ApiKeyRecord } from "./helpers/admin-mocks";

const existingKey: ApiKeyRecord = {
  id: "key_e2e_existing",
  name: "Production server",
  prefix: "op_prod1",
  scopes: ["read:payments"],
  lastUsed: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: null,
};

test.describe("API keys admin page", () => {
  test("creates a key with a selected scope and shows it once", async ({ page }) => {
    const state = await installAdminMocks(page, { apiKeys: [] });

    await page.goto("/keys");
    await expect(
      page.getByRole("heading", { level: 1, name: "API Keys" })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("You have no API keys yet.")).toBeVisible();

    await page.getByPlaceholder("e.g. Production server").fill("CI runner");
    await page
      .locator("label")
      .filter({ hasText: "read:payments" })
      .first()
      .getByRole("checkbox")
      .check();

    await page.getByRole("button", { name: "Create API key" }).click();

    await expect(page.getByText("Key created — copy it now:")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(state.createdKey)).toBeVisible();
    // The new key is written back to the mocked store and re-listed with its
    // scope badge.
    const created = page.locator("li").filter({ hasText: "CI runner" });
    await expect(created).toBeVisible();
    await expect(created.getByText("read:payments")).toBeVisible();
  });

  test("surfaces the empty-name validation failure", async ({ page }) => {
    await installAdminMocks(page, { apiKeys: [] });

    await page.goto("/keys");
    await page.getByRole("button", { name: "Create API key" }).click();

    await expect(page.getByText("Name required")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Please name your API key.")).toBeVisible();
    // Nothing was created.
    await expect(page.getByText("Key created — copy it now:")).toHaveCount(0);
  });

  test("edits a key's scopes", async ({ page }) => {
    await installAdminMocks(page, { apiKeys: [{ ...existingKey }] });

    await page.goto("/keys");
    await expect(page.getByText("Production server")).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Edit scopes" }).click();
    await expect(
      page.getByText(/Effective scopes for/)
    ).toBeVisible({ timeout: 15000 });

    // Add the analytics scope in the edit panel, then save.
    await page
      .locator("label")
      .filter({ hasText: "read:analytics" })
      .last()
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "Save scopes" }).click();

    await expect(page.getByText("Scopes updated")).toBeVisible({
      timeout: 15000,
    });
  });

  test("revokes a key", async ({ page }) => {
    await installAdminMocks(page, { apiKeys: [{ ...existingKey }] });

    await page.goto("/keys");
    await expect(page.getByText("Production server")).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Key revoked")).toBeVisible({ timeout: 15000 });
  });
});
