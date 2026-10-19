// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createBoundedSseBuffer,
  encodeSseComment,
} from "@/lib/events/sse-buffer";
import { GET as eventsGet, SSE_PING_INTERVAL_MS } from "@/app/api/events/route";
import { GET as auditSseGet, AUDIT_SSE_PING_INTERVAL_MS } from "@/app/api/audit-log/sse/route";

const decoder = new TextDecoder();

function makeMockController(initialDesired = 1) {
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
    raw: () => chunks.map((c) => decoder.decode(c)).join(""),
    setDesired: (n: number) => {
      desired = n;
    },
    isClosed: () => closed,
  };
}

describe("SSE Keep-Alive Ping Telemetry (#1289)", () => {
  describe("sse-buffer ping & comment support", () => {
    it("encodes SSE comments correctly with ': text\\n\\n'", () => {
      const comment = encodeSseComment("ping");
      expect(decoder.decode(comment)).toBe(": ping\n\n");
    });

    it("emits ping frames through buffer.ping() when client has demand", () => {
      const harness = makeMockController(1);
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      buffer.ping();
      expect(harness.texts()).toEqual([": ping\n\n"]);
    });

    it("queues and drains ping comments correctly for slow consumers", () => {
      const harness = makeMockController(0); // stalled
      const buffer = createBoundedSseBuffer();
      buffer.attach(harness.controller);

      buffer.push("data", { a: 1 });
      buffer.ping();

      expect(harness.chunks).toHaveLength(0); // buffered
      expect(buffer.queuedEvents).toBe(2);

      // Reader resumes
      harness.setDesired(10);
      buffer.pull(harness.controller);

      expect(buffer.queuedEvents).toBe(0);
      expect(harness.texts()).toContain(": ping\n\n");
    });
  });

  describe("API routes keep-alive ping integration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("GET /api/events emits : ping frame every 20s and survives 30s connection", async () => {
      const abortController = new AbortController();
      const request = new Request("http://localhost/api/events", {
        signal: abortController.signal,
      });

      const response = await eventsGet(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      // Read initial connected event
      const initial = await reader!.read();
      expect(decoder.decode(initial.value)).toContain("connected");

      // Advance time by 20s: 15s heartbeat + 20s ping emitted
      await vi.advanceTimersByTimeAsync(SSE_PING_INTERVAL_MS);
      const heartbeat1 = await reader!.read();
      expect(decoder.decode(heartbeat1.value)).toContain("heartbeat");
      const ping1 = await reader!.read();
      expect(decoder.decode(ping1.value)).toContain(": ping\n\n");

      // Advance time by 10s (cumulative 30s connection): 30s heartbeat emitted
      await vi.advanceTimersByTimeAsync(10_000);
      const heartbeat2 = await reader!.read();
      expect(decoder.decode(heartbeat2.value)).toContain("heartbeat");

      // Advance time by another 10s (cumulative 40s): 2nd ping emitted at 40s
      await vi.advanceTimersByTimeAsync(10_000);
      const ping2 = await reader!.read();
      expect(decoder.decode(ping2.value)).toContain(": ping\n\n");

      // Connection cleanup on client abort
      abortController.abort();
      await reader!.cancel();
    });

    it("GET /api/audit-log/sse emits : ping comments and cleans up on cancel", async () => {
      const response = await auditSseGet();
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      // Read initial connected event
      const initial = await reader!.read();
      expect(decoder.decode(initial.value)).toContain("connected");

      // Fast forward by 20s to trigger ping
      await vi.advanceTimersByTimeAsync(AUDIT_SSE_PING_INTERVAL_MS);
      const pingChunk = await reader!.read();
      expect(decoder.decode(pingChunk.value)).toContain(": ping\n\n");

      // Cancel stream
      await reader!.cancel();
    });
  });
});
