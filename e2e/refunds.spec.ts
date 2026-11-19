// SPDX-License-Identifier: MIT
//
// End-to-end coverage for the refund lifecycle UI (issue #707).
//
// The suite runs against a live deployment with no browser wallet and no funded
// Testnet contract, so this test drives the full
//
//   request → approve → process            (happy path)
//   request → reject                       (rejection path)
//
// flow against deterministic browser-side mocks (see helpers/refunds-mock.ts):
// a fake `window.freighter`, a stateful `/api/refunds` ledger, and mocked
// Soroban RPC + Horizon responses. Every real client layer still runs — the
// refunds page, `@/lib/contract-advanced` refund helpers, and the Stellar SDK
// build/simulate/sign/submit pipeline — without live chain state.
//
// On-chain refunds are addressed by u64 ids; the mocked ledger assigns a
// monotonic id per request, which the UI surfaces as "On-chain refund #<id>".

import { test, expect, type Page } from "@playwright/test";
import {
  createRefundsState,
  installRefundsMocks,
  makeRefund,
  type RefundsState,
} from "./helpers/refunds-mock";
import { fakeFreighterInitScript, SIGNER_A } from "./helpers/stellar-mock";

// A valid Stellar contract address used as the refund asset (the page passes
// it to `nativeToScVal(..., { type: "address" })`, which validates the StrKey).
const ASSET_ADDRESS =
  "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
const PAYMENT_ID = "42";
const AMOUNT = "100";
const REASON_LABEL = "Duplicate Charge";
const REASON_TEXT = "Duplicate charge on invoice";

/** Load /refunds with deterministic mocks and a connected fake wallet. */
async function openRefunds(page: Page, state: RefundsState): Promise<void> {
  await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
  await installRefundsMocks(page, state);
  await page.goto("/refunds");

  // The page heading renders after client-side hydration.
  await expect(page.locator("main h1")).toContainText("Refunds", {
    timeout: 15000,
  });
  // The wallet auto-connects via the mocked Freighter, so the "connect your
  // wallet" banner never appears.
  await expect(page.getByText("Wallet not connected")).toHaveCount(0, {
    timeout: 15000,
  });
}

test.describe("Refund lifecycle UI", () => {
  test("requests, approves, processes, and round-trips the reason code", async ({
    page,
  }) => {
    const state = createRefundsState();

    await openRefunds(page, state);
    await expect(page.getByText("No Refunds")).toBeVisible();

    // ── Request ────────────────────────────────────────────────
    await page.getByRole("button", { name: "+ Request Refund" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. 42").fill(PAYMENT_ID);
    await dialog.getByPlaceholder("e.g. 10000000").fill(AMOUNT);
    await dialog.getByPlaceholder("Leave empty for native XLM").fill(ASSET_ADDRESS);
    await dialog.locator("select").selectOption({ label: REASON_LABEL });
    await dialog.getByPlaceholder(/Describe why/).fill(REASON_TEXT);
    await dialog.getByRole("button", { name: "Submit Refund Request" }).click();

    await expect(page.getByText("Refund requested on-chain")).toBeVisible({
      timeout: 20000,
    });

    // The ledger row surfaces the payment id, the reason-code label, the
    // status, and the on-chain refund id assigned by the contract.
    await expect(page.getByText(`Payment #${PAYMENT_ID}`)).toBeVisible();
    await expect(page.getByText("REQUESTED", { exact: true })).toBeVisible();
    await expect(page.getByText(REASON_LABEL, { exact: true })).toBeVisible();
    await expect(page.getByText(`On-chain refund #${state.refunds[0].onChainId}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
    expect(state.postCount).toBe(1);

    // ── Approve ────────────────────────────────────────────────
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Refund approved on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
    // Approved rows move on to Process and no longer offer Approve/Reject.
    await expect(page.getByRole("button", { name: "Process" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);

    // ── Process ────────────────────────────────────────────────
    await page.getByRole("button", { name: "Process" }).click();
    await expect(
      page.getByText("Refund processed on-chain — tokens returned"),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("PROCESSED", { exact: true })).toBeVisible();
    await expect(page.getByText("✅ Complete")).toBeVisible();
    // Each on-chain transition was mirrored onto the ledger row.
    expect(state.patchCount).toBe(2);
    expect(state.refunds[0].status).toBe("PROCESSED");

    // ── Reason-code round-trip in analytics ────────────────────
    await page.getByRole("tab", { name: "Analytics" }).click();
    await expect(page.getByText("Reason Code Analytics")).toBeVisible();
    const row = page.getByText(REASON_LABEL, { exact: true }).locator("..");
    await expect(row).toContainText("1");
  });

  test("rejects a requested refund and surfaces the terminal status", async ({
    page,
  }) => {
    const state = createRefundsState();
    const seeded = makeRefund(state, {
      paymentId: "77",
      reasonCode: 4,
      reason: "Customer changed their mind",
    });

    await openRefunds(page, state);

    await expect(page.getByText("Payment #77")).toBeVisible();
    await expect(page.getByText("REQUESTED", { exact: true })).toBeVisible();
    await expect(page.getByText(seeded.reason)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();

    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Refund rejected on-chain")).toBeVisible({
      timeout: 20000,
    });

    await expect(page.getByText("REJECTED", { exact: true })).toBeVisible();
    // Terminal state: no further lifecycle actions are offered.
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Process" })).toHaveCount(0);

    expect(state.patchCount).toBe(1);
    expect(state.refunds[0].status).toBe("REJECTED");
    expect(state.postCount).toBe(0); // seeded row — no on-chain request submitted
  });
});
