// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectLiveEvents } from "@/lib/events/event-client";
import type { LiveEvent } from "@/lib/events/event-source";

// ── Fake browser transports ─────────────────────────────────────

const mocks = vi.hoisted(() => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static reset() {
      FakeWebSocket.instances = [];
    }
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    closed = false;

    constructor(url: string) {
      this.url = url;
      FakeWebSocket.instances.push(this);
    }

    close() {
      this.closed = true;
    }

    // Test drivers
    open() {
      this.onopen?.();
    }
    receive(data: string) {
      this.onmessage?.({ data });
    }
    /** Simulate the connection failing before it ever opens. */
    fail() {
      this.onerror?.();
      this.onclose?.();
    }
    /** Simulate an established connection dropping. */
    drop() {
      this.onclose?.();
    }
  }

  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    static reset() {
      FakeEventSource.instances = [];
    }
    url: string;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    private listeners = new Map<string, ((e: { data: string }) => void)[]>();

    constructor(url: string) {
      this.url = url;
      FakeEventSource.instances.push(this);
    }

    addEventListener(name: string, cb: (e: { data: string }) => void) {
      const arr = this.listeners.get(name) ?? [];
      arr.push(cb);
      this.listeners.set(name, arr);
    }

    removeEventListener(name: string, cb: (e: { data: string }) => void) {
      const arr = this.listeners.get(name) ?? [];
      this.listeners.set(name, arr.filter((c) => c !== cb));
    }

    close() {
      this.closed = true;
    }

    // Test driver
    emit(name: string, data: string) {
      for (const cb of this.listeners.get(name) ?? []) cb({ data });
    }
  }

  return { FakeWebSocket, FakeEventSource };
});

const WS_URL = "ws://localhost:8787/api/events";

function makeEvent(id: number): LiveEvent {
  return {
    id,
    event: "payment:created",
    timestamp: "2026-08-01T12:00:00.000Z",
    paymentId: `evt_${id}`,
    status: "COMPLETED",
    payer: "GPAYER",
    payee: "GPAYEE",
    amount: "10000000",
    txHash: "abcdef",
  };
}

beforeEach(() => {
  mocks.FakeWebSocket.reset();
  mocks.FakeEventSource.reset();
  vi.stubGlobal("WebSocket", mocks.FakeWebSocket);
  vi.stubGlobal("EventSource", mocks.FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────

describe("connectLiveEvents", () => {
  it("prefers WebSocket when the browser supports it", () => {
    const events: LiveEvent[] = [];
    const statuses: string[] = [];
    const disconnect = connectLiveEvents({
      wsUrl: WS_URL,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
    });

    expect(mocks.FakeWebSocket.instances).toHaveLength(1);
    expect(mocks.FakeWebSocket.instances[0].url).toBe(WS_URL);
    expect(mocks.FakeEventSource.instances).toHaveLength(0);

    const ws = mocks.FakeWebSocket.instances[0];
    ws.open();
    expect(statuses).toContain("live");

    ws.receive(JSON.stringify(makeEvent(5)));
    expect(events.map((e) => e.id)).toEqual([5]);

    disconnect();
    expect(ws.closed).toBe(true);
  });

  it("deduplicates events by id so reconnects never replay duplicates", () => {
    const events: LiveEvent[] = [];
    const disconnect = connectLiveEvents({
      wsUrl: WS_URL,
      onEvent: (e) => events.push(e),
    });

    const ws = mocks.FakeWebSocket.instances[0];
    ws.open();
    ws.receive(JSON.stringify(makeEvent(5)));
    ws.receive(JSON.stringify(makeEvent(5))); // duplicate from a reconnect
    ws.receive(JSON.stringify(makeEvent(6)));
    ws.receive(JSON.stringify({ event: "connected", message: "hi" })); // no id — passes through

    expect(events.map((e) => e.id)).toEqual([5, 6, undefined]);
    disconnect();
  });

  it("falls back to SSE when WebSocket is unsupported", () => {
    vi.stubGlobal("WebSocket", undefined);

    const events: LiveEvent[] = [];
    const disconnect = connectLiveEvents({
      onEvent: (e) => events.push(e),
    });

    expect(mocks.FakeEventSource.instances).toHaveLength(1);
    expect(mocks.FakeEventSource.instances[0].url).toBe("/api/events");

    // SSE named events are parsed and forwarded.
    const es = mocks.FakeEventSource.instances[0];
    es.emit("payment:created", JSON.stringify(makeEvent(9)));
    expect(events.map((e) => e.id)).toEqual([9]);

    disconnect();
    expect(es.closed).toBe(true);
  });

  it("falls back to SSE when the WebSocket endpoint is unreachable", () => {
    const statuses: string[] = [];
    const disconnect = connectLiveEvents({
      wsUrl: WS_URL,
      onStatus: (s) => statuses.push(s),
      onEvent: () => {},
    });

    const ws = mocks.FakeWebSocket.instances[0];
    ws.fail(); // errors out before ever opening

    expect(mocks.FakeEventSource.instances).toHaveLength(1);
    expect(statuses).toContain("fallback");
    disconnect();
  });

  it("reconnects dropped WebSockets with backoff, then falls back to SSE", () => {
    vi.useFakeTimers();
    const statuses: string[] = [];

    connectLiveEvents({
      wsUrl: WS_URL,
      maxReconnectAttempts: 2,
      onStatus: (s) => statuses.push(s),
      onEvent: () => {},
    });

    let ws = mocks.FakeWebSocket.instances[0];
    ws.open();
    ws.drop();

    expect(statuses).toContain("reconnecting");
    expect(mocks.FakeWebSocket.instances).toHaveLength(1);

    // Attempt 1 after 250ms backoff.
    vi.advanceTimersByTime(250);
    expect(mocks.FakeWebSocket.instances).toHaveLength(2);
    ws = mocks.FakeWebSocket.instances[1];
    ws.open();
    ws.drop();

    // Attempt 2 after 500ms backoff (250 * 2^1).
    vi.advanceTimersByTime(500);
    expect(mocks.FakeWebSocket.instances).toHaveLength(3);
    ws = mocks.FakeWebSocket.instances[2];
    ws.open();
    ws.drop();

    // Exhausted reconnects → permanent SSE fallback, no more WS attempts.
    expect(mocks.FakeEventSource.instances).toHaveLength(1);
    expect(statuses.filter((s) => s === "fallback")).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(mocks.FakeWebSocket.instances).toHaveLength(3);
  });

  it("caps reconnect backoff at maxBackoffMs", () => {
    vi.useFakeTimers();
    connectLiveEvents({
      wsUrl: WS_URL,
      maxBackoffMs: 400,
      maxReconnectAttempts: 10,
      onStatus: () => {},
      onEvent: () => {},
    });

    let ws = mocks.FakeWebSocket.instances[0];
    ws.open();
    ws.drop();
    vi.advanceTimersByTime(250);
    expect(mocks.FakeWebSocket.instances).toHaveLength(2);

    // Long gaps between drops keep the delay pinned at the cap (400ms),
    // never 2^4 * 250 = 4000ms.
    ws = mocks.FakeWebSocket.instances[1];
    ws.open();
    ws.drop();
    vi.advanceTimersByTime(400);
    expect(mocks.FakeWebSocket.instances).toHaveLength(3);
  });
});
