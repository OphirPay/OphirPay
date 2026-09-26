// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Coverage for the webhook dispatcher (issue #700). This module was excluded
 * from the coverage report even though it fans out events to customer
 * endpoints; it is now measured, so it needs a suite that pins its routing
 * and delivery-recording behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deliverWebhook: vi.fn(),
  storeWebhookEvent: vi.fn(),
  recordWebhookDelivery: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { webhook: { findMany: mocks.findMany } },
}));

vi.mock("@/lib/webhook-deliver", () => ({
  deliverWebhook: mocks.deliverWebhook,
}));

vi.mock("@/lib/webhook-event-store", () => ({
  storeWebhookEvent: mocks.storeWebhookEvent,
  recordWebhookDelivery: mocks.recordWebhookDelivery,
}));

import {
  dispatchWebhookEvent,
  dispatchWebhookEventAsync,
} from "@/lib/webhook-dispatcher";

const EVENT = "payment.created";

function webhook(id: string, events: string) {
  return { id, url: `https://hook.example.com/${id}`, secret: `s-${id}`, events };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.deliverWebhook.mockResolvedValue({
    success: true,
    statusCode: 200,
    latencyMs: 5,
    attempts: 1,
  });
  mocks.storeWebhookEvent.mockResolvedValue("evt_1");
  mocks.recordWebhookDelivery.mockResolvedValue("del_1");
});

describe("dispatchWebhookEvent", () => {
  it("does nothing when there are no active webhooks", async () => {
    await dispatchWebhookEvent(EVENT, { id: "p_1" });
    expect(mocks.deliverWebhook).not.toHaveBeenCalled();
  });

  it("only delivers to webhooks subscribed to the event", async () => {
    mocks.findMany.mockResolvedValue([
      webhook("subscribed", JSON.stringify([EVENT])),
      webhook("other", JSON.stringify(["payment.refunded"])),
    ]);

    await dispatchWebhookEvent(EVENT, { id: "p_1" });

    expect(mocks.deliverWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.deliverWebhook.mock.calls[0]![0]).toBe(
      "https://hook.example.com/subscribed"
    );
  });

  it("treats an empty event list as 'subscribed to everything'", async () => {
    mocks.findMany.mockResolvedValue([webhook("all", "[]")]);
    await dispatchWebhookEvent(EVENT, { id: "p_1" });
    expect(mocks.deliverWebhook).toHaveBeenCalledTimes(1);
  });

  it("ignores webhooks whose events column is malformed", async () => {
    mocks.findMany.mockResolvedValue([webhook("bad", "{not json")]);
    await dispatchWebhookEvent(EVENT, { id: "p_1" });
    expect(mocks.deliverWebhook).not.toHaveBeenCalled();
  });

  it("scopes the lookup to one user when a scope is supplied", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    await dispatchWebhookEvent(EVENT, { id: "p_1" }, "user_1");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true, userId: "user_1" },
    });
  });

  it("persists the event and records a SUCCESS delivery when user-scoped", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    await dispatchWebhookEvent(EVENT, { id: "p_1" }, "user_1");

    expect(mocks.storeWebhookEvent).toHaveBeenCalledOnce();
    expect(mocks.recordWebhookDelivery).toHaveBeenCalledWith(
      "w1",
      "evt_1",
      "SUCCESS",
      { responseCode: 200, isReplay: false }
    );
  });

  it("does not persist events when there is no user scope", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    await dispatchWebhookEvent(EVENT, { id: "p_1" });
    expect(mocks.storeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it("records a FAILED delivery when the endpoint rejects the payload", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    mocks.deliverWebhook.mockResolvedValue({
      success: false,
      statusCode: 500,
      latencyMs: 12,
      attempts: 3,
    });

    await dispatchWebhookEvent(EVENT, { id: "p_1" }, "user_1");

    expect(mocks.recordWebhookDelivery).toHaveBeenCalledWith(
      "w1",
      "evt_1",
      "FAILED",
      { responseCode: 500, isReplay: false }
    );
  });

  it("swallows lookup failures instead of throwing to the caller", async () => {
    mocks.findMany.mockRejectedValue(new Error("db down"));
    await expect(dispatchWebhookEvent(EVENT, { id: "p_1" })).resolves.toBeUndefined();
    expect(mocks.deliverWebhook).not.toHaveBeenCalled();
  });

  it("still delivers when storing the event for replay fails", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    mocks.storeWebhookEvent.mockResolvedValue(null);
    await dispatchWebhookEvent(EVENT, { id: "p_1" }, "user_1");
    expect(mocks.deliverWebhook).toHaveBeenCalledTimes(1);
    // No stored event id ⇒ nothing to record a delivery against, but the
    // delivery itself must still happen.
    expect(mocks.recordWebhookDelivery).not.toHaveBeenCalled();
  });
});

describe("dispatchWebhookEventAsync", () => {
  it("kicks the dispatch off without returning a promise result", async () => {
    mocks.findMany.mockResolvedValue([webhook("w1", "[]")]);
    const result = dispatchWebhookEventAsync(EVENT, { id: "p_1" });
    expect(result).toBeUndefined();
    // Let the fire-and-forget promise settle.
    await vi.waitFor(() => expect(mocks.deliverWebhook).toHaveBeenCalled());
  });
});
