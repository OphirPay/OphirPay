// SPDX-License-Identifier: MIT
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
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /Timelocked Actions/i })
    ).toBeVisible({ timeout: 30000 });

    await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("#7")).toBeVisible();
    await expect(page.getByText(/\d+h \d+m remaining/)).toBeVisible({ timeout: 30000 });

    const waitingBtn = page.getByRole("button", { name: /Waiting/i }).first();
    await expect(waitingBtn).toBeVisible({ timeout: 30000 });
    await expect(waitingBtn).toBeDisabled();
    await expect(page.getByRole("button", { name: /Execute/ })).toHaveCount(0);
  });

  test("executes an unlocked action", async ({ page }) => {
    await installAdminMocks(page, {
      timelock: [readyAction({ id: 11, executed: false })],
    });
    await page.goto("/timelock");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /Timelocked Actions/i })
    ).toBeVisible({ timeout: 30000 });

    await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 30000 });

    const execute = page.getByRole("button", { name: /Execute/ }).first();
    await expect(execute).toBeVisible({ timeout: 30000 });
    await expect(execute).toBeEnabled({ timeout: 10000 });
    // Firefox precisa de um tempinho extra antes do click
    await page.waitForTimeout(300);
    await execute.click();

    await expect(
      page.getByText("Timelocked action executed on-chain")
    ).toBeVisible({ timeout: 30000 });
  });

  test("cancels a pending action", async ({ page }) => {
    await installAdminMocks(page, { timelock: [readyAction({ id: 12 })] });
    await page.goto("/timelock");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /Timelocked Actions/i })
    ).toBeVisible({ timeout: 30000 });

    const cancelBtn = page.getByRole("button", { name: /Cancel/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(300);
    await cancelBtn.click();
    await expect(page.getByText("Action cancelled on-chain")).toBeVisible({
      timeout: 30000,
    });
  });

  test("proposes a new action through the confirmation modal", async ({
    page,
  }) => {
    await installAdminMocks(page, { timelock: [] });
    await page.goto("/timelock");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("No Timelocked Actions")).toBeVisible({
      timeout: 30000,
    });

    const proposeBtn = page.getByRole("button", { name: /Propose Action/i }).first();
    await expect(proposeBtn).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(300);
    await proposeBtn.click();
    
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Propose Timelocked Action", { timeout: 30000 });

    await dialog.getByRole("button", { name: /pause contract/i }).first().click();
    await page.waitForTimeout(200);

    await dialog
      .getByPlaceholder("Contract address or parameter...")
      .first()
      .fill("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU");

    await dialog
      .getByRole("button", { name: "Propose with 24h Timelock" })
      .first()
      .click();

    await expect(
      page.getByText("Timelocked action proposed (24h delay)")
    ).toBeVisible({ timeout: 30000 });
  });

  test("renders an executed action without further controls", async ({
    page,
  }) => {
    await installAdminMocks(page, {
      timelock: [readyAction({ id: 13, executed: true })],
    });
    await page.goto("/timelock");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Executed", { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("button", { name: /Execute/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Cancel/ })).toHaveCount(0);
  });
});
