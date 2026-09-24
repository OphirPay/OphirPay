// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRequestOverdue,
  canSendReminder,
  transitionOverduePaymentRequests,
  markPaymentRequestPaid,
  sendPaymentRequestReminder,
  DEFAULT_REMINDER_COOLDOWN_MS,
  MAX_REMINDERS_PER_REQUEST,
} from "@/lib/payment-requests";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import * as webhookDispatcher from "@/lib/webhook-dispatcher";
import { NOTIFY } from "@/lib/notifications";

describe("Payment Request Expiration - Pure Logic", () => {
  const baseTime = new Date("2026-09-24T12:00:00Z");

  describe("isRequestOverdue", () => {
    it("returns false when no due date or expiration date is set", () => {
      expect(isRequestOverdue({ status: "PENDING" }, baseTime)).toBe(false);
    });

    it("returns false when due date is in the future", () => {
      const futureDue = new Date("2026-09-24T13:00:00Z");
      expect(
        isRequestOverdue({ status: "PENDING", dueDate: futureDue }, baseTime)
      ).toBe(false);
    });

    it("returns true when due date has passed", () => {
      const pastDue = new Date("2026-09-24T11:00:00Z");
      expect(
        isRequestOverdue({ status: "PENDING", dueDate: pastDue }, baseTime)
      ).toBe(true);
    });

    it("returns true when expiresAt has passed even if dueDate is unset", () => {
      const pastExpiry = new Date("2026-09-24T11:30:00Z");
      expect(
        isRequestOverdue({ status: "PENDING", expiresAt: pastExpiry }, baseTime)
      ).toBe(true);
    });

    it("returns false for non-pending requests even if dueDate has passed", () => {
      const pastDue = new Date("2026-09-24T10:00:00Z");
      expect(
        isRequestOverdue({ status: "PAID", dueDate: pastDue }, baseTime)
      ).toBe(false);
      expect(
        isRequestOverdue({ status: "CANCELLED", dueDate: pastDue }, baseTime)
      ).toBe(false);
    });
  });

  describe("canSendReminder", () => {
    it("allows reminder when no prior reminders have been sent", () => {
      const res = canSendReminder(
        { status: "PENDING", reminderCount: 0, lastReminderAt: null },
        baseTime
      );
      expect(res.allowed).toBe(true);
    });

    it("allows reminder for OVERDUE requests", () => {
      const res = canSendReminder(
        { status: "OVERDUE", reminderCount: 1, lastReminderAt: new Date("2026-09-24T10:00:00Z") },
        baseTime
      );
      expect(res.allowed).toBe(true);
    });

    it("rejects reminder for non-actionable status (PAID/CANCELLED)", () => {
      const res = canSendReminder(
        { status: "PAID", reminderCount: 0, lastReminderAt: null },
        baseTime
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("only be sent for pending or overdue");
    });

    it("enforces cooldown period between reminders", () => {
      const twentyMinsAgo = new Date(baseTime.getTime() - 20 * 60 * 1000);
      const res = canSendReminder(
        { status: "PENDING", reminderCount: 1, lastReminderAt: twentyMinsAgo },
        baseTime,
        { minIntervalMs: DEFAULT_REMINDER_COOLDOWN_MS }
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Please wait");
      expect(res.cooldownRemainingSeconds).toBeGreaterThan(0);
    });

    it("allows reminder after cooldown period has elapsed", () => {
      const twoHoursAgo = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
      const res = canSendReminder(
        { status: "PENDING", reminderCount: 1, lastReminderAt: twoHoursAgo },
        baseTime,
        { minIntervalMs: DEFAULT_REMINDER_COOLDOWN_MS }
      );
      expect(res.allowed).toBe(true);
    });

    it("enforces maximum reminder cap", () => {
      const res = canSendReminder(
        {
          status: "PENDING",
          reminderCount: MAX_REMINDERS_PER_REQUEST,
          lastReminderAt: new Date("2026-09-20T00:00:00Z"),
        },
        baseTime
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Maximum limit");
    });
  });
});

describe("Payment Request Expiration - Transition Job & Exactly-Once Emission", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions overdue requests and dispatches webhook & notification exactly once", async () => {
    const dispatchSpy = vi
      .spyOn(webhookDispatcher, "dispatchWebhookEventAsync")
      .mockImplementation(() => {});
    const notifySpy = vi.spyOn(NOTIFY, "requestOverdue").mockImplementation(() => {});

    const now = new Date("2026-09-24T12:00:00Z");
    const mockRequest = {
      id: "req_123",
      userId: "usr_abc",
      amount: "100.5",
      assetCode: "XLM",
      description: "Q3 Design Retainer",
      status: "PENDING",
      dueDate: new Date("2026-09-24T10:00:00Z"),
      expiresAt: null,
      overdueNotifiedAt: null,
    };

    let updateManyCalled = 0;
    const mockPrisma = {
      paymentRequest: {
        findMany: vi.fn().mockResolvedValue([mockRequest]),
        updateMany: vi.fn().mockImplementation(() => {
          updateManyCalled++;
          return Promise.resolve({ count: 1 });
        }),
      },
    };

    // First run: transitions the request
    const result1 = await transitionOverduePaymentRequests(now, mockPrisma as any);

    expect(result1.transitioned).toBe(1);
    expect(result1.skipped).toBe(0);
    expect(result1.results[0].newStatus).toBe("OVERDUE");

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      WEBHOOK_EVENTS.REQUEST_OVERDUE,
      expect.objectContaining({
        requestId: "req_123",
        status: "OVERDUE",
      }),
      "usr_abc"
    );

    expect(notifySpy).toHaveBeenCalledTimes(1);

    // Second run: updateMany returns 0 (already notified), so event is NOT dispatched again
    mockPrisma.paymentRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const result2 = await transitionOverduePaymentRequests(now, mockPrisma as any);

    expect(result2.transitioned).toBe(0);
    expect(result2.skipped).toBe(1);
    // Crucial: Webhook and notification are NOT called again (exactly once guarantee)
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it("marks request PAID and emits webhook exactly once", async () => {
    const dispatchSpy = vi
      .spyOn(webhookDispatcher, "dispatchWebhookEventAsync")
      .mockImplementation(() => {});
    const notifySpy = vi.spyOn(NOTIFY, "requestPaid").mockImplementation(() => {});

    const now = new Date("2026-09-24T12:00:00Z");
    const mockRequest = {
      id: "req_456",
      userId: "usr_abc",
      amount: "50",
      assetCode: "USDC",
      description: "Consulting",
      status: "PENDING",
      paidNotifiedAt: null,
    };

    const mockPrisma = {
      paymentRequest: {
        findUnique: vi.fn().mockResolvedValue(mockRequest),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    // First payment execution
    const res1 = await markPaymentRequestPaid(
      "req_456",
      "0xhash12345",
      now,
      mockPrisma as any
    );

    expect(res1.success).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      WEBHOOK_EVENTS.REQUEST_PAID,
      expect.objectContaining({
        requestId: "req_456",
        transactionHash: "0xhash12345",
        status: "PAID",
      }),
      "usr_abc"
    );
    expect(notifySpy).toHaveBeenCalledTimes(1);

    // Repeated call: updateMany returns 0
    mockPrisma.paymentRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const res2 = await markPaymentRequestPaid(
      "req_456",
      "0xhash12345",
      now,
      mockPrisma as any
    );

    expect(res2.success).toBe(true);
    // Not called again
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it("sends reminder, tracks count, and respects cooldown", async () => {
    const dispatchSpy = vi
      .spyOn(webhookDispatcher, "dispatchWebhookEventAsync")
      .mockImplementation(() => {});
    const notifySpy = vi.spyOn(NOTIFY, "requestReminder").mockImplementation(() => {});

    const now = new Date("2026-09-24T12:00:00Z");
    const mockRequest = {
      id: "req_789",
      userId: "usr_xyz",
      recipientAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2CTRBIAP2W2QASXYZW1",
      amount: "250",
      assetCode: "XLM",
      description: "Grant Milestone",
      status: "PENDING",
      reminderCount: 0,
      lastReminderAt: null,
    };

    const mockPrisma = {
      paymentRequest: {
        findFirst: vi.fn().mockResolvedValue(mockRequest),
        update: vi.fn().mockResolvedValue({
          ...mockRequest,
          reminderCount: 1,
          lastReminderAt: now,
        }),
      },
    };

    // First reminder: succeeds
    const res1 = await sendPaymentRequestReminder(
      "req_789",
      "usr_xyz",
      now,
      mockPrisma as any
    );

    expect(res1.success).toBe(true);
    expect(res1.reminderCount).toBe(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      WEBHOOK_EVENTS.REQUEST_REMINDER_SENT,
      expect.objectContaining({
        requestId: "req_789",
        reminderCount: 1,
      }),
      "usr_xyz"
    );
    expect(notifySpy).toHaveBeenCalledTimes(1);

    // Second reminder immediate attempt: blocked by rate limiter
    mockPrisma.paymentRequest.findFirst.mockResolvedValueOnce({
      ...mockRequest,
      reminderCount: 1,
      lastReminderAt: now,
    });

    const res2 = await sendPaymentRequestReminder(
      "req_789",
      "usr_xyz",
      new Date("2026-09-24T12:15:00Z"), // 15 mins later
      mockPrisma as any
    );

    expect(res2.success).toBe(false);
    expect(res2.error).toContain("Please wait");
    expect(res2.cooldownRemainingSeconds).toBeGreaterThan(0);
    // Not re-dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
