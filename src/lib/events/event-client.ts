// SPDX-License-Identifier: MIT

/**
 * Live event client with transport fallback.
 *
 * Prefers the WebSocket channel (lower latency push); falls back to the SSE
 * route when WebSockets are unsupported or unreachable. Reconnects dropped
 * WebSocket connections with exponential backoff, and deduplicates events by
 * their contract id so a reconnect never replays a duplicate into the UI.
 */

import type { LiveEvent } from "./event-source";

export type LiveTransport = "ws" | "sse";
export type LiveStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "fallback"
  | "offline";

export interface LiveEventsClientOptions {
  /** WebSocket endpoint. Defaults to ws(s)://<host>:<EVENTS_WS_PORT>/api/events */
  wsUrl?: string;
  /** SSE endpoint (same-origin). Defaults to /api/events. */
  sseUrl?: string;
  /** Cap for the exponential reconnect backoff, in ms. */
  maxBackoffMs?: number;
  /** WebSocket reconnects before giving up and falling back to SSE. */
  maxReconnectAttempts?: number;
  /** How many recent event ids to remember for dedup. */
  dedupWindow?: number;
  onEvent: (event: LiveEvent) => void;
  onStatus?: (status: LiveStatus, transport: LiveTransport) => void;
}

const DEFAULT_WS_PORT = "8787";

function defaultWsUrl(): string {
  const port = process.env.NEXT_PUBLIC_EVENTS_WS_PORT || DEFAULT_WS_PORT;
  const isSecure =
    typeof location !== "undefined" && location.protocol === "https:";
  const host = typeof location !== "undefined" ? location.hostname : "localhost";
  return `${isSecure ? "wss" : "ws"}://${host}:${port}/api/events`;
}

/** Event names emitted by the SSE route. */
const SSE_EVENT_NAMES = ["connected", "heartbeat", "payment:created"] as const;

/**
 * Connect to the live event stream. Returns a disconnect function.
 */
export function connectLiveEvents(
  options: LiveEventsClientOptions
): () => void {
  const sseUrl = options.sseUrl ?? "/api/events";
  const maxBackoff = options.maxBackoffMs ?? 10_000;
  const maxAttempts = options.maxReconnectAttempts ?? 3;
  const dedupWindow = options.dedupWindow ?? 1000;

  // Bounded set of seen event ids — the idempotency guard across reconnects.
  const seen = new Set<number>();
  const acceptEvent = (raw: unknown) => {
    const event = raw as LiveEvent;
    if (event && typeof event === "object" && typeof event.id === "number") {
      if (seen.has(event.id)) return; // duplicate on reconnect — drop
      seen.add(event.id);
      if (seen.size > dedupWindow) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    }
    options.onEvent(event);
  };

  let dispose: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackActive = false;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  // ── SSE transport (fallback) ──────────────────────────────────

  const connectSse = () => {
    fallbackActive = true;
    options.onStatus?.("connecting", "sse");

    const es = new EventSource(sseUrl);
    const onMessage = (e: MessageEvent) => {
      try {
        acceptEvent(JSON.parse(e.data as string));
      } catch {
        // ignore malformed frames
      }
    };
    for (const name of SSE_EVENT_NAMES) {
      es.addEventListener(name, onMessage);
    }

    es.onopen = () => options.onStatus?.("live", "sse");
    // Native EventSource reconnects on its own; surface the state.
    es.onerror = () => options.onStatus?.("offline", "sse");

    dispose = () => {
      for (const name of SSE_EVENT_NAMES) {
        es.removeEventListener(name, onMessage);
      }
      es.close();
    };
  };

  // ── WebSocket transport (preferred) ───────────────────────────

  const connectWs = (attempt: number): void => {
    if (fallbackActive) return;

    options.onStatus?.("connecting", "ws");
    const ws = new WebSocket(options.wsUrl ?? defaultWsUrl());
    let everOpened = false;
    let closed = false;

    const cleanup = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    };

    ws.onopen = () => {
      everOpened = true;
      options.onStatus?.("live", "ws");
    };

    ws.onmessage = (e) => {
      try {
        acceptEvent(JSON.parse(String(e.data)));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      // onclose follows; all state transitions happen there.
    };

    ws.onclose = () => {
      if (closed) return;
      closed = true;
      cleanup();

      if (!everOpened) {
        // Never connected — the WS server is unreachable. Fall back to SSE.
        options.onStatus?.("fallback", "sse");
        connectSse();
        return;
      }

      if (attempt >= maxAttempts) {
        // Repeated drops — give up on WS and fall back to SSE.
        options.onStatus?.("fallback", "sse");
        connectSse();
        return;
      }

      // Exponential backoff, capped.
      const delay = Math.min(maxBackoff, 250 * 2 ** attempt);
      options.onStatus?.("reconnecting", "ws");
      reconnectTimer = setTimeout(() => connectWs(attempt + 1), delay);
    };

    dispose = cleanup;
  };

  // ── Selection ──────────────────────────────────────────────────

  if (typeof WebSocket !== "undefined") {
    connectWs(0);
  } else {
    connectSse();
  }

  return () => {
    clearTimers();
    dispose?.();
    dispose = null;
  };
}
