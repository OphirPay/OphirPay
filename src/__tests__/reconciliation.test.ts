// SPDX-License-Identifier: MIT

import { reconcilePendingPayments } from "@/lib/reconciliation";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  payment: {
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
}));

jest.mock("@/lib/stellar", () => ({
  getHorizonServer: jest.fn(() => ({
    transactions: () => ({
      transaction: (hash: string) => ({
        call: jest.fn().mockImplementation(async () => {
          if (hash === "tx_success") {
            return { id: "tx_success", successful: true };
          }
          if (hash === "tx_failed") {
            return { id: "tx_failed", successful: false };
          }
          if (hash === "tx_not_found") {
            const err = new Error("Resource Missing");
            (err as unknown as { response: { status: number } }).response = { status: 404 };
            throw err;
          }
          return { id: hash, successful: true };
        }),
      }),
    }),
  })),
}));

describe("Transaction Status Reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns zero counts when no pending payments exist", async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await reconcilePendingPayments();
    expect(result.totalChecked).toBe(0);
    expect(result.completedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it("updates successful on-chain transaction to COMPLETED", async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "pay_1",
        txHash: "tx_success",
        status: "PENDING",
        createdAt: new Date(),
      },
    ]);

    const result = await reconcilePendingPayments();
    expect(result.totalChecked).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("updates failed on-chain transaction to FAILED", async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "pay_2",
        txHash: "tx_failed",
        status: "SUBMITTED",
        createdAt: new Date(),
      },
    ]);

    const result = await reconcilePendingPayments();
    expect(result.totalChecked).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_2" },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("marks timed out missing transactions as FAILED", async () => {
    const oldDate = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "pay_3",
        txHash: "tx_not_found",
        status: "PENDING",
        createdAt: oldDate,
      },
    ]);

    const result = await reconcilePendingPayments({ maxAgeMinutes: 10 });
    expect(result.totalChecked).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_3" },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});
