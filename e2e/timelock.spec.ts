// SPDX-License-Identifier: MIT
//
// E2E coverage for the timelock admin page (issue #708).
//
// `/api/timelock` is mocked with a controllable list of actions so the spec can
// render a still-locked action, an unlocked one, and an executed one. The
// propose / execute / cancel mutations run through the shared mocked Soroban
// RPC + Horizon + fake-Freighter stack (see helpers/stellar-mock.ts).

import { test, expect } from "@playwright/test";
import {
  installAdminMocks,
  lockedAction,
  readyAction,
} from "./helpers/admin-mocks";

test.describe("Timelocked actions", () => {
  test("renders the unlock countdown and blocks execution while locked", async ({
    page,
  }) => {
    await installAdminMocks(page, { timelock: [lockedAction({ id: 7 })] });

    await page.goto("/timelock");
    await expect(
      page.getByRole("heading", { level: 1, name: "Timelocked Actions" })
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("Locked")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("#7")).toBeVisible();
    // Unlock countdown renders (e.g. "5h 0m remaining").
    await expect(page.getByText(/\d+h \d+m remaining/)).toBeVisible();
    // Execute is present but disabled until the unlock time passes.
    await expect(page.getByRole("button", { name: "⏳ Waiting" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "✓ Execute" })).toHaveCount(0);
  });

  test("executes an unlocked action", async ({ page }) => {
    await installAdminMocks(page, { timelock: [readyAction({ id: 11 })] });

    await page.goto("/timelock");
    await expect(
      page.getByRole("heading", { level: 1, name: "Timelocked Actions" })
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("Ready")).toBeVisible({ timeout: 15000 });
    const execute = page.getByRole("button", { name: "✓ Execute" });
    await expect(execute).toBeEnabled();
    await execute.click();

    await expect(
      page.getByText("Timelocked action executed on-chain")
    ).toBeVisible({ timeout: 20000 });
  });

  test("cancels a pending action", async ({ page }) => {
    await installAdminMocks(page, { timelock: [readyAction({ id: 12 })] });

    await page.goto("/timelock");
    await expect(
      page.getByRole("heading", { level: 1, name: "Timelocked Actions" })
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Action cancelled on-chain")).toBeVisible({
      timeout: 20000,
    });
  });

  test("proposes a new action through the confirmation modal", async ({
    page,
  }) => {
    await installAdminMocks(page, { timelock: [] });

    await page.goto("/timelock");
    await expect(page.getByText("No Timelocked Actions")).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "+ Propose Action" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Propose Timelocked Action");

    await dialog.getByRole("button", { name: "pause contract" }).click();
    await dialog
      .getByPlaceholder("Contract address or parameter...")
      .fill("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU");

    await dialog
      .getByRole("button", { name: "Propose with 24h Timelock" })
      .click();

    await expect(
      page.getByText("Timelocked action proposed (24h delay)")
    ).toBeVisible({ timeout: 20000 });
  });

  test("renders an executed action without further controls", async ({
    page,
  }) => {
    await installAdminMocks(page, {
      timelock: [readyAction({ id: 13, executed: true })],
    });

    await page.goto("/timelock");
    await expect(page.getByText("Executed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "✓ Execute" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });
});
