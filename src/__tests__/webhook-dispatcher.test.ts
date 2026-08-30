// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestIdContext } from "@/lib/request-context";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: { findMany: mocks.findMany },
  },
}));

const originalFetch = globalThis.fetch;

function findLogLine(spy: ReturnType<typeof vi.spyOn>, message: string) {
  for (const call of spy.mock.calls) {
    try {
      const entry = JSON.parse(call[0] as string);
      if (entry.message === message) return entry;
    } catch {
      // non-JSON console.log output — ignore
    }
  }
  return undefined;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.findMany.mockReset();
  globalThis.fetch = originalFetch;
  // dispatchWebhookEvent no-ops when `window` is defined (browser guard);
  // stub it away to simulate the Node server runtime so the dispatch path
  // actually executes.
  vi.stubGlobal("window", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("dispatchWebhookEvent — request id propagation", () => {
  it("carries the originating request id through dispatch and delivery logs end to end", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.findMany.mockResolvedValue([
      { url: "https://example.com/hook", secret: "s" },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    await requestIdContext.run("req_origin_1", () =>
      dispatchWebhookEvent("payment.created", { id: "p1" })
    );

    // The dispatch log line shares the request id.
    const dispatchLine = findLogLine(spy, "Dispatching webhooks");
    expect(dispatchLine).toBeDefined();
    expect(dispatchLine?.context?.requestId).toBe("req_origin_1");

    // The downstream delivery log line shares the same id end to end.
    const deliveredLine = findLogLine(spy, "Webhook delivered");
    expect(deliveredLine).toBeDefined();
    expect(deliveredLine?.context?.requestId).toBe("req_origin_1");
  });

  it("logs without a request id when dispatched outside a request context", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.findMany.mockResolvedValue([
      { url: "https://example.com/hook", secret: "s" },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    await dispatchWebhookEvent("payment.created", { id: "p2" });

    const dispatchLine = findLogLine(spy, "Dispatching webhooks");
    expect(dispatchLine).toBeDefined();
    expect(dispatchLine?.context).not.toHaveProperty("requestId");
  });

  it("no-ops (no dispatch log) when there are no subscribed webhooks", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.findMany.mockResolvedValue([]);

    await requestIdContext.run("req_origin_2", () =>
      dispatchWebhookEvent("payment.created", { id: "p3" })
    );

    expect(findLogLine(spy, "Dispatching webhooks")).toBeUndefined();
  });
});
