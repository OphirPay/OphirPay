// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockWebhookFindFirst,
  mockDeliveryFindFirst,
  mockDeliveryFindMany,
  mockDeliveryUpdate,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockWebhookFindFirst: vi.fn(),
  mockDeliveryFindFirst: vi.fn(),
  mockDeliveryFindMany: vi.fn(),
  mockDeliveryUpdate: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findFirst: mockWebhookFindFirst,
    },
    webhookDelivery: {
      findFirst: mockDeliveryFindFirst,
      findMany: mockDeliveryFindMany,
      update: mockDeliveryUpdate,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn().mockResolvedValue(true),
}));

import { generateCsrfToken } from "@/lib/csrf";
import {
  buildDlqStatusFilter,
  parseDlqStatusCodesParam,
  requeueWebhookDelivery,
  requeueDeadLetterDeliveries,
} from "@/lib/webhook-deliver";
import {
  GET as getDeliveries,
  POST as postDeliveriesRequeueOnBase,
} from "@/app/api/webhooks/[id]/deliveries/route";
import { POST as postDeliveriesRequeue } from "@/app/api/webhooks/[id]/deliveries/requeue/route";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makePostRequest(url: string, body: unknown = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
}

const USER_ID = "user-admin-1";
const WEBHOOK_ID = "wh_dlq_1";
const EVENT_ID = "evt_orig_101";
const CORRELATION_ID = "corr_batch_900";
const ORIGINAL_TIMESTAMP = "2026-08-20T14:22:10.000Z";

function makeDeadLetterRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "dlv_dead_1",
    webhookId: WEBHOOK_ID,
    eventId: EVENT_ID,
    status: "DEAD_LETTER",
    responseCode: 502,
    latencyMs: 1450,
    attempts: 3,
    errorMessage: "HTTP 502",
    isReplay: false,
    replayBatchId: CORRELATION_ID,
    deliveredAt: new Date("2026-08-20T14:22:15.000Z"),
    webhook: {
      id: WEBHOOK_ID,
      userId: USER_ID,
      url: "https://merchant.example.com/webhooks",
      secret: "whsec_test_1362",
      isActive: true,
    },
    event: {
      id: EVENT_ID,
      event: "payment.completed",
      timestamp: new Date(ORIGINAL_TIMESTAMP),
      data: JSON.stringify({ paymentId: "pay_777", amount: 250 }),
    },
    ...overrides,
  };
}

describe("Webhook Dead-Letter Queue (DLQ) Requeue & Retry Worker (#1362)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID, role: "ADMIN" });
    mockWebhookFindFirst.mockResolvedValue({
      id: WEBHOOK_ID,
      userId: USER_ID,
      isActive: true,
    });
    mockDeliveryUpdate.mockImplementation(async ({ where, data }) => ({
      id: where.id,
      ...data,
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Unit: buildDlqStatusFilter & parseDlqStatusCodesParam", () => {
    it("builds filters for HTTP status codes (500, 502, 504) and timeouts (null)", () => {
      expect(buildDlqStatusFilter({ statusCode: 502 })).toEqual({
        responseCode: 502,
      });

      expect(buildDlqStatusFilter({ statusCodes: [500, 502, 504] })).toEqual({
        responseCode: { in: [500, 502, 504] },
      });

      expect(buildDlqStatusFilter({ statusCode: "timeout" })).toEqual({
        responseCode: null,
      });

      expect(
        buildDlqStatusFilter({ statusCodes: [502, 504], includeTimeouts: true })
      ).toEqual({
        OR: [{ responseCode: { in: [502, 504] } }, { responseCode: null }],
      });

      expect(parseDlqStatusCodesParam("500, 502, 504, timeout")).toEqual([
        500,
        502,
        504,
        "timeout",
      ]);
    });
  });

  describe("Unit: requeueWebhookDelivery & requeueDeadLetterDeliveries", () => {
    it("resets attempts = 0 and sets status = PENDING while preserving original event timestamp and correlationId", async () => {
      mockDeliveryFindFirst.mockResolvedValueOnce(makeDeadLetterRecord());

      const result = await requeueWebhookDelivery("dlv_dead_1", {
        webhookId: WEBHOOK_ID,
        userId: USER_ID,
      });

      expect(result).toEqual({
        id: "dlv_dead_1",
        webhookId: WEBHOOK_ID,
        eventId: EVENT_ID,
        eventType: "payment.completed",
        originalTimestamp: ORIGINAL_TIMESTAMP,
        correlationId: CORRELATION_ID,
        status: "PENDING",
        attempts: 0,
        previousResponseCode: 502,
        responseCode: 502,
        isReplay: true,
      });

      expect(mockDeliveryUpdate).toHaveBeenCalledWith({
        where: { id: "dlv_dead_1" },
        data: {
          status: "PENDING",
          attempts: 0,
          errorMessage: null,
          error: null,
          isReplay: true,
          replayBatchId: CORRELATION_ID,
        },
      });
    });

    it("falls back to eventId as correlationId when replayBatchId is null", async () => {
      mockDeliveryFindFirst.mockResolvedValueOnce(
        makeDeadLetterRecord({ replayBatchId: null })
      );

      const result = await requeueWebhookDelivery("dlv_dead_1");
      expect(result.correlationId).toBe(EVENT_ID);
      expect(result.originalTimestamp).toBe(ORIGINAL_TIMESTAMP);
      expect(result.status).toBe("PENDING");
      expect(result.attempts).toBe(0);
    });

    it("filters DLQ by HTTP status codes and timeouts in bulk requeue", async () => {
      mockDeliveryFindMany.mockResolvedValueOnce([
        makeDeadLetterRecord({ id: "dlv_502", responseCode: 502 }),
        makeDeadLetterRecord({
          id: "dlv_timeout",
          responseCode: null,
          replayBatchId: "corr_timeout_1",
        }),
      ]);

      const batch = await requeueDeadLetterDeliveries({
        webhookId: WEBHOOK_ID,
        userId: USER_ID,
        statusCodes: [500, 502, 504],
        includeTimeouts: true,
      });

      expect(mockDeliveryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            webhookId: WEBHOOK_ID,
            status: { in: ["DEAD_LETTER", "FAILED"] },
            OR: [
              { responseCode: { in: [500, 502, 504] } },
              { responseCode: null },
            ],
          },
        })
      );

      expect(batch.requeuedCount).toBe(2);
      expect(batch.deliveries[0]).toMatchObject({
        id: "dlv_502",
        status: "PENDING",
        attempts: 0,
        originalTimestamp: ORIGINAL_TIMESTAMP,
        correlationId: CORRELATION_ID,
      });
      expect(batch.deliveries[1]).toMatchObject({
        id: "dlv_timeout",
        status: "PENDING",
        attempts: 0,
        originalTimestamp: ORIGINAL_TIMESTAMP,
        correlationId: "corr_timeout_1",
      });
    });
  });

  describe("Routes: POST /api/webhooks/[id]/deliveries/requeue & GET /api/webhooks/[id]/deliveries", () => {
    it("rejects unauthenticated requests with 401", async () => {
      mockGetAuthContext.mockResolvedValueOnce(null);

      const res = await postDeliveriesRequeue(
        makePostRequest(`http://localhost/api/webhooks/${WEBHOOK_ID}/deliveries/requeue`, {
          statusCodes: [502],
        }),
        { params: Promise.resolve({ id: WEBHOOK_ID }) }
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-admin sessions with 403 Forbidden", async () => {
      mockGetAuthContext.mockResolvedValueOnce({
        userId: USER_ID,
        role: "VIEWER",
        isAdmin: false,
      });

      const res = await postDeliveriesRequeue(
        makePostRequest(`http://localhost/api/webhooks/${WEBHOOK_ID}/deliveries/requeue`, {
          statusCodes: [502],
        }),
        { params: Promise.resolve({ id: WEBHOOK_ID }) }
      );
      expect(res.status).toBe(403);
    });

    it("requeues DLQ deliveries filtered by statusCodes [500, 502, 504, 'timeout'] via POST /api/webhooks/[id]/deliveries/requeue", async () => {
      mockDeliveryFindMany.mockResolvedValueOnce([
        makeDeadLetterRecord({ id: "dlv_504", responseCode: 504 }),
      ]);

      const res = await postDeliveriesRequeue(
        makePostRequest(`http://localhost/api/webhooks/${WEBHOOK_ID}/deliveries/requeue`, {
          statusCodes: [500, 502, 504, "timeout"],
        }),
        { params: Promise.resolve({ id: WEBHOOK_ID }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.requeuedCount).toBe(1);
      expect(body.data.deliveries[0]).toMatchObject({
        id: "dlv_504",
        status: "PENDING",
        attempts: 0,
        originalTimestamp: ORIGINAL_TIMESTAMP,
        correlationId: CORRELATION_ID,
      });
    });

    it("requeues a single delivery via POST /api/webhooks/[id]/deliveries", async () => {
      mockDeliveryFindFirst.mockResolvedValueOnce(makeDeadLetterRecord());

      const res = await postDeliveriesRequeueOnBase(
        makePostRequest(`http://localhost/api/webhooks/${WEBHOOK_ID}/deliveries`, {
          deliveryId: "dlv_dead_1",
        }),
        { params: Promise.resolve({ id: WEBHOOK_ID }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.requeuedCount).toBe(1);
      expect(body.data.delivery.status).toBe("PENDING");
      expect(body.data.delivery.attempts).toBe(0);
    });

    it("filters GET /api/webhooks/[id]/deliveries by status=DEAD_LETTER and statusCodes=502,timeout", async () => {
      mockDeliveryFindMany.mockResolvedValueOnce([
        makeDeadLetterRecord({ id: "dlv_502", responseCode: 502 }),
      ]);

      const res = await getDeliveries(
        new Request(
          `http://localhost/api/webhooks/${WEBHOOK_ID}/deliveries?status=DEAD_LETTER&statusCodes=502,timeout`
        ),
        { params: Promise.resolve({ id: WEBHOOK_ID }) }
      );

      expect(res.status).toBe(200);
      expect(mockDeliveryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            webhookId: WEBHOOK_ID,
            status: "DEAD_LETTER",
            OR: [{ responseCode: { in: [502] } }, { responseCode: null }],
          },
        })
      );
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].correlationId).toBe(CORRELATION_ID);
    });
  });
});
