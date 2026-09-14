// SPDX-License-Identifier: MIT
//
// End-to-end test for the two-signer multisig payment flow.
//
// The suite runs against a live deployment with no browser wallet and no
// funded Testnet contract, so this test walks through the full
//
//   propose → approve (signer 1) → non-signer attempt → approve (signer 2)
//           → execute → payment appears in history
//
// flow against deterministic browser-side mocks (see helpers/stellar-mock.ts):
// a fake `window.freighter` (flippable signer address) plus mocked Soroban RPC
// and Horizon responses. This still exercises every real client layer — the
// multisig page, the contract-advanced helpers, and the Stellar SDK's
// build/simulate/sign/submit pipeline — without needing live chain state.

import { test, expect, type Page } from "@playwright/test";
import {
  SIGNER_A,
  SIGNER_B,
  createState,
  installMultisigMocks,
  fakeFreighterInitScript,
  randomAddress,
  type MultisigState,
} from "./helpers/stellar-mock";

// Amount proposed for the payment (XLM).
const AMOUNT = "250";
// Recipient of the proposed payment — any valid-format address.
const PAYEE = SIGNER_B;

/** Reconnect the fake wallet as a different signer via the header UI. */
async function switchSigner(page: Page, address: string): Promise<void> {
  await page.evaluate((a) => {
    (window as unknown as {
      __setFreighterAddress: (addr: string) => void;
    }).__setFreighterAddress(a);
  }, address);

  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).click();
  // Freighter is "Installed" because we injected window.freighter.
  await page.getByRole("button", { name: /Freighter/i }).click();

  // Wait until the wallet is connected again (Connect button disappears).
  await expect(
    page.getByRole("button", { name: "Connect Wallet", exact: true }),
  ).toHaveCount(0, { timeout: 15000 });
}

test.describe("Two-signer multisig payment flow", () => {
  test("propose, approve from both signers, enforce threshold, reject non-signer, and execute", async ({
    page,
  }) => {
    const state: MultisigState = createState();

    // Prepare deterministic mocks before any navigation.
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installMultisigMocks(page, state);

    // ── Landing ────────────────────────────────────────────────
    await page.goto("/multisig");

    // Wallet auto-connects as SIGNER_A via the mocked Freighter.
    await expect(
      page.getByRole("button", { name: "Connect Wallet", exact: true }),
    ).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator("main h1")).toContainText("Multisig", {
      timeout: 15000,
    });

    // Multisig loaded from the mocked API: threshold 2 of signers 2.
    await expect(page.getByText("2/2 threshold")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "+ Propose Payment" }).click();

    // ── Propose a payment ──────────────────────────────────────
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("GABC...").fill(PAYEE);
    await dialog.locator('input[type="number"]').fill(AMOUNT);
    await dialog.getByRole("button", { name: "Propose Payment" }).click();

    await expect(
      page.getByText("Payment proposed for multisig approval"),
    ).toBeVisible({ timeout: 20000 });
    // New pending request appears with 0/2 approvals and no Execute option.
    await expect(page.getByText(`${AMOUNT} XLM`, { exact: true })).toBeVisible();
    await expect(page.getByText("0/2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "✓ Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);

    // ── Approve as signer A (threshold NOT yet met) ────────────
    await page.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText("Approval submitted on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("1/2", { exact: true })).toBeVisible();
    // Threshold enforcement: one approval does NOT unlock Execute.
    await expect(page.getByRole("button", { name: "✓ Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);

    // ── Non-signer attempts to approve ─────────────────────────
    // Connect as an address that is NOT in the signer list; the mocked
    // contract simulation reverts and the UI surfaces the error.
    const nonSigner = randomAddress();
    state.activeSigner = nonSigner;
    state.failSimulate = true;
    await switchSigner(page, nonSigner);

    await page.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText(/Not a signer/i)).toBeVisible({
      timeout: 20000,
    });
    // The failed approval did not advance the counter.
    await expect(page.getByText("1/2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);

    // ── Approve as signer B (threshold now met) ────────────────
    state.activeSigner = SIGNER_B;
    state.failSimulate = false;
    await switchSigner(page, SIGNER_B);

    await page.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText("Approval submitted on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("2/2", { exact: true })).toBeVisible();
    // Threshold met → the Approve control is replaced by Execute.
    await expect(page.getByRole("button", { name: "Execute" })).toBeVisible();
    await expect(page.getByRole("button", { name: "✓ Approve" })).toHaveCount(0);

    // ── Execute the approved payment ───────────────────────────
    await page.getByRole("button", { name: "Execute" }).click();
    await expect(page.getByText("Payment executed on-chain")).toBeVisible({
      timeout: 20000,
    });

    // Payment completes and appears in history: the request is retained in
    // the list, now marked "Executed", with no further Approve/Execute actions.
    await expect(page.getByText("Executed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "✓ Approve" }),
    ).toHaveCount(0);
  });
});