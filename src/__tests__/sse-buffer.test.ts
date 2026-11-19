// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  createBoundedSseBuffer,
  encodeSseFrame,
  SSE_SLOW_CONSUMER_CODE,
} from "@/lib/events/sse-buffer";

const decoder = new TextDecoder();

/**
 * Minimal fake ReadableStream controller. `desired` starts at 0 to simulate a
 * stalled consumer (drain doesn't move frames); raising it simulates the
 * consumer reading again.
 */
function makeController(initialDesired = 0) {
  const chunks: Uint8Array[] = [];
  let desired = initialDesired;
  let closed = false;
  const controller = {
    get desiredSize() {
      return closed ? null : desired;
    },
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
    close() {
      closed = true;
    },
  };
  return {
    controller: controller as unknown as ReadableStreamDefaultController<Uint8Array>,
    chunks,
    texts: () => chunks.map((c) => decoder.decode(c)),
    setDesired: (n: number) => {
      desired = n;
    },
    isClosed: () => closed,
  };
}

describe("createBoundedSseBuffer — baseline", () => {
  it("drains buffered frames in order when the consumer reads", () => {
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({ idleTimeoutMs: 1_000_000 });
    buffer.attach(harness.controller);

    buffer.push("a", 1);
    buffer.push("b", 2);
    expect(buffer.queuedEvents).toBe(2);
    expect(harness.chunks).toHaveLength(0); // stalled — nothing enqueued yet

    harness.setDesired(10);
    buffer.pull(harness.controller);

    expect(buffer.queuedEvents).toBe(0);
    expect(harness.texts()).toEqual([
      decoder.decode(encodeSseFrame("a", 1)),
      decoder.decode(encodeSseFrame("b", 2)),
    ]);
  });
});

describe("createBoundedSseBuffer — drop-oldest policy", () => {
  it("never grows past the event ceiling and reports drops", () => {
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 3,
      idleTimeoutMs: 1_000_000,
      now: () => 0,
    });
    buffer.attach(harness.controller);

    for (let i = 0; i < 50; i++) buffer.push("payment:created", { i });

    expect(buffer.queuedEvents).toBeLessThanOrEqual(3);
    expect(buffer.droppedEvents).toBeGreaterThan(0);
  });

  it("emits a slow-consumer marker comment ahead of the next data frame", () => {
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 2,
      idleTimeoutMs: 1_000_000,
      now: () => 0,
    });
    buffer.attach(harness.controller);

    for (let i = 0; i < 5; i++) buffer.push("n", { i });
    harness.setDesired(100);
    buffer.pull(harness.controller);

    const texts = harness.texts();
    expect(texts.some((t) => /^: dropped \d+ slow-consumer event\(s\)/.test(t))).toBe(true);
  });

  it("respects the byte ceiling", () => {
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 1000,
      maxBytes: 200,
      idleTimeoutMs: 1_000_000,
      now: () => 0,
    });
    buffer.attach(harness.controller);

    for (let i = 0; i < 50; i++) {
      buffer.push("big", { payload: "x".repeat(100) });
    }

    expect(buffer.queuedBytes).toBeLessThanOrEqual(200);
    expect(buffer.droppedEvents).toBeGreaterThan(0);
  });
});

describe("createBoundedSseBuffer — disconnect policy", () => {
  it("closes with a classified SLOW_CONSUMER error frame on overflow", () => {
    const onDisconnect = vi.fn();
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 2,
      policy: "disconnect",
      idleTimeoutMs: 1_000_000,
      now: () => 0,
      onDisconnect,
    });
    buffer.attach(harness.controller);

    buffer.push("a", 1);
    buffer.push("b", 2);
    buffer.push("c", 3); // overflow

    expect(buffer.disconnected).toBe(true);
    expect(harness.isClosed()).toBe(true);
    expect(onDisconnect).toHaveBeenCalledWith("buffer-overflow");

    const last = harness.texts().at(-1) ?? "";
    expect(last).toContain(`"code":"${SSE_SLOW_CONSUMER_CODE}"`);
  });
});

describe("createBoundedSseBuffer — idle timeout", () => {
  it("disconnects a backlogged connection that hasn't drained in time", () => {
    const onDisconnect = vi.fn();
    let clock = 1_000;
    const harness = makeController(0);
    const buffer = createBoundedSseBuffer({
      maxEvents: 10,
      idleTimeoutMs: 100,
      now: () => clock,
      onDisconnect,
    });
    buffer.attach(harness.controller);

    buffer.push("a", 1); // backlog created, no drain (desired = 0)
    clock = 1_200; // beyond the idle budget
    buffer.push("b", 2);

    expect(buffer.disconnected).toBe(true);
    expect(onDisconnect).toHaveBeenCalledWith("idle-timeout");
  });

  it("does not disconnect a consumer that keeps draining", () => {
    let clock = 1_000;
    const harness = makeController(10);
    const buffer = createBoundedSseBuffer({
      maxEvents: 10,
      idleTimeoutMs: 100,
      now: () => clock,
    });
    buffer.attach(harness.controller);

    for (let i = 0; i < 20; i++) {
      clock += 50;
      buffer.push("tick", { i });
      if (i % 5 === 0) buffer.pull(harness.controller); // consumer reads
    }

    expect(buffer.disconnected).toBe(false);
  });
});
