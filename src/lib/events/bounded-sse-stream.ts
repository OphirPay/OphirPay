// SPDX-License-Identifier: MIT

/**
 * Bounded outbound SSE (Server-Sent Events) stream with backpressure,
 * drop-oldest overflow policy, keep-alive heartbeat, and idle timeout.
 *
 * Implements Issue #744:
 * - Bounds outbound memory per connection to prevent slow/stalled consumers
 *   from growing server memory without bound.
 * - Applies drop-oldest policy with a `drop` marker when the buffer ceiling is reached.
 * - Auto-disconnects persistently stalled consumers after an idle timeout.
 * - Correctly manages the `sse_open_connections` Prometheus gauge.
 */

import { incMetric } from "@/lib/metrics-counters";

export interface BoundedSseOptions {
  /** Maximum number of unconsumed events queued in memory per connection. Default: 50 */
  maxBufferSize?: number;
  /** Keep-alive heartbeat interval in milliseconds. Default: 15,000 ms (15s) */
  heartbeatIntervalMs?: number;
  /** Idle timeout in milliseconds without consumer drain or activity before auto-disconnect. Default: 45,000 ms (45s) */
  idleTimeoutMs?: number;
  /** Watchdog check interval in milliseconds. Default: 5,000 ms (5s) */
  watchdogIntervalMs?: number;
  /** Custom cleanup hook called upon disconnect / teardown */
  onTeardown?: () => void;
  /** Request signal for client-side abort detection */
  requestSignal?: AbortSignal;
}

export interface BoundedSseStreamHandle {
  stream: ReadableStream<Uint8Array>;
  send: (eventName: string, data: unknown) => boolean;
  close: (reason?: string) => void;
  isClosed: () => boolean;
  getBufferedCount: () => number;
  getDroppedCount: () => number;
}

export function createBoundedSseStream(options: BoundedSseOptions = {}): BoundedSseStreamHandle {
  const maxBufferSize = options.maxBufferSize ?? 50;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  const watchdogIntervalMs = options.watchdogIntervalMs ?? 5_000;

  const encoder = new TextEncoder();

  let closed = false;
  let rawController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const buffer: Uint8Array[] = [];
  let droppedCount = 0;
  let lastReadTime = Date.now();

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;

  const teardown = () => {
    if (closed) return;
    closed = true;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }

    buffer.length = 0;

    // Decrement the SSE open connections gauge
    incMetric("sse_open_connections", -1);

    if (options.onTeardown) {
      try {
        options.onTeardown();
      } catch {
        // Ignore teardown errors
      }
    }

    if (rawController) {
      try {
        rawController.close();
      } catch {
        // Stream may already be closed/errored
      }
    }
  };

  // Format an SSE message frame
  const encodeFrame = (eventName: string, data: unknown): Uint8Array => {
    return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const drainNext = () => {
    if (closed || !rawController) return;

    while (
      !closed &&
      rawController &&
      (rawController.desiredSize ?? 0) > 0 &&
      (droppedCount > 0 || buffer.length > 0)
    ) {
      // If there are accumulated drops, emit a drop marker event first
      if (droppedCount > 0) {
        const dropMarker = encodeFrame("drop", {
          dropped: droppedCount,
          reason: "slow_consumer_buffer_overflow",
        });
        droppedCount = 0;
        try {
          rawController.enqueue(dropMarker);
        } catch {
          teardown();
          return;
        }
      } else if (buffer.length > 0) {
        const chunk = buffer.shift();
        if (chunk) {
          try {
            rawController.enqueue(chunk);
          } catch {
            teardown();
            return;
          }
        }
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      rawController = controller;

      // Track open connection on gauge
      incMetric("sse_open_connections", 1);

      // Check pre-aborted signals
      if (options.requestSignal?.aborted) {
        teardown();
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctrlSignal = (controller as any).signal;
      if (ctrlSignal?.aborted) {
        teardown();
        return;
      }

      // Register abort listeners
      ctrlSignal?.addEventListener("abort", teardown, { once: true });
      if (options.requestSignal) {
        options.requestSignal.addEventListener("abort", teardown, { once: true });
      }

      // Heartbeat keep-alive
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        handle.send("heartbeat", { timestamp: Date.now() });
      }, heartbeatIntervalMs);

      // Stalled consumer watchdog
      idleTimer = setInterval(() => {
        if (closed) return;
        const now = Date.now();
        const hasUndrainedData = buffer.length > 0 || (rawController?.desiredSize ?? 1) <= 0;
        // If there is undrained data and consumer hasn't drained in idleTimeoutMs, disconnect
        if (hasUndrainedData && now - lastReadTime > idleTimeoutMs) {
          try {
            rawController?.enqueue(
              encodeFrame("close", {
                reason: "stalled_consumer_timeout",
                message: "Connection closed due to slow consumer timeout",
              })
            );
          } catch {
            // Ignore
          }
          teardown();
        }
      }, watchdogIntervalMs);
    },

    pull() {
      // pull() is called by the Streams runtime when the consumer reads chunks
      lastReadTime = Date.now();
      drainNext();
    },

    cancel() {
      teardown();
    },
  });

  const handle: BoundedSseStreamHandle = {
    stream,

    send(eventName: string, data: unknown): boolean {
      if (closed || !rawController) return false;

      const frame = encodeFrame(eventName, data);

      // If buffer is empty, no pending drops, and controller has desired capacity, enqueue directly
      if (buffer.length === 0 && droppedCount === 0 && (rawController.desiredSize ?? 0) > 0) {
        try {
          rawController.enqueue(frame);
          return true;
        } catch {
          teardown();
          return false;
        }
      }

      // Outbound queue is buffered — apply drop-oldest policy if capacity reached
      if (buffer.length >= maxBufferSize) {
        buffer.shift(); // Drop oldest event
        droppedCount += 1;
      }

      buffer.push(frame);
      return true;
    },

    close(reason?: string) {
      if (closed) return;
      if (reason && rawController) {
        try {
          rawController.enqueue(encodeFrame("close", { reason }));
        } catch {
          // Ignore
        }
      }
      teardown();
    },

    isClosed() {
      return closed;
    },

    getBufferedCount() {
      return buffer.length;
    },

    getDroppedCount() {
      return droppedCount;
    },
  };

  return handle;
}
