// SPDX-License-Identifier: MIT

import {
  estimateTotalPaymentFees,
  stroopsToXlm,
  estimateBatchFee,
} from "@/lib/fee-estimator";

describe("Fee Estimator Lib & Calculations", () => {
  it("converts stroops to XLM string correctly", () => {
    expect(stroopsToXlm(10_000_000n)).toBe("1");
    expect(stroopsToXlm(100n)).toBe("0.00001");
    expect(stroopsToXlm(15_500_000n)).toBe("1.55");
    expect(stroopsToXlm(0n)).toBe("0");
  });

  it("estimates fees for a single payment with default protocol fee", async () => {
    const res = await estimateTotalPaymentFees({
      paymentType: "single",
      amountStroops: "10000000", // 1 XLM
      protocolFeeBps: 25, // 0.25% = 25,000 stroops
    });

    expect(res.paymentType).toBe("single");
    expect(res.operations).toBe(1);
    expect(res.breakdown.networkFeeStroops).toBe("100");
    expect(res.breakdown.protocolFeeStroops).toBe("25000");
    expect(res.breakdown.totalEstimatedFeeStroops).toBe("25100");
    expect(res.warning).toBeNull();
  });

  it("scales batch fee linearly with recipient count", async () => {
    const res = await estimateTotalPaymentFees({
      paymentType: "batch",
      recipientCount: 10,
    });

    expect(res.paymentType).toBe("batch");
    expect(res.operations).toBe(10);
    expect(res.breakdown.networkFeeStroops).toBe("1000");
    expect(estimateBatchFee(10, 100)).toBe("1000");
  });

  it("calculates scheduled payment fees with interval operations", async () => {
    const res = await estimateTotalPaymentFees({
      paymentType: "scheduled",
      scheduledIntervals: 5,
    });

    expect(res.paymentType).toBe("scheduled");
    expect(res.operations).toBe(6); // 1 setup + 5 intervals
    expect(res.breakdown.networkFeeStroops).toBe("600");
  });

  it("triggers warning when fee exceeds maxFeeThreshold", async () => {
    const res = await estimateTotalPaymentFees({
      paymentType: "batch",
      recipientCount: 100,
      amountStroops: "10000000000",
      maxFeeThresholdStroops: "5000", // low threshold
    });

    expect(res.warning).toContain("exceeds maximum threshold");
  });
});
