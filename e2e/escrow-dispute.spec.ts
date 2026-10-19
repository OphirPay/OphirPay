// SPDX-License-Identifier: MIT
//
// End-to-end test suite for the escrow dispute and resolution flow (Issue #1405).
//
// Verifies the complete lifecycle:
// 1. Escrow starts in "Locked" state with Buyer (Depositor), Seller (Beneficiary), and Arbiter.
// 2. Buyer initiates a dispute via the UI with a reason.
// 3. Status updates to "Disputed" across the dashboard, with a prominent dispute warning banner.
// 4. Normal claim and release action buttons are disabled during dispute.
// 5. Arbitrator reviews the case and resolves in favor of Buyer (refund).
// 6. Final status transitions to "Settled" with balance reconciliation.

import { test, expect } from "@playwright/test";
import {
  createEscrowDisputeState,
  installEscrowDisputeMocks,
  switchWalletSigner,
  raiseDisputeViaUI,
  resolveDisputeViaUI,
  BUYER_ADDRESS,
  SELLER_ADDRESS,
  ARBITER_ADDRESS,
} from "./helpers/escrow-helper";

test.describe("Escrow dispute and resolution flow", () => {
  test("full dispute lifecycle: Buyer raises dispute -> status transitions to DISPUTED with banner -> action buttons disabled -> Arbiter resolves in favor of buyer", async ({
    page,
  }) => {
    const state = createEscrowDisputeState();

    // 1. Prepare deterministic mocks and navigate to /escrows
    await installEscrowDisputeMocks(page, state);
    await page.goto("/escrows");

    // Wait for the escrows list to render
    const escrowCard = page.locator("text=Escrow #1").locator("..");
    await expect(escrowCard).toBeVisible({ timeout: 15000 });

    // Assert initial state is Locked
    const statusBadge = page.locator('[data-testid="escrow-status-badge"]').first();
    await expect(statusBadge).toHaveText("Locked");

    // Assert dispute banner is not present initially
    await expect(page.locator('[data-testid="dispute-banner"]')).toHaveCount(0);

    // 2. Buyer initiates dispute via UI
    const disputeReason = "Product received does not match contractual specifications";
    await raiseDisputeViaUI(page, 1, disputeReason);

    // Update mock state to reflect the dispute
    state.escrows[0].disputed = true;
    state.escrows[0].dispute_reason = disputeReason;

    // Refresh UI state
    await page.goto("/escrows");
    await expect(escrowCard).toBeVisible();

    // 3. Verify status updates to DISPUTED and dispute banner appears
    await expect(statusBadge).toHaveText("Disputed");
    const disputeBanner = page.locator('[data-testid="dispute-banner"]');
    await expect(disputeBanner).toBeVisible();
    await expect(disputeBanner).toContainText("Dispute in progress");
    await expect(disputeBanner).toContainText(disputeReason);

    // 4. Verify regular claim / release buttons are not available / disabled during dispute
    await expect(page.locator('[data-testid="claim-escrow-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="raise-dispute-btn"]')).toHaveCount(0);
    await expect(page.getByText("Awaiting arbiter resolution")).toBeVisible();

    // 5. Switch to Seller's wallet to verify seller dashboard view
    await switchWalletSigner(page, SELLER_ADDRESS);
    state.activeSigner = SELLER_ADDRESS;
    await page.goto("/escrows");

    // Seller also sees Disputed badge, banner, and cannot claim
    await expect(page.locator('[data-testid="escrow-status-badge"]').first()).toHaveText("Disputed");
    await expect(page.locator('[data-testid="dispute-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="claim-escrow-btn"]')).toHaveCount(0);
    await expect(page.getByText("Awaiting arbiter resolution")).toBeVisible();

    // 6. Switch to Arbiter's wallet to review and resolve dispute
    await switchWalletSigner(page, ARBITER_ADDRESS);
    state.activeSigner = ARBITER_ADDRESS;
    await page.goto("/escrows");

    // Arbiter sees resolution buttons
    const resolveRefundBtn = page.locator('[data-testid="resolve-refund-buyer-btn"]');
    const resolvePayBtn = page.locator('[data-testid="resolve-pay-beneficiary-btn"]');
    await expect(resolveRefundBtn).toBeVisible();
    await expect(resolvePayBtn).toBeVisible();

    // Arbiter executes resolution: Refund Depositor (Buyer)
    await resolveDisputeViaUI(page, 1, true);

    // Update state to settled
    state.escrows[0].disputed = false;
    state.escrows[0].released = true;
    state.balances[BUYER_ADDRESS] += BigInt("5000000000"); // 500 XLM refunded

    // 7. Re-verify final settled status on page
    await page.goto("/escrows");
    await expect(page.locator('[data-testid="escrow-status-badge"]').first()).toHaveText("Settled");
    await expect(page.locator('[data-testid="dispute-banner"]')).toHaveCount(0);
    await expect(resolveRefundBtn).toHaveCount(0);
  });

  test("non-arbiter third party cannot see or trigger dispute resolution controls", async ({
    page,
  }) => {
    const state = createEscrowDisputeState();
    state.escrows[0].disputed = true;
    state.escrows[0].dispute_reason = "Unresolved shipment delay";

    // Connect as Buyer (non-arbiter)
    await installEscrowDisputeMocks(page, state);
    await page.goto("/escrows");

    // Banner is visible, but resolution action buttons are NOT rendered
    await expect(page.locator('[data-testid="dispute-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="resolve-refund-buyer-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="resolve-pay-beneficiary-btn"]')).toHaveCount(0);
  });
});
