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
 *
 * The stream comes from the shared `createLiveEventSource` (also used by the
 * WebSocket channel), so both transports deliver the same events.
 */

import { createLiveEventSource } from "@/lib/events/event-source";
import { incMetric } from "@/lib/metrics-counters";

export const dynamic = "force-dynamic";

export const GET = withMetrics("GET /api/events", async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Stream lifecycle state lives here, keyed to the controller's own
      // AbortSignal (ReadableStreamDefaultController.signal) — the one hook
      // the Streams implementation reliably fires when the consumer cancels
      // the stream / the client disconnects. A cleanup function returned from
      // `start()` is NOT invoked by the spec, so relying on it leaks
      // connections, intervals and event sources.
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let source: ReturnType<typeof createLiveEventSource> | null = null;

      const teardown = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (source) source.stop();
        // Release the connection from the `ophirpay_sse_open_connections`
        // gauge (visible on /api/metrics) so operators and the SSE load test
        // can verify connections are released when clients disconnect.
        incMetric("sse_open_connections", -1);
      };

      // Track the open connection on the `ophirpay_sse_open_connections`
      // gauge (visible on /api/metrics).
      incMetric("sse_open_connections");

      const send = (eventName: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          closed = true;
        }
      };

      // Heartbeat every 15s to keep connection alive
      heartbeat = setInterval(() => {
        send("heartbeat", { timestamp: Date.now() });
      }, 15000);

      // Poll the emitter contract and forward normalized events.
      source = createLiveEventSource();
      source.start((event) => send(event.event, event));

      // Initial connected event
      send("connected", {
        message: "SSE stream connected to emitter contract",
      });

      // Teardown when the client disconnects: the controller's signal aborts
      // when the stream is cancelled/errored at the consumer end (Node >= 20
      // exposes it on ReadableStreamDefaultController). The request signal is
      // a fallback for runtimes that surface the drop differently.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- controller.signal is not yet in the TS Streams typings (same pattern as the audit-log SSE route).
      (controller as any).signal?.addEventListener("abort", teardown, { once: true });
      request.signal.addEventListener("abort", teardown, { once: true });
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