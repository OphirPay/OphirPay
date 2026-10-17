// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import {
  unauthorizedError,
  notFoundError,
  handleApiError,
} from "@/lib/api-response";
import {
  buildBatchProgressEvent,
  subscribeBatchProgress,
} from "@/lib/batch-progress";
import { createBoundedSseBuffer } from "@/lib/events/sse-buffer";
import { incMetric } from "@/lib/metrics-counters";

export const dynamic = "force-dynamic";

export const BATCH_SSE_MAX_BUFFERED_EVENTS = 100;
export const BATCH_SSE_MAX_BUFFERED_BYTES = 256 * 1024;
export const BATCH_SSE_IDLE_TIMEOUT_MS = 60_000;

/**
 * GET /api/batches/[id]/events
 *
 * Server-Sent Events (SSE) stream for real-time batch progress (#1315).
 * Emits `queued`, `simulating`, `signing`, `processing`, and `completed`
 * frames with incremental counters (`processedCount`, `totalCount`, `failureCount`).
 * Automatically closes the stream when the batch reaches `completed` or the
 * client disconnects.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;

    const batch = await prisma.batch.findFirst({
      where: { id, userId: auth.userId },
      include: { payments: true },
    });

    if (!batch) {
      return notFoundError(`Batch ${id}`);
    }

    let closed = false;
    let completedReached = false;
    let unsubscribe: (() => void) | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    const buffer = createBoundedSseBuffer({
      policy: "drop-oldest",
      maxEvents: BATCH_SSE_MAX_BUFFERED_EVENTS,
      maxBytes: BATCH_SSE_MAX_BUFFERED_BYTES,
      idleTimeoutMs: BATCH_SSE_IDLE_TIMEOUT_MS,
      onDisconnect: () => teardown(),
    });

    const teardown = () => {
      if (closed) return;
      closed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      buffer.close();
      if (streamController) {
        try {
          streamController.close();
        } catch {
          // Ignore if already closed
        }
        streamController = null;
      }
      incMetric("sse_open_connections", -1);
    };

    const maybeFinishIfDrained = () => {
      if (completedReached && buffer.queuedEvents === 0) {
        teardown();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        buffer.attach(controller);
        incMetric("sse_open_connections");

        const initialEvent = buildBatchProgressEvent(
          batch.id,
          batch.status,
          batch.payments
        );
        buffer.push(initialEvent.stage, initialEvent);

        if (initialEvent.stage === "completed") {
          completedReached = true;
          maybeFinishIfDrained();
          return;
        }

        unsubscribe = subscribeBatchProgress(batch.id, (event) => {
          if (closed) return;
          buffer.push(event.stage, event);
          if (event.stage === "completed") {
            completedReached = true;
            maybeFinishIfDrained();
          }
        });

        request.signal?.addEventListener("abort", teardown, { once: true });
      },
      pull(controller) {
        buffer.pull(controller);
        maybeFinishIfDrained();
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
  } catch (err) {
    return handleApiError(err, "GET /api/batches/[id]/events");
  }
}
