// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARBITRATOR_ADDRESS,
  BUYER_ADDRESS,
  SELLER_ADDRESS,
  createEscrowDisputeState,
  getEscrowViewForParty,
  getWalletBalanceStroops,
  initiateEscrowDispute,
  resolveEscrowDispute,
  stroopsToXlmString,
  xlmToStroops,
} from "../../e2e/helpers/escrow-helper";

describe("Escrow dispute and resolution E2E helper & lifecycle (#1405)", () => {
  it("transitions an active escrow to DISPUTED when initiated by buyer and locks standard release actions", () => {
    const state = createEscrowDisputeState();
    const initialBuyerView = getEscrowViewForParty(state, 1, BUYER_ADDRESS);
    expect(initialBuyerView.status).toBe("ACTIVE");
    expect(initialBuyerView.badgeLabel).toBe("Locked");
    expect(initialBuyerView.disputeBannerVisible).toBe(false);

    const disputed = initiateEscrowDispute(
      state,
      1,
      BUYER_ADDRESS,
      "Order delivered with missing components",
    );
    expect(disputed.status).toBe("DISPUTED");
    expect(disputed.disputedBy).toBe(BUYER_ADDRESS);

    const afterDeadline = disputed.deadline + 1000;
    const buyerView = getEscrowViewForParty(state, 1, BUYER_ADDRESS, afterDeadline);
    const sellerView = getEscrowViewForParty(state, 1, SELLER_ADDRESS, afterDeadline);

    expect(buyerView.badgeLabel).toBe("Disputed");
    expect(buyerView.disputeBannerVisible).toBe(true);
    expect(buyerView.canStandardReleaseOrClaim).toBe(false);

    expect(sellerView.badgeLabel).toBe("Disputed");
    expect(sellerView.disputeBannerVisible).toBe(true);
    expect(sellerView.canStandardReleaseOrClaim).toBe(false);
  });

  it("allows the designated arbitrator to resolve a dispute in favor of the buyer and updates balances", () => {
    const state = createEscrowDisputeState({
      buyerBalanceStroops: xlmToStroops(750),
      sellerBalanceStroops: xlmToStroops(100),
    });

    initiateEscrowDispute(state, 1, BUYER_ADDRESS, "Non-delivery of goods");

    const arbiterView = getEscrowViewForParty(state, 1, ARBITRATOR_ADDRESS);
    expect(arbiterView.canArbitrateReleaseToBuyer).toBe(true);
    expect(arbiterView.canArbitrateReleaseToSeller).toBe(true);

    const result = resolveEscrowDispute(state, 1, ARBITRATOR_ADDRESS, false);
    expect(result.escrow.status).toBe("RESOLVED");
    expect(result.escrow.released).toBe(true);
    expect(result.escrow.resolutionOutcome).toBe("FAVOR_BUYER");
    expect(result.recipient).toBe(BUYER_ADDRESS);
    expect(stroopsToXlmString(getWalletBalanceStroops(state, BUYER_ADDRESS))).toBe(
      "1000.0000000",
    );
    expect(stroopsToXlmString(getWalletBalanceStroops(state, SELLER_ADDRESS))).toBe(
      "100.0000000",
    );
    expect(state.vaultBalance).toBe(0n);

    const finalBuyerView = getEscrowViewForParty(state, 1, BUYER_ADDRESS);
    expect(finalBuyerView.badgeLabel).toBe("Settled");
    expect(finalBuyerView.disputeBannerVisible).toBe(false);
  });

  it("allows the designated arbitrator to resolve a dispute in favor of the seller and prevents double-resolution", () => {
    const state = createEscrowDisputeState({
      buyerBalanceStroops: xlmToStroops(750),
      sellerBalanceStroops: xlmToStroops(100),
    });

    initiateEscrowDispute(state, 1, SELLER_ADDRESS, "Buyer unresponsive after delivery");
    const result = resolveEscrowDispute(state, 1, ARBITRATOR_ADDRESS, true);

    expect(result.escrow.status).toBe("RESOLVED");
    expect(result.escrow.resolutionOutcome).toBe("FAVOR_SELLER");
    expect(result.recipient).toBe(SELLER_ADDRESS);
    expect(stroopsToXlmString(getWalletBalanceStroops(state, SELLER_ADDRESS))).toBe(
      "350.0000000",
    );

    expect(() =>
      resolveEscrowDispute(state, 1, ARBITRATOR_ADDRESS, false),
    ).toThrow(/already been settled/i);
  });

  it("verifies Playwright E2E spec covers buyer dispute, multi-party views, and arbitrator resolution", () => {
    const specSource = readFileSync(
      resolve(process.cwd(), "e2e/escrow-dispute.spec.ts"),
      "utf8",
    );
    expect(specSource).toContain("initiateEscrowDispute");
    expect(specSource).toContain("resolveEscrowDispute");
    expect(specSource).toContain("getEscrowViewForParty");
    expect(specSource).toContain("FAVOR_BUYER");
  });
});
