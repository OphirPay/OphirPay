// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveReplayBounds,
  selectEventsForReplay,
  toWebhookPayload,
} from "@/lib/webhook-event-store";
import { REPLAY_MAX_COUNT, REPLAY_MAX_DAYS } from "@/lib/webhook-replay-config";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhookEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";

const mockFindMany = prisma.webhookEvent.findMany as ReturnType<typeof vi.fn>;
const mockDeliveryCreate = prisma.webhookDelivery.create as ReturnType<typeof vi.fn>;

describe("resolveReplayBounds", () => {
  it("clamps since to the last 7 days", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const bounds = resolveReplayBounds({
      userId: "user_1",
      subscribedEvents: ["payment.created"],
      since: tenDaysAgo,
    });

    const earliestAllowed = Date.now() - REPLAY_MAX_DAYS * 24 * 60 * 60 * 1000;
    expect(bounds.since.getTime()).toBeGreaterThanOrEqual(earliestAllowed - 1000);
  });

  it("caps limit at REPLAY_MAX_COUNT", () => {
    const bounds = resolveReplayBounds({
      userId: "user_1",
      subscribedEvents: ["payment.created"],
      limit: 500,
    });
    expect(bounds.limit).toBe(REPLAY_MAX_COUNT);
  });

  it("rejects negative limits by clamping to 1", () => {
    const bounds = resolveReplayBounds({
      userId: "user_1",
      subscribedEvents: ["payment.created"],
      limit: 0,
    });
    expect(bounds.limit).toBe(1);
  });
});

describe("selectEventsForReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries stored events with bounded window and subscribed event filter", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "evt_1",
        event: "payment.created",
        timestamp: new Date("2026-08-20T00:00:00Z"),
        data: '{"paymentId":"p_1"}',
      },
    ]);

    const since = new Date("2026-08-19T00:00:00Z");
    const until = new Date("2026-08-21T00:00:00Z");

    const result = await selectEventsForReplay({
      userId: "user_1",
      subscribedEvents: ["payment.created", "payment.completed"],
      since,
      until,
      limit: 25,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_1",
          event: { in: ["payment.created", "payment.completed"] },
          timestamp: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
        take: 25,
        orderBy: { timestamp: "asc" },
      }),
    );
    expect(result.events).toHaveLength(1);
  });

  it("returns empty when no subscribed events", async () => {
    const result = await selectEventsForReplay({
      userId: "user_1",
      subscribedEvents: [],
    });
    expect(result.events).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("toWebhookPayload", () => {
  it("parses stored JSON data into a delivery payload", () => {
    const payload = toWebhookPayload({
      event: "payment.created",
      timestamp: new Date("2026-08-20T12:00:00Z"),
      data: '{"paymentId":"p_123","amount":100}',
    });

    expect(payload).toEqual({
      event: "payment.created",
      timestamp: "2026-08-20T12:00:00.000Z",
      data: { paymentId: "p_123", amount: 100 },
    });
  });
});

describe("recordWebhookDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists replay deliveries with batch id", async () => {
    const { recordWebhookDelivery } = await import("@/lib/webhook-event-store");

    await recordWebhookDelivery("wh_1", "evt_1", "SUCCESS", {
      responseCode: 200,
      isReplay: true,
      replayBatchId: "batch_abc",
    });

    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "SUCCESS",
        responseCode: 200,
        isReplay: true,
        replayBatchId: "batch_abc",
      }),
    });
  });
});
