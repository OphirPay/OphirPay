// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createScheduledPaymentSchema } from "@/lib/validation-schemas";
import {
  pickDueScheduledPayments,
  executeDueScheduledPayments,
} from "@/lib/scheduled-payments";

// ── Prisma mock ────────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  scheduledPayment: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

// ── Fixtures ───────────────────────────────────────────────────

const ADDRESS = "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4";

function duePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm_sched_1",
    userId: "user_1",
    amount: { toString: () => "100" },
    assetCode: "XLM",
    assetIssuer: null,
    destAddress: ADDRESS,
    memo: null,
    scheduledFor: new Date(Date.now() - 60_000),
    status: "SCHEDULED",
    transactionHash: null,
    errorMessage: null,
    executedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("createScheduledPaymentSchema", () => {
  const base = {
    amount: 100,
    destAddress: ADDRESS,
    scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
  };

  it("accepts a valid future schedule", () => {
    const result = createScheduledPaymentSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assetCode).toBe("XLM");
    }
  });

  it("rejects a past scheduled date", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...base,
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(
        "Scheduled date must be in the future"
      );
    }
  });

  it("rejects an invalid date string", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...base,
      scheduledFor: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid recipient address", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...base,
      destAddress: "not-an-address",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...base,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("pickDueScheduledPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects only SCHEDULED rows whose date has passed", async () => {
    const now = new Date("2026-08-27T12:00:00Z");
    prismaMock.scheduledPayment.findMany.mockResolvedValue([
      duePayment(),
    ]);

    await pickDueScheduledPayments(now, 10);

    expect(prismaMock.scheduledPayment.findMany).toHaveBeenCalledWith({
      where: {
        status: "SCHEDULED",
        scheduledFor: { lte: now },
      },
      orderBy: { scheduledFor: "asc" },
      take: 10,
    });
  });
});

describe("executeDueScheduledPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks an executed payment EXECUTED with the tx hash", async () => {
    prismaMock.scheduledPayment.findMany.mockResolvedValue([duePayment()]);
    prismaMock.scheduledPayment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.scheduledPayment.update.mockResolvedValue({});
    const submit = vi.fn().mockResolvedValue("txhash123");

    const summary = await executeDueScheduledPayments(new Date(), 20, submit);

    expect(summary).toEqual({
      picked: 1,
      executed: 1,
      failed: 0,
      results: [
        { id: "cm_sched_1", status: "EXECUTED", transactionHash: "txhash123" },
      ],
    });

    // Claimed (SCHEDULED → PROCESSING) before submission
    expect(prismaMock.scheduledPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "cm_sched_1", status: "SCHEDULED" },
      data: { status: "PROCESSING" },
    });
    // Final update carries the hash + executedAt
    const finalUpdate = prismaMock.scheduledPayment.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(finalUpdate.where).toEqual({ id: "cm_sched_1" });
    expect(finalUpdate.data.status).toBe("EXECUTED");
    expect(finalUpdate.data.transactionHash).toBe("txhash123");
    expect(finalUpdate.data.executedAt).toBeInstanceOf(Date);
  });

  it("marks a failed payment FAILED with the error message", async () => {
    prismaMock.scheduledPayment.findMany.mockResolvedValue([duePayment()]);
    prismaMock.scheduledPayment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.scheduledPayment.update.mockResolvedValue({});
    const submit = vi.fn().mockRejectedValue(new Error("insufficient balance"));

    const summary = await executeDueScheduledPayments(new Date(), 20, submit);

    expect(summary.executed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({
      id: "cm_sched_1",
      status: "FAILED",
      error: "insufficient balance",
    });

    const failedUpdate = prismaMock.scheduledPayment.update.mock
      .calls[0][0] as { data: Record<string, unknown> };
    expect(failedUpdate.data.status).toBe("FAILED");
    expect(failedUpdate.data.errorMessage).toBe("insufficient balance");
  });

  it("skips rows already claimed by a concurrent cron run", async () => {
    prismaMock.scheduledPayment.findMany.mockResolvedValue([
      duePayment(),
      duePayment({ id: "cm_sched_2" }),
    ]);
    // Only the first row is claimable — the second was claimed elsewhere.
    prismaMock.scheduledPayment.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.scheduledPayment.update.mockResolvedValue({});
    const submit = vi.fn().mockResolvedValue("txhash123");

    const summary = await executeDueScheduledPayments(new Date(), 20, submit);

    expect(summary.picked).toBe(2);
    expect(summary.executed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
