// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  computeVested,
  computeClaimable,
  computeUnvested,
  computeRemaining,
  computeVestingProgress,
  getStreamStatus,
  normalizeStream,
  stroopsToDecimal,
  decimalToStroops,
  formatStroopAmount,
  STROOPS_PER_XLM,
} from "@/lib/streams";

describe("Payment Stream Linear Vesting Contract Parity", () => {
  const TOTAL_AMOUNT = BigInt(1_000_000_000); // 100 XLM (in stroops)
  const START_TIME = 1_000_000;
  const DURATION = 10_000; // 10,000 seconds
  const END_TIME = START_TIME + DURATION;

  describe("computeVested (mirrors Rust compute_vested)", () => {
    it("returns 0 before the stream starts", () => {
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, START_TIME - 100)).toBe(BigInt(0));
    });

    it("returns 0 at the exact start timestamp", () => {
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, START_TIME)).toBe(BigInt(0));
    });

    it("returns exactly 50% at the halfway mark", () => {
      const midpoint = START_TIME + DURATION / 2;
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, midpoint)).toBe(BigInt(500_000_000));
    });

    it("returns exactly 25% at one-quarter elapsed", () => {
      const quarter = START_TIME + DURATION / 4;
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, quarter)).toBe(BigInt(250_000_000));
    });

    it("returns full total_amount at the exact end time", () => {
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, END_TIME)).toBe(TOTAL_AMOUNT);
    });

    it("returns full total_amount when current time is past the end time", () => {
      expect(computeVested(TOTAL_AMOUNT, START_TIME, END_TIME, END_TIME + 5000)).toBe(TOTAL_AMOUNT);
    });

    it("handles zero total duration safely by returning total_amount", () => {
      expect(computeVested(TOTAL_AMOUNT, START_TIME, START_TIME, START_TIME)).toBe(TOTAL_AMOUNT);
    });

    it("handles huge amounts without integer overflow", () => {
      const hugeAmount = BigInt("10000000000000000000"); // 10^19 stroops (1 trillion XLM)
      const halfway = START_TIME + DURATION / 2;
      expect(computeVested(hugeAmount, START_TIME, END_TIME, halfway)).toBe(BigInt("5000000000000000000"));
    });
  });

  describe("computeClaimable (mirrors Rust claim_stream check)", () => {
    it("returns full vested amount when no claims have occurred", () => {
      const halfway = START_TIME + DURATION / 2;
      const claimable = computeClaimable(TOTAL_AMOUNT, BigInt(0), START_TIME, END_TIME, halfway);
      expect(claimable).toBe(BigInt(500_000_000));
    });

    it("subtracts previously claimed amounts from vested", () => {
      const halfway = START_TIME + DURATION / 2;
      const alreadyClaimed = BigInt(200_000_000);
      const claimable = computeClaimable(TOTAL_AMOUNT, alreadyClaimed, START_TIME, END_TIME, halfway);
      expect(claimable).toBe(BigInt(300_000_000));
    });

    it("returns 0 when recipient has already claimed everything currently vested", () => {
      const halfway = START_TIME + DURATION / 2;
      const alreadyClaimed = BigInt(500_000_000);
      const claimable = computeClaimable(TOTAL_AMOUNT, alreadyClaimed, START_TIME, END_TIME, halfway);
      expect(claimable).toBe(BigInt(0));
    });

    it("returns 0 if the stream was cancelled (matching StreamAlreadyCancelled error)", () => {
      const halfway = START_TIME + DURATION / 2;
      const claimable = computeClaimable(TOTAL_AMOUNT, BigInt(0), START_TIME, END_TIME, halfway, true);
      expect(claimable).toBe(BigInt(0));
    });

    it("returns remaining unclaimed tokens once stream is finished", () => {
      const alreadyClaimed = BigInt(400_000_000);
      const claimable = computeClaimable(TOTAL_AMOUNT, alreadyClaimed, START_TIME, END_TIME, END_TIME + 100);
      expect(claimable).toBe(BigInt(600_000_000));
    });
  });

  describe("computeRemaining and computeUnvested (mirrors cancel_stream refund)", () => {
    it("calculates remaining tokens correctly", () => {
      expect(computeRemaining(TOTAL_AMOUNT, BigInt(300_000_000))).toBe(BigInt(700_000_000));
      expect(computeRemaining(TOTAL_AMOUNT, TOTAL_AMOUNT)).toBe(BigInt(0));
    });

    it("calculates unvested tokens refunded to creator upon cancellation", () => {
      const quarter = START_TIME + DURATION / 4;
      const unvested = computeUnvested(TOTAL_AMOUNT, START_TIME, END_TIME, quarter);
      expect(unvested).toBe(BigInt(750_000_000));
    });
  });

  describe("computeVestingProgress", () => {
    it("returns 0% before start", () => {
      expect(computeVestingProgress(START_TIME, END_TIME, START_TIME - 10)).toBe(0);
    });

    it("returns 50% at midpoint", () => {
      expect(computeVestingProgress(START_TIME, END_TIME, START_TIME + DURATION / 2)).toBe(50);
    });

    it("returns 100% at end time", () => {
      expect(computeVestingProgress(START_TIME, END_TIME, END_TIME)).toBe(100);
    });

    it("caps at 100% past end time", () => {
      expect(computeVestingProgress(START_TIME, END_TIME, END_TIME + 1000)).toBe(100);
    });
  });

  describe("getStreamStatus", () => {
    it("identifies CANCELLED streams", () => {
      expect(
        getStreamStatus({
          cancelled: true,
          startTime: START_TIME,
          endTime: END_TIME,
          totalAmount: "1000",
          claimedAmount: "0",
        })
      ).toBe("CANCELLED");
    });

    it("identifies PENDING streams before start", () => {
      expect(
        getStreamStatus(
          {
            cancelled: false,
            startTime: START_TIME,
            endTime: END_TIME,
            totalAmount: "1000",
            claimedAmount: "0",
          },
          START_TIME - 10
        )
      ).toBe("PENDING");
    });

    it("identifies ACTIVE streams in progress", () => {
      expect(
        getStreamStatus(
          {
            cancelled: false,
            startTime: START_TIME,
            endTime: END_TIME,
            totalAmount: "1000",
            claimedAmount: "100",
          },
          START_TIME + 100
        )
      ).toBe("ACTIVE");
    });

    it("identifies COMPLETED streams when fully claimed or duration ended", () => {
      expect(
        getStreamStatus(
          {
            cancelled: false,
            startTime: START_TIME,
            endTime: END_TIME,
            totalAmount: "1000",
            claimedAmount: "1000",
          },
          START_TIME + 100
        )
      ).toBe("COMPLETED");

      expect(
        getStreamStatus(
          {
            cancelled: false,
            startTime: START_TIME,
            endTime: END_TIME,
            totalAmount: "1000",
            claimedAmount: "1000",
          },
          END_TIME + 100
        )
      ).toBe("COMPLETED");
    });
  });

  describe("normalizeStream and conversion helpers", () => {
    it("normalizes snake_case contract return value", () => {
      const raw = {
        id: 7,
        creator: "G_CREATOR",
        recipient: "G_RECIPIENT",
        total_amount: "50000000",
        claimed_amount: "10000000",
        asset: "native",
        start_time: 1700000000,
        end_time: 1700100000,
        cancelled: false,
        metadata: "Contract stream test",
      };

      const normalized = normalizeStream(raw);
      expect(normalized.id).toBe(7);
      expect(normalized.creator).toBe("G_CREATOR");
      expect(normalized.recipient).toBe("G_RECIPIENT");
      expect(normalized.totalAmount).toBe("50000000");
      expect(normalized.claimedAmount).toBe("10000000");
      expect(normalized.startTime).toBe(1700000000);
      expect(normalized.endTime).toBe(1700100000);
      expect(normalized.cancelled).toBe(false);
      expect(normalized.metadata).toBe("Contract stream test");
    });

    it("converts decimal XLM to stroops and back accurately", () => {
      expect(decimalToStroops(50.5)).toBe(BigInt(505_000_000));
      expect(stroopsToDecimal(BigInt(505_000_000))).toBe(50.5);
      expect(formatStroopAmount(BigInt(505_000_000))).toBe("50.50");
    });
  });
});
