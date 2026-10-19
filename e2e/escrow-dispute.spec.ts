// SPDX-License-Identifier: MIT
//
// End-to-end coverage for the escrow dispute lifecycle (issue #1405).
//
// The suite runs against a live deployment with no browser wallet and no funded
// Testnet contract, so this test drives the full
//
//   buyer raises dispute  →  DISPUTED (funds held)  →  arbiter resolves
//
// flow against deterministic browser-side mocks (see helpers/escrow-helper.ts):
// a fake `window.freighter`, a stateful `/api/escrows` ledger, and the two
// dispute/resolve API routes. Every real client layer still runs — the escrows
// page, `@/hooks/useApiQuery` (CSRF + refetch), and the dispute/resolve
// mutations — without live chain state. The mock ledger flips its `disputed`
// flag on each mutation, so the UI's refetch reveals the new state.

import { test, expect, type Page } from "@playwright/test";
import {
  createEscrowsState,
  installEscrowMocks,
  makeEscrow,
  type EscrowsState,
} from "./helpers/escrow-helper";
import {
  fakeFreighterInitScript,
  randomAddress,
  SIGNER_A,
  SIGNER_B,
} from "./helpers/stellar-mock";

/** Load /escrows with deterministic mocks and a connected fake wallet. */
async function openEscrows(page: Page, state: EscrowsState): Promise<void> {
  await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
  await installEscrowMocks(page, state);
  await page.goto("/escrows");

  // The page heading renders after client-side hydration.
  await expect(page.locator("main h1")).toContainText("Escrows", {
    timeout: 15000,
  });
  // The wallet auto-connects via the mocked Freighter, so the "connect your
  // wallet" banner never appears.
  await expect(page.getByText("Wallet not connected")).toHaveCount(0, {
    timeout: 15000,
  });
}

test.describe("Escrow dispute lifecycle UI", () => {
  test("a buyer raises a dispute and the arbiter resolves it in favor of the buyer", async ({
    page,
  }) => {
    const state = createEscrowsState();
    // The connected wallet (SIGNER_A) is both the depositor (buyer) and the
    // arbiter, so a single identity can exercise the whole dispute → resolve flow.
    makeEscrow(state, {
      id: 1,
      depositor: SIGNER_A,
      beneficiary: SIGNER_B,
      arbiter: SIGNER_A,
      disputed: false,
    });

    await openEscrows(page, state);
    await expect(page.getByText("Escrow #1")).toBeVisible();

    // Before any dispute the buyer/arbiter sees a "Raise dispute" action.
    const raiseBtn = page.getByRole("button", { name: "Raise dispute" });
    await expect(raiseBtn).toBeVisible();

    // ── Raise dispute ──────────────────────────────────────────
    await raiseBtn.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/Describe why/).fill("Item never delivered");
    await dialog.getByRole("button", { name: "Submit dispute" }).click();

    await expect(page.getByText(/Escrow 1 dispute opened/)).toBeVisible({
      timeout: 20000,
    });

    // The card now shows the held-funds banner and the arbiter's resolution
    // controls; the "Raise dispute" action is gone while disputed.
    await expect(
      page.getByText(/Dispute open — funds held pending arbitration/),
    ).toBeVisible();
    await expect(page.getByText("Arbitration pending")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resolve to buyer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resolve to seller" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Raise dispute" }),
    ).toHaveCount(0);
    expect(state.escrows[0].disputed).toBe(true);

    // ── Arbiter resolves to the buyer ──────────────────────────
    await page.getByRole("button", { name: "Resolve to buyer" }).click();

    await expect(
      page.getByText(/Dispute resolved in favor of buyer/),
    ).toBeVisible({ timeout: 20000 });

    // The dispute banner clears and no resolution controls remain.
    await expect(
      page.getByText(/Dispute open — funds held pending arbitration/),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resolve to buyer" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resolve to seller" }),
    ).toHaveCount(0);
    expect(state.escrows[0].disputed).toBe(false);
  });

  test("a non-arbiter buyer sees the dispute pending state with no resolution controls", async ({
    page,
  }) => {
    const state = createEscrowsState();
    // The connected wallet is only the depositor; the arbiter is a separate,
    // unconnected address. After raising the dispute the buyer must wait.
    makeEscrow(state, {
      id: 1,
      depositor: SIGNER_A,
      beneficiary: SIGNER_B,
      arbiter: randomAddress(),
      disputed: false,
    });

    await openEscrows(page, state);
    await expect(page.getByText("Escrow #1")).toBeVisible();

    const raiseBtn = page.getByRole("button", { name: "Raise dispute" });
    await expect(raiseBtn).toBeVisible();

    await raiseBtn.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/Describe why/).fill("Wrong item shipped");
    await dialog.getByRole("button", { name: "Submit dispute" }).click();

    await expect(page.getByText(/Escrow 1 dispute opened/)).toBeVisible({
      timeout: 20000,
    });

    // Dispute is open, but as a non-arbiter the buyer only sees the waiting
    // state — no arbiter resolution controls are offered.
    await expect(
      page.getByText(/Dispute open — funds held pending arbitration/),
    ).toBeVisible();
    await expect(page.getByText("Awaiting arbiter decision.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resolve to buyer" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resolve to seller" }),
    ).toHaveCount(0);
    expect(state.escrows[0].disputed).toBe(true);
  });
});
