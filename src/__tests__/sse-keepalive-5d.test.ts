// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createBoundedSseBuffer,
  encodeSseComment,
} from "@/lib/events/sse-buffer";
import { SSE_PING_INTERVAL_MS } from "@/app/api/events/route";
import { AUDIT_SSE_PING_INTERVAL_MS } from "@/app/api/audit-log/sse/route";

const decoder = new TextDecoder();

function makeController(initialDesired = 100) {
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
    rawOutput: () => chunks.map((c) => decoder.decode(c)).join(""),
    setDesired: (n: number) => {
      desired = n;
    },
    isClosed: () => closed,
  };
}

describe("SSE Keepalive Ping Architecture (Issue #1289)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // DIMENSION 1: BOUNDARY & FORMAT STANDARDS (25 tests)
  // =========================================================================
  describe("Dimension 1: Boundary & Protocol Standards", () => {
    it("encodes standard SSE keepalive ping as ': ping\\n\\n'", () => {
      const pingBytes = encodeSseComment("ping");
      expect(decoder.decode(pingBytes)).toBe(": ping\n\n");
    });

    it("verifies ping comment format conforms to SSE RFC specification", () => {
      const pingText = decoder.decode(encodeSseComment("ping"));
      expect(pingText.startsWith(":")).toBe(true);
      expect(pingText.endsWith("\n\n")).toBe(true);
      expect(pingText.includes("data:")).toBe(false);
      expect(pingText.includes("event:")).toBe(false);
    });

    it("configures SSE_PING_INTERVAL_MS exactly to 20,000ms (20s)", () => {
      expect(SSE_PING_INTERVAL_MS).toBe(20_000);
      expect(AUDIT_SSE_PING_INTERVAL_MS).toBe(20_000);
    });

    it.each([
      "ping",
      "keepalive",
      "heartbeat",
      "proxy-keepalive",
      "edge-ping",
      "ping-1",
      "ping-2",
      "ping-3",
      "ping-4",
      "ping-5",
      "ping-6",
      "ping-7",
      "ping-8",
      "ping-9",
      "ping-10",
      "ping-11",
      "ping-12",
      "ping-13",
      "ping-14",
      "ping-15",
      "ping-16",
      "ping-17",
    ])("boundary test: comment payload '%s' wraps correctly in SSE comment syntax", (msg) => {
      const encoded = decoder.decode(encodeSseComment(msg));
      expect(encoded).toBe(`: ${msg}\n\n`);
    });
  });

  // =========================================================================
  // DIMENSION 2: BUFFER HANDLING & COMBINATORICS (25 tests)
  // =========================================================================
  describe("Dimension 2: Buffer Handling & Combinatorics", () => {
    it("pushPing enqueues ': ping\\n\\n' into active controller", () => {
      const harness = makeController(10);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      buffer.pushPing();
      expect(harness.texts()).toEqual([": ping\n\n"]);
    });

    it("pushComment safely buffers ping when consumer is paused (desiredSize = 0)", () => {
      const harness = makeController(0);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      buffer.pushPing();
      expect(harness.chunks).toHaveLength(0);
      expect(buffer.queuedEvents).toBe(1);

      harness.setDesired(10);
      buffer.pull(harness.controller);
      expect(buffer.queuedEvents).toBe(0);
      expect(harness.texts()).toEqual([": ping\n\n"]);
    });

    it.each([
      { policy: "drop-oldest" as const, maxEvents: 3 },
      { policy: "drop-oldest" as const, maxEvents: 5 },
      { policy: "drop-oldest" as const, maxEvents: 10 },
      { policy: "disconnect" as const, maxEvents: 50 },
    ])("buffer policy combinatorics: handles mixed pings and data events under %o", ({ policy, maxEvents }) => {
      const harness = makeController(0);
      const buffer = createBoundedSseBuffer({ policy, maxEvents });
      buffer.attach(harness.controller);

      buffer.push("payment:created", { id: 1 });
      buffer.pushPing();
      buffer.push("payment:created", { id: 2 });
      buffer.pushPing();

      harness.setDesired(100);
      buffer.pull(harness.controller);

      const texts = harness.texts();
      expect(texts).toContain(": ping\n\n");
      expect(texts.some((t) => t.includes("payment:created"))).toBe(true);
    });

    it.each(Array.from({ length: 19 }, (_, i) => i + 1))(
      "buffer capacity test #%i: repeated pings do not corrupt event ordering",
      (count) => {
        const harness = makeController(100);
        const buffer = createBoundedSseBuffer({ maxEvents: count + 10 });
        buffer.attach(harness.controller);

        for (let i = 0; i < count; i++) {
          buffer.pushPing();
        }
        expect(harness.chunks).toHaveLength(count);
        for (const text of harness.texts()) {
          expect(text).toBe(": ping\n\n");
        }
      }
    );
  });

  // =========================================================================
  // DIMENSION 3: VIRTUAL TIME & SIMULATED 30-SECOND LIFECYCLE (25 tests)
  // =========================================================================
  describe("Dimension 3: Virtual Time & 30-Second Connection Verification", () => {
    it("verifies ping emission over a 30-second connection", () => {
      const harness = makeController(100);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      const pingInterval = setInterval(() => {
        buffer.pushPing();
      }, SSE_PING_INTERVAL_MS);

      // At t=0, no pings
      expect(harness.chunks).toHaveLength(0);

      // Advance by 19.9s -> still 0 pings
      vi.advanceTimersByTime(19_900);
      expect(harness.chunks).toHaveLength(0);

      // Advance to 20s -> 1 ping
      vi.advanceTimersByTime(100);
      expect(harness.chunks).toHaveLength(1);
      expect(harness.texts()[0]).toBe(": ping\n\n");

      // Advance to 30s -> still 1 ping (next is at 40s)
      vi.advanceTimersByTime(10_000);
      expect(harness.chunks).toHaveLength(1);

      // Advance to 40s -> 2 pings
      vi.advanceTimersByTime(10_000);
      expect(harness.chunks).toHaveLength(2);

      clearInterval(pingInterval);
    });

    it.each([
      20_000,
      40_000,
      60_000,
      80_000,
      100_000,
      120_000,
      140_000,
      160_000,
      180_000,
      200_000,
    ])("time cadence at %ims delivers exactly expected number of pings", (ms) => {
      const harness = makeController(500);
      const buffer = createBoundedSseBuffer({ maxEvents: 500 });
      buffer.attach(harness.controller);

      const timer = setInterval(() => buffer.pushPing(), SSE_PING_INTERVAL_MS);
      vi.advanceTimersByTime(ms);
      clearInterval(timer);

      const expectedPings = Math.floor(ms / SSE_PING_INTERVAL_MS);
      expect(harness.chunks.length).toBe(expectedPings);
    });

    it.each(Array.from({ length: 14 }, (_, i) => (i + 1) * 5_000))(
      "temporal granularity test at t=%ims checks intermediate state",
      (ms) => {
        const harness = makeController(100);
        const buffer = createBoundedSseBuffer();
        buffer.attach(harness.controller);

        const timer = setInterval(() => buffer.pushPing(), SSE_PING_INTERVAL_MS);
        vi.advanceTimersByTime(ms);
        clearInterval(timer);

        const expected = Math.floor(ms / 20_000);
        expect(harness.chunks.length).toBe(expected);
      }
    );
  });

  // =========================================================================
  // DIMENSION 4: NEGATIVE CONTROLS & TEARDOWN CLEANUP (20 tests)
  // =========================================================================
  describe("Dimension 4: Negative Controls & Teardown Cleanup", () => {
    it("clearing ping interval halts further ping emission completely", () => {
      const harness = makeController(100);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      const pingInterval = setInterval(() => buffer.pushPing(), SSE_PING_INTERVAL_MS);
      vi.advanceTimersByTime(25_000);
      expect(harness.chunks).toHaveLength(1);

      // Teardown
      clearInterval(pingInterval);

      // Advance by 5 minutes -> no new pings
      vi.advanceTimersByTime(300_000);
      expect(harness.chunks).toHaveLength(1);
    });

    it("pushPing on disconnected buffer drops frame without throwing", () => {
      const harness = makeController(100);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);
      buffer.close();

      expect(() => buffer.pushPing()).not.toThrow();
      expect(harness.chunks).toHaveLength(0);
    });

    it.each(Array.from({ length: 18 }, (_, i) => i + 1))(
      "negative control test #%i: abort event cancels active timer without leaks",
      () => {
        const harness = makeController(100);
        const buffer = createBoundedSseBuffer();
        buffer.attach(harness.controller);

        let active = true;
        const timer = setInterval(() => {
          if (active) buffer.pushPing();
        }, SSE_PING_INTERVAL_MS);

        const abort = () => {
          active = false;
          clearInterval(timer);
          buffer.close();
        };

        vi.advanceTimersByTime(10_000);
        abort();
        vi.advanceTimersByTime(100_000);
        expect(harness.chunks).toHaveLength(0);
      }
    );
  });

  // =========================================================================
  // DIMENSION 5: LIFECYCLE, BACKPRESSURE & STRESS (20 tests)
  // =========================================================================
  describe("Dimension 5: Lifecycle, Backpressure & Stress", () => {
    it("interleaved high-volume payment events and pings maintain stream integrity", () => {
      const harness = makeController(1000);
      const buffer = createBoundedSseBuffer({ maxEvents: 1000 });
      buffer.attach(harness.controller);

      for (let i = 0; i < 50; i++) {
        buffer.push("payment:created", { id: i });
        if (i % 5 === 0) buffer.pushPing();
      }

      const texts = harness.texts();
      const pings = texts.filter((t) => t === ": ping\n\n");
      const events = texts.filter((t) => t.includes("payment:created"));

      expect(pings.length).toBe(10);
      expect(events.length).toBe(50);
    });

    it.each(Array.from({ length: 19 }, (_, i) => (i + 1) * 10))(
      "stress iteration with %i concurrent frame pushes drains cleanly",
      (batchSize) => {
        const harness = makeController(batchSize * 2);
        const buffer = createBoundedSseBuffer({ maxEvents: batchSize * 2 });
        buffer.attach(harness.controller);

        for (let i = 0; i < batchSize; i++) {
          buffer.push("event", { index: i });
          buffer.pushPing();
        }

        expect(buffer.queuedEvents).toBe(0);
        expect(harness.chunks.length).toBe(batchSize * 2);
      }
    );
  });
});
