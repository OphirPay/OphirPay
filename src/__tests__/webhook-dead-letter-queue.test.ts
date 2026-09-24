// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findFirst: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { persistDeliveryResult } from "@/lib/webhook-delivery-service";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
  incMetric,
  incDeliveryFinalOutcome,
} from "@/lib/metrics-counters";
import { GET as getDeadLetters } from "@/app/api/webhooks/[id]/dead-letter/route";
import { POST as bulkRedeliver } from "@/app/api/webhooks/[id]/dead-letter/redeliver/route";
import fs from "fs";
import path from "path";

const mockWebhookFindFirst = prisma.webhook.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockDeliveryCreate = prisma.webhookDelivery.create as unknown as ReturnType<typeof vi.fn>;
const mockDeliveryFindMany = prisma.webhookDelivery.findMany as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockGetAuth = getAuthContext as unknown as ReturnType<typeof vi.fn>;

describe("Webhook Dead-Letter Queue & Delivery Timeout", () => {
  const originalFetch = globalThis.fetch;
  const SECRET = "secret_1234567890";
  const samplePayload = {
    event: "payment.completed",
    timestamp: "2026-09-24T00:00:00Z",
    data: { paymentId: "pay_test_999", amount: "150.00" },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetMetricsForTest();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Criterion 1: Bounded timeouts and distinct failure reasons", () => {
    it("enforces timeout and records distinct failure reason when request exceeds timeout", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        // Verify signal is provided to fetch
        expect(init?.signal).toBeDefined();
        throw abortError;
      });

      const res = await deliverWebhook(
        "https://example.com/hanging-receiver",
        SECRET,
        samplePayload,
        1,
        250
      );

      expect(res.success).toBe(false);
      expect(res.attempts).toBe(1);
      expect(res.errorMessage).toBe("TIMEOUT: Delivery attempt timed out after 250ms");
      expect(res.isDeadLetter).toBe(true);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.webhooks_timeout_total).toBe(1);
      expect(snapshot.webhooks_dead_letter_total).toBe(1);
    });

    it("records standard HTTP errors distinctly from timeouts", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
      });

      const res = await deliverWebhook(
        "https://example.com/gateway-timeout",
        SECRET,
        samplePayload,
        2
      );

      expect(res.success).toBe(false);
      expect(res.errorMessage).toBe("HTTP 504");
      expect(res.statusCode).toBe(504);
      expect(res.isDeadLetter).toBe(true);
    });
  });

  describe("Criterion 2: Exhausted deliveries land in DEAD_LETTER state with payload retained", () => {
    it("persists delivery with DEAD_LETTER status when isDeadLetter is true", async () => {
      mockDeliveryCreate.mockResolvedValue({ id: "del_dlq_1" });

      const deliveryId = await persistDeliveryResult("wh_abc", "evt_xyz", {
        success: false,
        statusCode: 500,
        latencyMs: 350,
        attempts: 3,
        errorMessage: "HTTP 500",
        isDeadLetter: true,
      });

      expect(deliveryId).toBe("del_dlq_1");
      expect(mockDeliveryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: "wh_abc",
          eventId: "evt_xyz",
          status: "DEAD_LETTER",
          responseCode: 500,
          latencyMs: 350,
          attempts: 3,
          errorMessage: "HTTP 500",
        }),
      });
    });

    it("persists delivery with FAILED status when not dead-lettered", async () => {
      mockDeliveryCreate.mockResolvedValue({ id: "del_fail_1" });

      await persistDeliveryResult("wh_abc", "evt_xyz", {
        success: false,
        statusCode: 500,
        latencyMs: 350,
        attempts: 1,
        errorMessage: "HTTP 500",
        isDeadLetter: false,
      });

      expect(mockDeliveryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: "wh_abc",
          eventId: "evt_xyz",
          status: "FAILED",
        }),
      });
    });
  });

  describe("Criterion 3: Queryable dead-letter queue with retained payload", () => {
    it("returns dead-letter items with parsed retained payload and failure reason", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_owner" });
      mockWebhookFindFirst.mockResolvedValue({ id: "wh_100", url: "https://api.example.com/webhook" });

      const rawEventPayload = {
        paymentId: "pay_dlq_test",
        amount: "50.00",
        assetCode: "USDC",
        memo: "DLQ test",
      };

      mockDeliveryFindMany.mockResolvedValue([
        {
          id: "del_dlq_99",
          eventId: "evt_101",
          status: "DEAD_LETTER",
          responseCode: null,
          latencyMs: 5005,
          attempts: 3,
          errorMessage: "TIMEOUT: Delivery attempt timed out after 5000ms",
          isReplay: false,
          replayBatchId: null,
          deliveredAt: new Date("2026-09-24T10:00:00Z"),
          event: {
            id: "evt_101",
            event: "payment.completed",
            timestamp: new Date("2026-09-24T09:59:00Z"),
            data: JSON.stringify(rawEventPayload),
          },
        },
      ]);

      const request = new Request("http://localhost/api/webhooks/wh_100/dead-letter?limit=25");
      const response = await getDeadLetters(request, {
        params: Promise.resolve({ id: "wh_100" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toHaveLength(1);

      const item = json.data[0];
      expect(item.id).toBe("del_dlq_99");
      expect(item.status).toBe("DEAD_LETTER");
      expect(item.errorMessage).toBe("TIMEOUT: Delivery attempt timed out after 5000ms");
      expect(item.attempts).toBe(3);
      expect(item.payload).toEqual(rawEventPayload);
      expect(json.meta.total).toBe(1);
    });
  });

  describe("Criterion 4: Bulk redelivery from dead-letter state is audited", () => {
    it("replays dead-letter deliveries and creates an AuditLog entry with batch details", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_owner" });
      mockWebhookFindFirst.mockResolvedValue({
        id: "wh_100",
        url: "https://api.example.com/webhook",
        secret: SECRET,
        isActive: true,
      });

      mockDeliveryFindMany.mockResolvedValue([
        {
          id: "del_dlq_1",
          eventId: "evt_1",
          status: "DEAD_LETTER",
          event: {
            id: "evt_1",
            event: "payment.completed",
            timestamp: new Date("2026-09-24T09:00:00Z"),
            data: JSON.stringify({ paymentId: "p_1" }),
          },
        },
        {
          id: "del_dlq_2",
          eventId: "evt_2",
          status: "DEAD_LETTER",
          event: {
            id: "evt_2",
            event: "refund.created",
            timestamp: new Date("2026-09-24T09:05:00Z"),
            data: JSON.stringify({ refundId: "r_1" }),
          },
        },
      ]);

      // Endpoint is now reachable and returns 200 OK
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      mockDeliveryCreate.mockResolvedValue({ id: "del_replay_new" });
      mockAuditLogCreate.mockResolvedValue({ id: "audit_1" });

      const request = new Request("http://localhost/api/webhooks/wh_100/dead-letter/redeliver", {
        method: "POST",
      });

      const response = await bulkRedeliver(request, {
        params: Promise.resolve({ id: "wh_100" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.total).toBe(2);
      expect(json.data.succeeded).toBe(2);
      expect(json.data.failed).toBe(0);

      // Verify audit log creation
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "webhook:dead-letter:bulk-redeliver",
          actor: "user_owner",
          target: "wh_100",
          details: expect.objectContaining({
            total: 2,
            succeeded: 2,
            failed: 0,
            priorDeliveryIds: ["del_dlq_1", "del_dlq_2"],
          }),
        }),
      });
    });

    it("rejects bulk redelivery if webhook is paused", async () => {
      mockGetAuth.mockResolvedValue({ userId: "user_owner" });
      mockWebhookFindFirst.mockResolvedValue({
        id: "wh_100",
        url: "https://api.example.com/webhook",
        secret: SECRET,
        isActive: false,
      });

      const request = new Request("http://localhost/api/webhooks/wh_100/dead-letter/redeliver", {
        method: "POST",
      });

      const response = await bulkRedeliver(request, {
        params: Promise.resolve({ id: "wh_100" }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain("Webhook is paused");
      expect(mockDeliveryFindMany).not.toHaveBeenCalled();
    });
  });

  describe("Criterion 5: Metrics and Prometheus alerting configuration", () => {
    it("tracks dead-letter and timeout counters in getMetricsSnapshot()", () => {
      incMetric("webhooks_dead_letter_total", 5);
      incMetric("webhooks_timeout_total", 2);
      incDeliveryFinalOutcome("webhook", 3, "dead_letter");

      const snapshot = getMetricsSnapshot();
      expect(snapshot.webhooks_dead_letter_total).toBe(5);
      expect(snapshot.webhooks_timeout_total).toBe(2);

      const dlOutcome = snapshot.delivery_final_outcomes.find(
        (o) => o.delivery_type === "webhook" && o.final_outcome === "dead_letter"
      );
      expect(dlOutcome?.count).toBe(1);
      expect(dlOutcome?.attempt_number).toBe(3);
    });

    it("verifies prometheus alert rules exist for WebhookDeadLetterQueueThresholdExceeded and WebhookDeliveryTimeoutRateHigh", () => {
      const alertsPath = path.resolve(process.cwd(), "monitoring/prometheus-alerts.yml");
      expect(fs.existsSync(alertsPath)).toBe(true);

      const content = fs.readFileSync(alertsPath, "utf-8");
      expect(content).toContain("alert: WebhookDeadLetterQueueThresholdExceeded");
      expect(content).toContain("alert: WebhookDeliveryTimeoutRateHigh");
      expect(content).toContain("ophirpay_webhooks_dead_letter_total");
      expect(content).toContain("ophirpay_webhooks_timeout_total");
    });
  });
});
