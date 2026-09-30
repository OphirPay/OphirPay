// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

/**
 * SSE (Server-Sent Events) endpoint for real-time payment event streaming.
 *
 * GET /api/events — subscribe to live payment events
 *
 * Events emitted:
 * - connected — stream established
 * - heartbeat — keep-alive ping every 15 seconds
 * - payment:created — new payment event detected from emitter contract
 * - error — slow-consumer disconnect (see docs/SSE.md)
 *
 * The stream comes from the shared `createLiveEventSource` (also used by the
 * WebSocket channel), so both transports deliver the same events.
 *
 * ## Backpressure (issue #744)
 *
 * Frames go through `createBoundedSseBuffer`, which caps the per-connection
 * outbound queue (events + bytes) and applies a documented slow-consumer
 * policy — drop-oldest with a `: dropped N …` marker. A stalled client can
 * therefore never grow server memory without bound, and the
 * `ophirpay_sse_open_connections` gauge is released on teardown.
 */

import { createLiveEventSource } from "@/lib/events/event-source";
import { createBoundedSseBuffer } from "@/lib/events/sse-buffer";
import { incMetric } from "@/lib/metrics-counters";

export const dynamic = "force-dynamic";

/** Maximum buffered events per connection before the policy applies. */
export const SSE_MAX_BUFFERED_EVENTS = 100;
/** Maximum buffered bytes per connection before the policy applies. */
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;
/** Close a backlogged connection that hasn't drained within this budget. */
export const SSE_IDLE_TIMEOUT_MS = 60_000;
/** Heartbeat cadence — also keeps proxies from closing an idle stream. */
export const SSE_HEARTBEAT_MS = 15_000;

export const GET = withMetrics("GET /api/events", async function GET(request: Request) {
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let source: ReturnType<typeof createLiveEventSource> | null = null;

  // Release the connection exactly once — from the client abort, an overflow
  // disconnect, or a stream cancel.
  const teardown = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (source) source.stop();
    // Release the connection from the `ophirpay_sse_open_connections` gauge
    // (visible on /api/metrics) so operators and the SSE load test can verify
    // connections are released when clients disconnect.
    incMetric("sse_open_connections", -1);
  };

  let lastDropped = 0;
  const buffer = createBoundedSseBuffer({
    policy: "drop-oldest",
    maxEvents: SSE_MAX_BUFFERED_EVENTS,
    maxBytes: SSE_MAX_BUFFERED_BYTES,
    idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
    onOverflow: (info) => {
      const delta = info.droppedEvents - lastDropped;
      if (delta > 0) incMetric("sse_dropped_events_total", delta);
      lastDropped = info.droppedEvents;
    },
    onDisconnect: teardown,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Bind the controller so pushes can drain while the consumer has demand.
      buffer.attach(controller);

      // Track the open connection on the `ophirpay_sse_open_connections`
      // gauge (visible on /api/metrics).
      incMetric("sse_open_connections");

      // Heartbeat every 15s to keep the connection alive through proxies.
      heartbeat = setInterval(() => {
        buffer.push("heartbeat", { timestamp: Date.now() });
      }, SSE_HEARTBEAT_MS);

      // Poll the emitter contract and forward normalized events.
      source = createLiveEventSource();
      source.start((event) => buffer.push(event.event, event));

      // Initial connected event.
      buffer.push("connected", {
        message: "SSE stream connected to emitter contract",
      });

      // Teardown when the request is aborted; stream cancellation also invokes
      // the cancel callback below.
      request.signal.addEventListener("abort", teardown, { once: true });
    },
    pull(controller) {
      buffer.pull(controller);
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
