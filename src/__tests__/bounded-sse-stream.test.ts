// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBoundedSseStream } from "@/lib/events/bounded-sse-stream";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";
import { LiveEventsWsServer } from "@/lib/events/live-events-ws-server";
import { Duplex } from "node:stream";

describe("Bounded SSE Stream (Issue #744)", () => {
  beforeEach(() => {
    resetMetricsForTest();
  });

  afterEach(() => {
    resetMetricsForTest();
  });

  it("increments sse_open_connections gauge on connect and decrements on close", () => {
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);

    const handle = createBoundedSseStream({
      heartbeatIntervalMs: 60_000,
    });

    expect(getMetricsSnapshot().sse_open_connections).toBe(1);
    expect(handle.isClosed()).toBe(false);

    handle.close();

    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
    expect(handle.isClosed()).toBe(true);

    // Calling close again is idempotent
    handle.close();
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
  });

  it("formats SSE events properly and streams to consumer", async () => {
    const handle = createBoundedSseStream({
      heartbeatIntervalMs: 60_000,
    });

    const reader = handle.stream.getReader();
    const decoder = new TextDecoder();

    handle.send("connected", { message: "ok" });
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe('event: connected\ndata: {"message":"ok"}\n\n');

    handle.send("payment:created", { id: 123, amount: "10.00" });
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(decoder.decode(second.value)).toBe('event: payment:created\ndata: {"id":123,"amount":"10.00"}\n\n');

    await reader.cancel();
    expect(handle.isClosed()).toBe(true);
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
  });

  it("enforces maxBufferSize and drops oldest events with drop marker frame", async () => {
    const maxBufferSize = 3;
    const handle = createBoundedSseStream({
      maxBufferSize,
      heartbeatIntervalMs: 60_000,
    });

    const reader = handle.stream.getReader();
    const decoder = new TextDecoder();

    // First event fills controller queue
    handle.send("initial", { seq: 0 });

    // Now fill buffer beyond capacity (maxBufferSize = 3) without consumer reading
    for (let i = 1; i <= 5; i++) {
      handle.send("data", { seq: i });
    }

    // Capacity was 3, 5 items sent -> 2 items dropped (seq: 1 and seq: 2)
    expect(handle.getBufferedCount()).toBe(3);
    expect(handle.getDroppedCount()).toBe(2);

    // Consumer reads initial event
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    expect(decoder.decode(firstChunk.value)).toContain("initial");

    // Next pull should receive the drop marker frame
    const dropChunk = await reader.read();
    expect(dropChunk.done).toBe(false);
    const dropText = decoder.decode(dropChunk.value);
    expect(dropText).toContain("event: drop");
    expect(dropText).toContain('"dropped":2');
    expect(dropText).toContain('"reason":"slow_consumer_buffer_overflow"');

    // Followed by surviving buffered events: seq 3, 4, 5
    const chunk3 = await reader.read();
    expect(decoder.decode(chunk3.value)).toContain('"seq":3');

    const chunk4 = await reader.read();
    expect(decoder.decode(chunk4.value)).toContain('"seq":4');

    const chunk5 = await reader.read();
    expect(decoder.decode(chunk5.value)).toContain('"seq":5');

    await reader.cancel();
  });

  it("terminates stalled consumer after idleTimeoutMs when buffer has unconsumed data", async () => {
    const onTeardown = vi.fn();
    const handle = createBoundedSseStream({
      maxBufferSize: 5,
      idleTimeoutMs: 60,
      watchdogIntervalMs: 20,
      heartbeatIntervalMs: 60_000,
      onTeardown,
    });

    // Send data into the stream that the consumer will stall on (not read)
    handle.send("queued", { stalled: true });
    expect(handle.isClosed()).toBe(false);

    // Wait past the idle timeout
    await new Promise((resolve) => setTimeout(resolve, 140));

    expect(handle.isClosed()).toBe(true);
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
  });

  it("cleans up on requestSignal abort", async () => {
    const controller = new AbortController();
    const onTeardown = vi.fn();

    const handle = createBoundedSseStream({
      requestSignal: controller.signal,
      onTeardown,
    });

    expect(handle.isClosed()).toBe(false);
    expect(getMetricsSnapshot().sse_open_connections).toBe(1);

    controller.abort();

    expect(handle.isClosed()).toBe(true);
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
  });

  it("handles pre-aborted requestSignal gracefully", () => {
    const controller = new AbortController();
    controller.abort();
    const onTeardown = vi.fn();

    const handle = createBoundedSseStream({
      requestSignal: controller.signal,
      onTeardown,
    });

    expect(handle.isClosed()).toBe(true);
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(getMetricsSnapshot().sse_open_connections).toBe(0);
  });

  it("drops WebSocket slow consumers when outbound socket buffer exceeds maxBufferBytes", () => {
    const wsServer = new LiveEventsWsServer({
      maxBufferBytes: 500,
    });

    class MockSocket extends Duplex {
      destroyed = false;
      written: Buffer[] = [];

      _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.written.push(chunk);
        callback();
      }

      _read() {}

      destroy(error?: Error) {
        this.destroyed = true;
        return super.destroy(error);
      }
    }

    const healthySocket = new MockSocket();
    Object.defineProperty(healthySocket, "writableLength", { value: 100, configurable: true });

    const stalledSocket = new MockSocket();
    Object.defineProperty(stalledSocket, "writableLength", { value: 1000, configurable: true }); // Exceeds maxBufferBytes (500)

    // Register clients on wsServer private clients set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wsServer as any).clients.add({ socket: healthySocket, alive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wsServer as any).clients.add({ socket: stalledSocket, alive: true });

    wsServer.broadcast("test message");

    expect(healthySocket.destroyed).toBe(false);
    expect(stalledSocket.destroyed).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wsServer as any).clients.size).toBe(1);
  });
});
