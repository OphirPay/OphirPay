// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  nextRunAfter,
  scheduleRunKey,
  claimDueRecurrences,
  createRunPayment,
} from "@/lib/recurring-scheduler";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    recurrence: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
    payment: { create: mocks.create },
  },
}));

function makeRecurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec_1",
    nextRunAt: new Date("2026-08-29T00:00:00Z"),
    frequency: "DAILY",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("nextRunAfter", () => {
  it("advances daily/weekly/biweekly/monthly correctly (UTC)", () => {
    const base = new Date("2026-08-29T12:00:00Z");
    expect(nextRunAfter(base, "DAILY").toISOString()).toBe("2026-08-30T12:00:00.000Z");
    expect(nextRunAfter(base, "WEEKLY").toISOString()).toBe("2026-09-05T12:00:00.000Z");
    expect(nextRunAfter(base, "BIWEEKLY").toISOString()).toBe("2026-09-12T12:00:00.000Z");
    expect(nextRunAfter(base, "MONTHLY").toISOString()).toBe("2026-09-29T12:00:00.000Z");
  });
});

describe("scheduleRunKey", () => {
  it("is deterministic per (recurrence, scheduled time)", () => {
    const t = new Date("2026-08-29T00:00:00Z");
    expect(scheduleRunKey("rec_1", t)).toBe(scheduleRunKey("rec_1", new Date(t.getTime())));
    expect(scheduleRunKey("rec_1", t)).toBe("rec_1:1787961600000");
  });
});

describe("claimDueRecurrences — at-most-once CAS", () => {
  it("claims only the runs whose CAS update wins", async () => {
    mocks.findMany.mockResolvedValue([
      makeRecurrence(),
      makeRecurrence({ id: "rec_2", nextRunAt: new Date("2026-08-28T00:00:00Z"), frequency: "WEEKLY" }),
    ]);
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 }) // rec_1 won
      .mockResolvedValueOnce({ count: 0 }); // rec_2 lost a race

    const owned = await claimDueRecurrences(new Date("2026-08-29T01:00:00Z"));
    expect(owned).toHaveLength(1);
    expect(owned[0].recurrenceId).toBe("rec_1");
    expect(owned[0].scheduledAt.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });

  it("passes the original nextRunAt as the CAS guard", async () => {
    mocks.findMany.mockResolvedValue([makeRecurrence()]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await claimDueRecurrences(new Date("2026-08-29T01:00:00Z"));
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nextRunAt: new Date("2026-08-29T00:00:00Z") }),
      }),
    );
  });

  it("only considers active, due recurrences", async () => {
    mocks.findMany.mockResolvedValue([]);
    await claimDueRecurrences(new Date());
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, nextRunAt: { lte: expect.any(Date) } },
      }),
    );
  });
});

describe("createRunPayment — dedupe", () => {
  it("creates the payment with a deterministic scheduleRunKey", async () => {
    mocks.findUnique.mockResolvedValue({ id: "rec_1", isActive: true });
    mocks.create.mockResolvedValue({ id: "pay_1" });

    const outcome = await createRunPayment(
      { recurrenceId: "rec_1", scheduledAt: new Date("2026-08-29T00:00:00Z") },
      { userId: "u1", amount: "10.5", assetCode: "XLM", assetIssuer: null, destAddress: "GABC" },
    );
    expect(outcome).toBe("created");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SCHEDULED",
          scheduleRunKey: "rec_1:1787961600000",
        }),
      }),
    );
  });

  it("returns duplicate on P2002 (another worker won)", async () => {
    mocks.findUnique.mockResolvedValue({ id: "rec_1", isActive: true });
    mocks.create.mockRejectedValue({ code: "P2002" });
    const outcome = await createRunPayment(
      { recurrenceId: "rec_1", scheduledAt: new Date("2026-08-29T00:00:00Z") },
      { userId: "u1", amount: "1", assetCode: "XLM", assetIssuer: null, destAddress: "GABC" },
    );
    expect(outcome).toBe("duplicate");
  });

  it("returns null when the recurrence was deleted mid-race", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const outcome = await createRunPayment(
      { recurrenceId: "rec_1", scheduledAt: new Date("2026-08-29T00:00:00Z") },
      { userId: "u1", amount: "1", assetCode: "XLM", assetIssuer: null, destAddress: "GABC" },
    );
    expect(outcome).toBeNull();
  });
});
