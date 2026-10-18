// SPDX-License-Identifier: MIT

import { getAuthContext } from "@/lib/auth-session";
import { notFoundError, unauthorizedError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import {
  computeBatchProgress,
  formatBatchSseEvent,
  isBatchTerminalStatus,
  mapBatchStatusToStreamState,
} from "@/lib/batch-progress";
import { incMetric } from "@/lib/metrics-counters";
import type { BatchProgressEventPayload } from "@/types/batch";

export const dynamic = "force-dynamic";

/** Cadence for querying batch state updates while in-flight. */
const POLL_INTERVAL_MS = 1_500;
/** Keep-alive ping interval to prevent reverse proxy timeouts. */
const PING_INTERVAL_MS = 15_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const encoder = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  incMetric("sse_open_connections", 1);

  const stream = new ReadableStream({
    start(controller) {
      const teardown = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        incMetric("sse_open_connections", -1);
        try {
          controller.close();
        } catch {
          // Stream might already be closed or controller finished
        }
      };

      request.signal.addEventListener("abort", teardown);

      // 1. Initial connection acknowledgement
      controller.enqueue(
        encoder.encode(
          formatBatchSseEvent("connected", {
            batchId: id,
            connectedAt: new Date().toISOString(),
          })
        )
      );

      // 2. Initial snapshot
      const currentProgress = computeBatchProgress(batch.payments);
      const streamState = mapBatchStatusToStreamState(batch.status);
      const snapshot: BatchProgressEventPayload = {
        batchId: id,
        status: streamState,
        progress: currentProgress,
        timestamp: new Date().toISOString(),
      };

      controller.enqueue(
        encoder.encode(formatBatchSseEvent("progress", snapshot))
      );

      // If already terminal, emit completed and close stream immediately
      if (isBatchTerminalStatus(batch.status)) {
        controller.enqueue(
          encoder.encode(
            formatBatchSseEvent("completed", {
              batchId: id,
              status: streamState,
              completedAt: new Date().toISOString(),
            })
          )
        );
        teardown();
        return;
      }

      // 3. Keep-alive comment pings
      pingTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          teardown();
        }
      }, PING_INTERVAL_MS);

      // 4. In-flight update poller
      let lastPercent = currentProgress.percentComplete;
      let lastStatus = batch.status;

      pollTimer = setInterval(async () => {
        if (closed) return;
        try {
          const freshBatch = await prisma.batch.findFirst({
            where: { id, userId: auth.userId },
            include: { payments: true },
          });

          if (!freshBatch) {
            teardown();
            return;
          }

          const freshProgress = computeBatchProgress(freshBatch.payments);
          const freshStreamState = mapBatchStatusToStreamState(freshBatch.status);

          // Emit if progress or status changed
          if (
            freshProgress.percentComplete !== lastPercent ||
            freshBatch.status !== lastStatus
          ) {
            lastPercent = freshProgress.percentComplete;
            lastStatus = freshBatch.status;

            const payload: BatchProgressEventPayload = {
              batchId: id,
              status: freshStreamState,
              progress: freshProgress,
              timestamp: new Date().toISOString(),
            };

            controller.enqueue(
              encoder.encode(formatBatchSseEvent("progress", payload))
            );
          }

          if (isBatchTerminalStatus(freshBatch.status)) {
            controller.enqueue(
              encoder.encode(
                formatBatchSseEvent("completed", {
                  batchId: id,
                  status: freshStreamState,
                  completedAt: new Date().toISOString(),
                })
              )
            );
            teardown();
          }
        } catch {
          teardown();
        }
      }, POLL_INTERVAL_MS);
    },
    cancel() {
      if (!closed) {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        incMetric("sse_open_connections", -1);
      }
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
