// SPDX-License-Identifier: MIT

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

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

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
      const heartbeat = setInterval(() => {
        send("heartbeat", { timestamp: Date.now() });
      }, 15000);

      // Poll the emitter contract and forward normalized events.
      const source = createLiveEventSource();
      source.start((event) => send(event.event, event));

      // Initial connected event
      send("connected", {
        message: "SSE stream connected to emitter contract",
      });

      // Cleanup on client disconnect
      return () => {
        closed = true;
        clearInterval(heartbeat);
        source.stop();
      };
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
