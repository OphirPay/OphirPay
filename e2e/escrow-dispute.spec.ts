// SPDX-License-Identifier: MIT
import { test, expect } from "@playwright/test";
import {
  ARBITRATOR_ADDRESS,
  BUYER_ADDRESS,
  SELLER_ADDRESS,
  createEscrowDisputeState,
  getEscrowViewForParty,
  getWalletBalanceStroops,
  initiateEscrowDispute,
  installEscrowDisputeMocks,
  resolveEscrowDispute,
  stroopsToXlmString,
  xlmToStroops,
} from "./helpers/escrow-helper";
import { installFreighterMock } from "./helpers/stellar-mock";

test.describe("Escrow Dispute & Resolution E2E Suite (#1405)", () => {
  test("buyer initiates a dispute on an active escrow and locks standard release actions across buyer and seller views", async ({
    page,
  }) => {
    const state = createEscrowDisputeState({
      activeActor: BUYER_ADDRESS,
    });

    await installFreighterMock(page, { publicKey: BUYER_ADDRESS });
    await installEscrowDisputeMocks(page, state);

    // 1. Verify initial ACTIVE state for both buyer and seller
    const initialBuyerView = getEscrowViewForParty(state, 1, BUYER_ADDRESS);
    const initialSellerView = getEscrowViewForParty(state, 1, SELLER_ADDRESS);
    expect(initialBuyerView.status).toBe("ACTIVE");
    expect(initialBuyerView.badgeLabel).toBe("Locked");
    expect(initialBuyerView.disputeBannerVisible).toBe(false);
    expect(initialBuyerView.canInitiateDispute).toBe(true);
    expect(initialSellerView.status).toBe("ACTIVE");

    await page.goto("/escrows", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Escrows" })).toBeVisible();
    await expect(page.getByText("Escrow #1")).toBeVisible();
    await expect(page.getByText("Locked")).toBeVisible();

    // 2. Buyer initiates dispute via API/UI workflow
    const disputeReason = "Damaged shipment — serial numbers do not match invoice";
    const disputedRecord = initiateEscrowDispute(
      state,
      1,
      BUYER_ADDRESS,
      disputeReason,
    );

    expect(disputedRecord.status).toBe("DISPUTED");
    expect(disputedRecord.disputedBy).toBe(BUYER_ADDRESS);
    expect(disputedRecord.disputeReason).toBe(disputeReason);

    // 3. Verify status updates & UI indicators across buyer and seller views
    const nowAfterDeadline = disputedRecord.deadline + 3600;
    const buyerDisputedView = getEscrowViewForParty(
      state,
      1,
      BUYER_ADDRESS,
      nowAfterDeadline,
    );
    const sellerDisputedView = getEscrowViewForParty(
      state,
      1,
      SELLER_ADDRESS,
      nowAfterDeadline,
    );

    expect(buyerDisputedView.status).toBe("DISPUTED");
    expect(buyerDisputedView.badgeLabel).toBe("Disputed");
    expect(buyerDisputedView.disputeBannerVisible).toBe(true);
    expect(buyerDisputedView.disputeBannerText).toContain(disputeReason);
    expect(buyerDisputedView.canStandardReleaseOrClaim).toBe(false);

    expect(sellerDisputedView.status).toBe("DISPUTED");
    expect(sellerDisputedView.badgeLabel).toBe("Disputed");
    expect(sellerDisputedView.disputeBannerVisible).toBe(true);
    // Even after deadline, seller cannot claim while escrow is DISPUTED
    expect(sellerDisputedView.canStandardReleaseOrClaim).toBe(false);

    // Reload page to verify updated dispute metadata renders on-screen
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(`[DISPUTED] ${disputeReason}`)).toBeVisible();
  });

  test("arbitrator resolves disputed escrow in favor of the buyer and settles wallet balances", async ({
    page,
  }) => {
    const escrowAmount = xlmToStroops(250);
    const initialBuyerBalance = xlmToStroops(750);
    const initialSellerBalance = xlmToStroops(100);

    const state = createEscrowDisputeState({
      buyerBalanceStroops: initialBuyerBalance,
      sellerBalanceStroops: initialSellerBalance,
      activeActor: BUYER_ADDRESS,
    });

    // Step 1: Buyer initiates dispute on Escrow #1
    initiateEscrowDispute(
      state,
      1,
      BUYER_ADDRESS,
      "Undelivered milestone — requesting full refund via arbiter",
    );

    // Step 2: Switch active session to the designated Arbitrator account
    state.activeActor = ARBITRATOR_ADDRESS;
    await installFreighterMock(page, { publicKey: ARBITRATOR_ADDRESS });
    await installEscrowDisputeMocks(page, state);

    const arbiterDisputedView = getEscrowViewForParty(
      state,
      1,
      ARBITRATOR_ADDRESS,
    );
    expect(arbiterDisputedView.role).toBe("arbitrator");
    expect(arbiterDisputedView.disputeBannerVisible).toBe(true);
    expect(arbiterDisputedView.canArbitrateReleaseToBuyer).toBe(true);
    expect(arbiterDisputedView.canArbitrateReleaseToSeller).toBe(true);
    expect(arbiterDisputedView.canStandardReleaseOrClaim).toBe(false);

    // Step 3: Arbitrator resolves dispute in favor of the buyer (releaseToBeneficiary = false)
    const resolution = resolveEscrowDispute(
      state,
      1,
      ARBITRATOR_ADDRESS,
      false,
    );

    expect(resolution.escrow.status).toBe("RESOLVED");
    expect(resolution.escrow.released).toBe(true);
    expect(resolution.escrow.resolutionOutcome).toBe("FAVOR_BUYER");
    expect(resolution.escrow.resolvedBy).toBe(ARBITRATOR_ADDRESS);
    expect(resolution.recipient).toBe(BUYER_ADDRESS);
    expect(resolution.amountStroops).toBe(escrowAmount);

    // Verify wallet balance changes: buyer receives 250 XLM refund (750 + 250 = 1000 XLM)
    expect(getWalletBalanceStroops(state, BUYER_ADDRESS)).toBe(
      initialBuyerBalance + escrowAmount,
    );
    expect(
      stroopsToXlmString(getWalletBalanceStroops(state, BUYER_ADDRESS)),
    ).toBe("1000.0000000");
    // Seller balance remains unchanged at 100 XLM
    expect(getWalletBalanceStroops(state, SELLER_ADDRESS)).toBe(
      initialSellerBalance,
    );
    // Escrow contract vault balance is now 0
    expect(state.vaultBalance).toBe(0n);

    // Step 4: Verify UI reflects Settled badge and hides action buttons
    await page.goto("/escrows", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Escrow #1")).toBeVisible();
    await expect(page.getByText("Settled")).toBeVisible();
    await expect(
      page.getByText("[RESOLVED: FAVOR_BUYER] Refunded to buyer by arbiter"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Return to depositor" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Release to beneficiary" }),
    ).toHaveCount(0);
  });

  test("rejects unauthorized dispute resolution from non-arbitrator accounts", async () => {
    const state = createEscrowDisputeState({
      activeActor: BUYER_ADDRESS,
    });

    initiateEscrowDispute(
      state,
      1,
      BUYER_ADDRESS,
      "Specification mismatch on delivered batch",
    );

    // Seller or buyer attempting to self-resolve as arbitrator must fail
    expect(() =>
      resolveEscrowDispute(state, 1, SELLER_ADDRESS, true),
    ).toThrow(/only the designated arbitrator/i);

    expect(() =>
      resolveEscrowDispute(state, 1, BUYER_ADDRESS, false),
    ).toThrow(/only the designated arbitrator/i);

    // Escrow remains DISPUTED and funds remain locked in the vault
    expect(state.escrows[0].status).toBe("DISPUTED");
    expect(state.escrows[0].released).toBe(false);
    expect(state.vaultBalance).toBe(xlmToStroops(250));
  });
});
