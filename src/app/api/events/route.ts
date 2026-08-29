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

import {
  createLiveEventSource,
  type LiveEventSource,
  type LiveEvent,
} from "@/lib/events/event-source";

export const dynamic = "force-dynamic";

export interface SSERouteOptions {
  heartbeatIntervalMs?: number;
  eventSourceFactory?: () => LiveEventSource;
}

/**
 * Creates an SSE streaming response with lifecycle management and cleanup.
 */
export function createEventsStreamResponse(
  options: SSERouteOptions = {},
  req?: Request
): Response {
  const encoder = new TextEncoder();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
  const eventSourceFactory =
    options.eventSourceFactory ?? createLiveEventSource;

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let source: LiveEventSource | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (source) {
      source.stop();
      source = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          cleanup();
        }
      };

      // Heartbeat every 15s (or configured interval) to keep connection alive
      heartbeat = setInterval(() => {
        send("heartbeat", { timestamp: Date.now() });
      }, heartbeatIntervalMs);

      // Poll the emitter contract and forward normalized events.
      source = eventSourceFactory();
      source.start((event: LiveEvent) => send(event.event, event));

      // Initial connected event
      send("connected", {
        message: "SSE stream connected to emitter contract",
      });

      if (req?.signal) {
        req.signal.addEventListener("abort", cleanup);
      }
    },
    cancel() {
      cleanup();
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
}

export const GET = withMetrics("GET /api/events", async function GET(req?: Request) {
  return createEventsStreamResponse({}, req);
});
