// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizePaymentEvent,
  getStoredNotifications,
  saveStoredNotifications,
  getUnreadCount,
  emitPaymentNotification,
  NOTIFY,
  INITIAL_NOTIFICATIONS,
  requestNotificationPermission,
  isPermissionRequested,
  sendNotification,
} from "@/lib/notifications";
import { STORAGE_KEYS } from "@/lib/storage-keys";

describe("notifications library", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  describe("normalizePaymentEvent", () => {
    it("normalizes a payment.sent event with stroops", () => {
      const normalized = normalizePaymentEvent({
        event: "payment:sent",
        amount: "50000000",
        payee: "GBBD7KVXOMWBKLY2C7Q6RN2P2VY3NXN3T1234",
        txHash: "abcdef1234567890abcdef",
        timestamp: "2026-08-27T07:00:00Z",
      });

      expect(normalized.type).toBe("payment.sent");
      expect(normalized.title).toContain("5.00 XLM");
      expect(normalized.message).toContain("GBBD7...1234");
      expect(normalized.txHash).toBe("abcdef1234567890abcdef");
      expect(normalized.read).toBe(false);
      expect(normalized.status).toBe("COMPLETED");
    });

    it("normalizes a payment.received event with decimal string", () => {
      const normalized = normalizePaymentEvent({
        type: "payment.received",
        amount: "125.50 XLM",
        payer: "GCAL...5678",
        txHash: "tx987654321",
      });

      expect(normalized.type).toBe("payment.received");
      expect(normalized.title).toBe("Payment Received: 125.50 XLM");
      expect(normalized.counterparty).toBe("GCAL...5678");
      expect(normalized.read).toBe(false);
    });

    it("normalizes a payment.batch_completed event", () => {
      const normalized = normalizePaymentEvent({
        type: "payment.batch_completed",
        recipients: 12,
        batchId: "batch_456",
        amount: "1000 XLM",
      });

      expect(normalized.type).toBe("payment.batch_completed");
      expect(normalized.title).toBe("Batch Payment Complete");
      expect(normalized.message).toContain("12 recipients");
      expect(normalized.recipientCount).toBe(12);
      expect(normalized.batchId).toBe("batch_456");
    });

    it("normalizes a payment.failed event", () => {
      const normalized = normalizePaymentEvent({
        type: "payment.failed",
        txHash: "failed_tx_123",
      });

      expect(normalized.type).toBe("payment.failed");
      expect(normalized.title).toBe("Payment Failed");
      expect(normalized.message).toContain("failed to execute");
    });

    it("normalizes generic on-chain payment:created event", () => {
      const normalized = normalizePaymentEvent({
        event: "payment:created",
        paymentId: "evt_999",
        amountStroops: 20000000,
        payee: "GDQM...9999",
      });

      expect(normalized.type).toBe("payment.created");
      expect(normalized.id).toBe("evt_999");
      expect(normalized.amount).toBe("2.00 XLM");
    });

    it("preserves explicit custom title and message if provided", () => {
      const normalized = normalizePaymentEvent({
        type: "payment.sent",
        title: "Custom Title",
        message: "Custom payment body message",
      });

      expect(normalized.title).toBe("Custom Title");
      expect(normalized.message).toBe("Custom payment body message");
    });

    it("handles timestamp as epoch seconds vs ms", () => {
      const epochSec = 1700000000;
      const normalizedSec = normalizePaymentEvent({
        timestamp: epochSec,
      });
      expect(normalizedSec.timestamp).toBe(epochSec * 1000);

      const epochMs = 1700000000000;
      const normalizedMs = normalizePaymentEvent({
        timestamp: epochMs,
      });
      expect(normalizedMs.timestamp).toBe(epochMs);
    });
  });

  describe("Session Storage Persistence", () => {
    it("returns INITIAL_NOTIFICATIONS and seeds sessionStorage on first access", () => {
      const stored = getStoredNotifications();
      expect(stored).toHaveLength(INITIAL_NOTIFICATIONS.length);
      expect(window.sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)).toBeTruthy();
    });

    it("retrieves previously saved notifications from sessionStorage", () => {
      const custom = [
        {
          id: "test_1",
          type: "payment.sent" as const,
          title: "Test Sent",
          message: "Test message",
          timestamp: Date.now(),
          read: true,
        },
      ];
      saveStoredNotifications(custom);

      const retrieved = getStoredNotifications();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe("test_1");
    });

    it("gracefully falls back to INITIAL_NOTIFICATIONS if storage has invalid JSON", () => {
      window.sessionStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, "invalid json {{{{");
      const retrieved = getStoredNotifications();
      expect(retrieved).toEqual(INITIAL_NOTIFICATIONS);
    });

    it("getUnreadCount accurately counts unread items", () => {
      const items = [
        { ...INITIAL_NOTIFICATIONS[0], read: false },
        { ...INITIAL_NOTIFICATIONS[1], read: true },
        { ...INITIAL_NOTIFICATIONS[2], read: false },
      ];
      expect(getUnreadCount(items)).toBe(2);
    });
  });

  describe("emitPaymentNotification & NOTIFY templates", () => {
    it("emits custom window event and dispatches notification", () => {
      const listener = vi.fn();
      window.addEventListener("ophirpay:notification", listener);

      const notif = emitPaymentNotification({
        type: "payment.received",
        amount: "50 XLM",
        payer: "GCAL...1111",
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(notif.type).toBe("payment.received");

      window.removeEventListener("ophirpay:notification", listener);
    });

    it("NOTIFY.paymentSent triggers payment.sent notification", () => {
      const listener = vi.fn();
      window.addEventListener("ophirpay:notification", listener);

      NOTIFY.paymentSent("25 XLM", "tx_sent_hash_123");
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener("ophirpay:notification", listener);
    });

    it("NOTIFY.paymentReceived triggers payment.received notification", () => {
      const listener = vi.fn();
      window.addEventListener("ophirpay:notification", listener);

      NOTIFY.paymentReceived("80 XLM", "GBBD...3333");
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener("ophirpay:notification", listener);
    });

    it("NOTIFY.batchComplete triggers payment.batch_completed notification", () => {
      const listener = vi.fn();
      window.addEventListener("ophirpay:notification", listener);

      NOTIFY.batchComplete(15, "batch_99");
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener("ophirpay:notification", listener);
    });
  });

  describe("Browser permission functions", () => {
    it("isPermissionRequested returns false initially", () => {
      expect(typeof isPermissionRequested()).toBe("boolean");
    });

    it("requestNotificationPermission returns boolean", async () => {
      const res = await requestNotificationPermission();
      expect(typeof res).toBe("boolean");
    });

    it("sendNotification does not throw in jsdom environment", () => {
      expect(() => sendNotification("Test Notification")).not.toThrow();
    });
  });
});
