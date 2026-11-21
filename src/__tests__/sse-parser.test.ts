// SPDX-License-Identifier: MIT

/**
 * SSE keep-alive comment frames on the client.
 *
 * The server emits `: ping` comment frames to keep proxies from dropping an
 * idle stream. A comment must be swallowed by the stream parser: it must not
 * reach any listener, so it cannot trigger a callback or a React re-render.
 * Real `data:` events must still parse and dispatch normally.
 *
 * Browsers do the frame parsing natively inside `EventSource`. The stand-in
 * below reproduces the WHATWG parsing rules at the wire level (line buffering,
 * `:` comments, `event:`/`data:` fields, blank-line dispatch) so the real
 * client code can be driven with raw stream text — including the exact bytes
 * the server's own encoder produces.
 */

import { act,renderHook } from "@testing-library/react";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { useNotifications } from "@/hooks/useNotifications";
import { connectLiveEvents, type LiveStatus } from "@/lib/events/event-client";
import type { LiveEvent } from "@/lib/events/event-source";
import { encodeSseComment, encodeSseFrame } from "@/lib/events/sse-buffer";

// ── Wire-level EventSource stand-in ─────────────────────────────

type Listener = (e: { data: string }) => void;

class WireEventSource {
  static instances: WireEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  /** Number of events the parser actually dispatched to listeners. */
  dispatched = 0;

  private listeners = new Map<string, Listener[]>();
  private buffer = "";
  private eventType = "";
  private dataLines: string[] = [];

  constructor(url: string) {
    this.url = url;
    WireEventSource.instances.push(this);
  }

  addEventListener(name: string, cb: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
  }

  removeEventListener(name: string, cb: Listener) {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((c) => c !== cb),
    );
  }

  close() {
    this.closed = true;
  }

  /** Deliver raw stream text, in whatever chunking the test chooses. */
  feed(chunk: string | Uint8Array) {
    this.buffer +=
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

    for (;;) {
      const eol = this.buffer.match(/\r?\n/);
      if (!eol || eol.index === undefined) return;
      const line = this.buffer.slice(0, eol.index);
      this.buffer = this.buffer.slice(eol.index + eol[0].length);
      this.processLine(line);
    }
  }

  private processLine(line: string) {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return; // comment — ignored by spec

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") this.eventType = value;
    else if (field === "data") this.dataLines.push(value);
  }

  private dispatch() {
    const name = this.eventType || "message";
    const data = this.dataLines.join("\n");
    const hadData = this.dataLines.length > 0;
    this.eventType = "";
    this.dataLines = [];
    if (!hadData) return; // a frame with no data never dispatches

    this.dispatched++;
    for (const cb of this.listeners.get(name) ?? []) cb({ data });
  }
}

const PING = ": ping\n\n";

const latest = () => WireEventSource.instances[WireEventSource.instances.length - 1];

function liveEvent(id: number): LiveEvent {
  return {
    id,
    event: "payment:created",
    timestamp: "2026-08-01T12:00:00.000Z",
    paymentId: `evt_${id}`,
    status: "COMPLETED",
    payer: "GPAYER",
    payee: "GPAYEE",
    amount: "10000000",
    txHash: `tx${id}`,
  };
}

beforeEach(() => {
  WireEventSource.instances = [];
  window.sessionStorage.clear();
  window.sessionStorage.setItem("ophirpay-notifications", JSON.stringify([]));
  vi.stubGlobal("EventSource", WireEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════
// connectLiveEvents — SSE transport
// ═══════════════════════════════════════════════════════════════

describe("connectLiveEvents — SSE keep-alive comments", () => {
  function connect() {
    // No WebSocket → the client goes straight to the SSE transport.
    vi.stubGlobal("WebSocket", undefined);
    const onEvent = vi.fn<(e: LiveEvent) => void>();
    const onStatus = vi.fn<(s: LiveStatus, t: "ws" | "sse") => void>();
    const disconnect = connectLiveEvents({ onEvent, onStatus });
    return { onEvent, onStatus, disconnect, es: latest() };
  }

  it("ignores `: ping` comment frames without calling the listener", () => {
    const { onEvent, es } = connect();

    es.feed(PING);
    es.feed(PING);
    es.feed(PING);

    expect(onEvent).not.toHaveBeenCalled();
    expect(es.dispatched).toBe(0);
  });

  it("does not change connection status on a ping", () => {
    const { onStatus, es } = connect();
    const before = onStatus.mock.calls.length;

    es.feed(PING);

    expect(onStatus.mock.calls.length).toBe(before);
    expect(es.closed).toBe(false);
  });

  it("ignores the exact comment bytes the server encoder produces", () => {
    const { onEvent, es } = connect();

    es.feed(encodeSseComment("ping"));

    expect(onEvent).not.toHaveBeenCalled();
    expect(es.dispatched).toBe(0);
  });

  it("ignores a ping that arrives split across network chunks", () => {
    const { onEvent, es } = connect();

    es.feed(": pi");
    es.feed("ng\n");
    es.feed("\n");

    expect(onEvent).not.toHaveBeenCalled();
    expect(es.dispatched).toBe(0);
  });

  it("ignores CRLF-terminated comment frames", () => {
    const { onEvent, es } = connect();

    es.feed(": ping\r\n\r\n");

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("parses and dispatches a standard data event", () => {
    const { onEvent, es } = connect();

    es.feed(encodeSseFrame("payment:created", liveEvent(1)));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(liveEvent(1));
  });

  it("dispatches only the real events when pings are interleaved", () => {
    const { onEvent, es } = connect();

    es.feed(PING);
    es.feed(encodeSseFrame("payment:created", liveEvent(1)));
    es.feed(PING);
    es.feed(PING);
    es.feed(encodeSseFrame("payment:created", liveEvent(2)));
    es.feed(PING);

    expect(onEvent.mock.calls.map(([e]) => e.id)).toEqual([1, 2]);
    expect(es.dispatched).toBe(2);
  });

  it("still dispatches an event whose frame contains a comment line", () => {
    const { onEvent, es } = connect();

    es.feed(
      `: ping\nevent: payment:created\ndata: ${JSON.stringify(liveEvent(7))}\n\n`,
    );

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].id).toBe(7);
  });

  it("reassembles an event delivered in several chunks around a ping", () => {
    const { onEvent, es } = connect();
    const frame = new TextDecoder().decode(
      encodeSseFrame("payment:created", liveEvent(3)),
    );
    const mid = Math.floor(frame.length / 2);

    es.feed(frame.slice(0, mid));
    es.feed(frame.slice(mid));
    es.feed(PING);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].id).toBe(3);
  });

  it("drops malformed JSON data without throwing and keeps working", () => {
    const { onEvent, es } = connect();

    expect(() =>
      es.feed("event: payment:created\ndata: {not json\n\n"),
    ).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();

    es.feed(encodeSseFrame("payment:created", liveEvent(4)));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("does not re-dispatch a replayed event id after pings", () => {
    const { onEvent, es } = connect();

    es.feed(encodeSseFrame("payment:created", liveEvent(5)));
    es.feed(PING);
    es.feed(encodeSseFrame("payment:created", liveEvent(5)));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// useNotifications — no re-render on keep-alive
// ═══════════════════════════════════════════════════════════════

describe("useNotifications — SSE keep-alive comments", () => {
  function mountHook() {
    let renders = 0;
    const hook = renderHook(() => {
      renders++;
      return useNotifications();
    });
    return { ...hook, renders: () => renders, es: latest() };
  }

  it("does not re-render the hook for ping comments", () => {
    const { result, renders, es } = mountHook();
    const rendersBefore = renders();
    const notificationsBefore = result.current.notifications;

    es.feed(PING);
    es.feed(PING);
    es.feed(PING);

    expect(renders()).toBe(rendersBefore);
    expect(result.current.notifications).toBe(notificationsBefore);
    expect(es.dispatched).toBe(0);
  });

  it("leaves the connected flag untouched by pings", () => {
    const { result, es } = mountHook();

    act(() => es.feed(encodeSseFrame("connected", {})));
    expect(result.current.isConnected).toBe(true);

    es.feed(PING);

    expect(result.current.isConnected).toBe(true);
  });

  it("still updates state for a real event that follows pings", () => {
    const { result, renders, es } = mountHook();

    es.feed(PING);
    const rendersBefore = renders();

    act(() =>
      es.feed(
        encodeSseFrame("payment:created", {
          type: "payment.sent",
          amount: "50000000",
          payee: "GBBD7KVXOMWBKLY2C7Q6RN2P2VY3NXN3T1234",
          txHash: "sse-tx-1",
        }),
      ),
    );

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].txHash).toBe("sse-tx-1");
    expect(renders()).toBeGreaterThan(rendersBefore);
  });
});
