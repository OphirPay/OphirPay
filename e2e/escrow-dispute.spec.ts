// SPDX-License-Identifier: MIT
//
// Full escrow dispute lifecycle (#1405):
//
//   buyer opens dispute → status becomes DISPUTED → claim/release lock →
//   seller sees the dispute banner → arbiter resolves in favour of the buyer →
//   escrow settles and the buyer's wallet balance reflects the refund.
//
// All network boundaries are deterministic: `installEscrowMocks` supplies the
// Soroban RPC / Horizon / app-route responses, and the fake Freighter address is
// switched between the three parties without a real wallet extension.

import { expect, test } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SIGNER_A,
  SIGNER_B,
  createEscrowState,
  fakeFreighterInitScript,
  installEscrowMocks,
  switchEscrowActor,
} from "./helpers/escrow-helper";

type FreighterWindow = Window & {
  __setFreighterAddress: (address: string) => void;
};

async function connectAs(page: import("@playwright/test").Page, address: string) {
  await page.evaluate(
    (nextAddress) =>
      (window as unknown as FreighterWindow).__setFreighterAddress(nextAddress),
    address,
  );
}

test.describe("Escrow dispute and resolution", () => {
  test("buyer raises a dispute, seller sees locked actions, arbiter refunds buyer", async ({
    page,
  }) => {
    const state = createEscrowState();
    const arbiter = state.escrow.arbiter;
    expect(arbiter).toBeTruthy();

    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installEscrowMocks(page, state);

    await page.goto("/escrows");
    await expect(
      page.getByRole("heading", { name: "Escrow #1" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("dispute-banner")).toHaveCount(0);
    await expect(page.getByTestId("raise-dispute")).toBeVisible();

    // ── Buyer opens the dispute ────────────────────────────────
    await page.getByTestId("raise-dispute").click();
    await expect(page.getByTestId("dispute-banner")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Disputed", { exact: true })).toBeVisible();
    expect(state.actions).toEqual(["initiate_dispute"]);
    expect(state.escrow.dispute_initiated_at).toBeGreaterThan(0);

    // ── Seller's dashboard shows the same dispute state ────────
    switchEscrowActor(state, state.escrow.beneficiary);
    await connectAs(page, state.escrow.beneficiary);
    await page.reload();

    await expect(page.getByTestId("dispute-banner")).toBeVisible({
      timeout: 15000,
    });
    const claim = page.getByRole("button", { name: "Claim escrow" });
    await expect(claim).toBeVisible();
    await expect(claim).toBeDisabled();

    // ── Arbiter resolves in favour of the buyer ─────────────────
    switchEscrowActor(state, arbiter!);
    await connectAs(page, arbiter!);
    await page.reload();

    await expect(page.getByTestId("dispute-banner")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("resolve-to-buyer")).toBeVisible();
    await expect(page.getByTestId("resolve-to-seller")).toBeVisible();
    await page.getByTestId("resolve-to-buyer").click();

    await expect(page.getByTestId("dispute-banner")).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
    expect(state.actions).toEqual(["initiate_dispute", "resolve_dispute"]);
    expect(state.escrow.released).toBe(true);
    expect(state.escrow.claimed).toBe(true);

    // ── Buyer sees the refund reflected in their wallet ─────────
    switchEscrowActor(state, SIGNER_A);
    await connectAs(page, SIGNER_A);
    await page.reload();

    // 1,000 XLM opening balance + 25 XLM escrow refund. The balance pill is
    // hidden below the `sm` breakpoint, so assert attachment (the DOM value
    // updated) in addition to the shared Horizon ledger state.
    await expect(page.getByText(/1,025\.00 XLM/)).toBeAttached({
      timeout: 15000,
    });
    expect(state.balances[SIGNER_A]).toBe("1025.0000000");
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
  });

  test("an unrelated wallet sees neither the dispute action nor arbiter controls", async ({
    page,
  }) => {
    const state = createEscrowState();
    const outsider = Keypair.random().publicKey();

    await page.addInitScript(fakeFreighterInitScript(outsider));
    await installEscrowMocks(page, state);

    state.chain.activeSigner = outsider;
    await page.goto("/escrows");
    await expect(
      page.getByRole("heading", { name: "Escrow #1" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("raise-dispute")).toHaveCount(0);
    await expect(page.getByTestId("resolve-to-buyer")).toHaveCount(0);
    await expect(page.getByText(SIGNER_B.slice(0, 12))).toBeVisible();
  });
});
