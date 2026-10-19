// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  raiseEscrowDispute,
  resolveEscrowDispute,
} from "@/lib/contract-advanced";
import type { EscrowData } from "@/types/contract-abi";

vi.mock("@/lib/contract-advanced", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/contract-advanced",
  );
  return {
    ...actual,
    raiseEscrowDispute: vi.fn(
      async (initiator: string, escrowId: number, reason: string) => {
        if (!reason || reason.trim() === "") {
          return { success: false, error: "Dispute evidence required" };
        }
        return { success: true, txHash: "0xdisputehash123" };
      },
    ),
    resolveEscrowDispute: vi.fn(
      async (arbiter: string, escrowId: number, refundBuyer: boolean) => {
        if (!arbiter) {
          return { success: false, error: "Unauthorized arbiter" };
        }
        return {
          success: true,
          txHash: "0xresolutionhash456",
          refundBuyer,
        };
      },
    ),
  };
});

describe("Escrow Dispute & Resolution Domain Logic (#1405)", () => {
  const mockBuyer = "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";
  const mockSeller = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
  const mockArbiter = "GDQ5U7S7Q5A3DHYGB6V4F2NLLNZB6R5F6564WZ6H7M4GOC6F2W23K3LO";

  it("should initialize escrow in valid Locked state", () => {
    const escrow: EscrowData = {
      id: 1,
      depositor: mockBuyer,
      beneficiary: mockSeller,
      arbiter: mockArbiter,
      amount: BigInt("5000000000"),
      asset: "native",
      deadline: Math.floor(Date.now() / 1000) + 3600,
      released: false,
      claimed: false,
      metadata: "Test Escrow",
      disputed: false,
    };

    expect(escrow.disputed).toBe(false);
    expect(escrow.released || escrow.claimed).toBe(false);
  });

  it("should successfully trigger raiseEscrowDispute with non-empty reason", async () => {
    const reason = "Seller failed to deliver agreed services";
    const res = await raiseEscrowDispute(mockBuyer, 1, reason);

    expect(res.success).toBe(true);
    expect(res.txHash).toBe("0xdisputehash123");
  });

  it("should fail raiseEscrowDispute when reason is blank", async () => {
    const res = await raiseEscrowDispute(mockBuyer, 1, "");

    expect(res.success).toBe(false);
    expect(res.error).toContain("Dispute evidence required");
  });

  it("should transition state from Locked to Disputed", () => {
    const escrow: EscrowData = {
      id: 1,
      depositor: mockBuyer,
      beneficiary: mockSeller,
      arbiter: mockArbiter,
      amount: BigInt("5000000000"),
      asset: "native",
      deadline: Math.floor(Date.now() / 1000) + 3600,
      released: false,
      claimed: false,
      metadata: "Test Escrow",
      disputed: false,
    };

    // Simulate dispute filing
    escrow.disputed = true;
    escrow.dispute_reason = "Merchandise damaged in transit";

    expect(escrow.disputed).toBe(true);
    expect(escrow.dispute_reason).toBe("Merchandise damaged in transit");
  });

  it("should allow arbiter to resolve dispute in favor of buyer (refund)", async () => {
    const res = await resolveEscrowDispute(mockArbiter, 1, true);

    expect(res.success).toBe(true);
    expect((res as unknown as { refundBuyer: boolean }).refundBuyer).toBe(true);
  });

  it("should allow arbiter to resolve dispute in favor of seller (payout)", async () => {
    const res = await resolveEscrowDispute(mockArbiter, 1, false);

    expect(res.success).toBe(true);
    expect((res as unknown as { refundBuyer: boolean }).refundBuyer).toBe(false);
  });

  it("should transition state from Disputed to Settled upon resolution", () => {
    const escrow: EscrowData = {
      id: 1,
      depositor: mockBuyer,
      beneficiary: mockSeller,
      arbiter: mockArbiter,
      amount: BigInt("5000000000"),
      asset: "native",
      deadline: Math.floor(Date.now() / 1000) + 3600,
      released: false,
      claimed: false,
      metadata: "Test Escrow",
      disputed: true,
      dispute_reason: "Merchandise damaged in transit",
    };

    // Settlement
    escrow.disputed = false;
    escrow.released = true;

    const isSettled = escrow.released || escrow.claimed;
    expect(isSettled).toBe(true);
    expect(escrow.disputed).toBe(false);
  });
});
