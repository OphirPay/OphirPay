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
 * - drop — slow consumer buffer overflow notification (oldest events dropped)
 * - close — slow consumer auto-disconnect notification on idle timeout
 *
 * The stream comes from the shared `createLiveEventSource` (also used by the
 * WebSocket channel), so both transports deliver the same events.
 */

import { createLiveEventSource } from "@/lib/events/event-source";
import { createBoundedSseStream } from "@/lib/events/bounded-sse-stream";

export const dynamic = "force-dynamic";

export const GET = withMetrics("GET /api/events", async function GET(request: Request) {
  let source: ReturnType<typeof createLiveEventSource> | null = null;

  const boundedStream = createBoundedSseStream({
    maxBufferSize: 50,
    heartbeatIntervalMs: 15_000,
    idleTimeoutMs: 45_000,
    requestSignal: request.signal,
    onTeardown: () => {
      if (source) {
        source.stop();
        source = null;
      }
    },
  });

  // Poll the emitter contract and forward normalized events.
  source = createLiveEventSource();
  source.start((event) => {
    boundedStream.send(event.event, event);
  });

  // Initial connected event
  boundedStream.send("connected", {
    message: "SSE stream connected to emitter contract",
  });

  return new Response(boundedStream.stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});