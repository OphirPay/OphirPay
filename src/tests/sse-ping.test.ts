// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * SSE keep-alive: the events stream must emit a `: ping` comment every 20 s so
 * proxies/CDNs don't drop a long-lived connection, and the interval must be
 * cleared when the client goes away.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/events/event-source", () => ({
  createLiveEventSource: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

import { createBoundedSseBuffer } from "@/lib/events/sse-buffer";

const decoder = new TextDecoder();

function makeController(initialDesired = 0) {
  const chunks: Uint8Array[] = [];
  let desired = initialDesired;
  const controller = {
    get desiredSize() {
      return desired;
    },
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
    close() {},
  };
  return {
    controller: controller as unknown as ReadableStreamDefaultController<Uint8Array>,
    texts: () => chunks.map((c) => decoder.decode(c)),
    setDesired: (n: number) => {
      desired = n;
    },
  };
}

describe("bounded SSE buffer — keep-alive comments", () => {
  it("drains a ping comment as a valid SSE comment frame", () => {
    const harness = makeController(10);
    const buffer = createBoundedSseBuffer({ idleTimeoutMs: 1_000_000 });
    buffer.attach(harness.controller);

    buffer.pushComment("ping");

    expect(harness.texts()).toEqual([": ping\n\n"]);
  });

  it("drops a ping instead of evicting a queued event when the buffer is full", () => {
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 1,
      idleTimeoutMs: 1_000_000,
      now: () => 0,
    });
    buffer.attach(harness.controller);

    buffer.push("payment.created", { id: "p_1" });
    buffer.pushComment("ping");

    expect(buffer.queuedEvents).toBe(1);
    expect(buffer.droppedEvents).toBe(0);

    harness.setDesired(10);
    buffer.pull(harness.controller);
    expect(harness.texts()[0]).toContain("event: payment.created");
  });
});

describe("GET /api/events — keep-alive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a : ping comment every 20 seconds and stays alive past 30", async () => {
    const { GET, SSE_PING_INTERVAL_MS } = await import("@/app/api/events/route");

    expect(SSE_PING_INTERVAL_MS).toBe(20_000);

    const response = await GET(new Request("http://localhost/api/events"));
    const reader = response.body!.getReader();
    const read = async () => decoder.decode((await reader.read()).value);

    expect(await read()).toContain("event: connected");

    // 15 s → the data heartbeat; 20 s → the proxy keep-alive comment.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await read()).toContain("event: heartbeat");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(await read()).toBe(": ping\n\n");

    // Cross the 30-second mark that proxies typically enforce: the stream is
    // still open and the keep-alive repeats.
    await vi.advanceTimersByTimeAsync(15_000); // t=35s → 30s heartbeat
    expect(await read()).toContain("event: heartbeat");
    await vi.advanceTimersByTimeAsync(5_000); // t=40s → second ping
    expect(await read()).toBe(": ping\n\n");

    await reader.cancel();
  });

  it("clears the ping interval when the connection closes", async () => {
    const { GET } = await import("@/app/api/events/route");

    const response = await GET(new Request("http://localhost/api/events"));
    const reader = response.body!.getReader();
    await reader.read(); // connected

    // heartbeat + ping are the only intervals this stream owns.
    expect(vi.getTimerCount()).toBe(2);

    await reader.cancel();

    expect(vi.getTimerCount()).toBe(0);
  });
});
