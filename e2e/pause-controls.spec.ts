// SPDX-License-Identifier: MIT
//
// E2E coverage for the pause-controls admin page (issue #708).
//
// The page reads `/api/pause-state` (mocked) and mutates the contract through
// `emergencyPauseAll` / `emergencyUnpauseAll`, which run through the mocked
// Soroban RPC + Horizon + fake-Freighter stack (see helpers/stellar-mock.ts).
//
// The suite asserts:
//   • the active state and the pause happy path (with the paused banner
//     appearing once the state refetch lands),
//   • the paused state, the banner and the unpause happy path,
//   • the unknown/unavailable state disables both mutations.

import { test, expect } from "@playwright/test";
import { installAdminMocks } from "./helpers/admin-mocks";

test.describe("Pause controls", () => {
  test("pauses the contract and surfaces the paused banner", async ({ page }) => {
    const state = await installAdminMocks(page, {
      pause: { paused: false, available: true },
    });

    await page.goto("/pause-controls");
    await expect(
      page.getByRole("heading", { level: 1, name: "Contract Pause Controls" })
    ).toBeVisible({ timeout: 15000 });

    // Active state: green badge + the danger pause button.
    await expect(page.getByText("▶ Active")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("Contract is paused — emergency mode active")
    ).toHaveCount(0);

    const pauseButton = page.getByRole("button", { name: /Pause Contract/ });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();

    // Flip the mocked state before the on-chain round-trip resolves so the
    // post-mutation refetch (triggered by query invalidation) reflects it.
    state.pause = { paused: true, available: true };

    await expect(
      page.getByText("Contract paused on-chain — all writes are now blocked")
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText("Contract is paused — emergency mode active")
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /Unpause Contract/ })
    ).toBeVisible();
  });

  test("unpauses the contract and clears the paused banner", async ({ page }) => {
    const state = await installAdminMocks(page, {
      pause: { paused: true, available: true },
    });

    await page.goto("/pause-controls");
    await expect(
      page.getByRole("heading", { level: 1, name: "Contract Pause Controls" })
    ).toBeVisible({ timeout: 15000 });

    // Paused state: red banner + the unpause control.
    await expect(
      page.getByText("Contract is paused — emergency mode active")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("⏸ Paused")).toBeVisible();

    const unpauseButton = page.getByRole("button", { name: /Unpause Contract/ });
    await expect(unpauseButton).toBeEnabled();
    await unpauseButton.click();

    state.pause = { paused: false, available: true };

    await expect(
      page.getByText("Contract unpaused on-chain — writes are now enabled")
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText("Contract is paused — emergency mode active")
    ).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText("▶ Active")).toBeVisible();
  });

  test("disables the pause controls when the contract state is unknown", async ({
    page,
  }) => {
    await installAdminMocks(page, {
      pause: { paused: "unknown", available: false },
    });

    await page.goto("/pause-controls");
    await expect(
      page.getByRole("heading", { level: 1, name: "Contract Pause Controls" })
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("❓ Unknown")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("Unable to determine current contract state")
    ).toBeVisible();

    // Neither mutation may be reachable while the state is unknown.
    await expect(
      page.getByRole("button", { name: /Pause Contract/ })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Unpause Contract/ })
    ).toHaveCount(0);
  });
});
