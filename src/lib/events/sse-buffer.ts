// SPDX-License-Identifier: MIT

/**
 * Bounded SSE outbound buffer (issue #744).
 *
 * A `ReadableStream` controller queues whatever you `enqueue()` regardless of
 * whether the client is reading, so a stalled SSE consumer can grow server
 * memory without bound and hold a connection open indefinitely. This module
 * puts a hard ceiling on that queue and picks a policy for slow consumers.
 *
 * ## How it works
 *
 * Frames are held in an in-process queue with **event-count** and **byte**
 * ceilings. `drain()` moves queued frames into the `ReadableStream` only while
 * the stream still has demand (`desiredSize > 0`), so the stream's own queue
 * never holds more than a frame or two. When a new frame would exceed a
 * ceiling, the configured policy applies:
 *
 * - `"drop-oldest"` (default) — evict the oldest queued frames to make room.
 *   A `: dropped N slow-consumer event(s)` SSE **comment** marker is emitted
 *   ahead of the next data frame so an operator tailing the raw stream can see
 *   that data was shed. Comments are ignored by `EventSource`.
 * - `"disconnect"` — stop buffering and close the stream with an `error`
 *   frame carrying `code: "SLOW_CONSUMER"`.
 *
 * Independently, if a connection has backlog that has not drained within
 * `idleTimeoutMs`, it is treated as stalled and disconnected with reason
 * `"idle-timeout"`.
 *
 * Either way, memory is bounded by the configured ceilings.
 */

export type SseBufferPolicy = "drop-oldest" | "disconnect";

/** Machine code emitted in the `error` frame / marketing copy. */
export const SSE_SLOW_CONSUMER_CODE = "SLOW_CONSUMER";

export interface SseBufferOverflowInfo {
  /** Total frames dropped since the connection opened. */
  droppedEvents: number;
  /** Frames still queued. */
  queuedEvents: number;
  /** Bytes still queued. */
  queuedBytes: number;
}

export interface SseBufferOptions {
  /** Maximum frames held before the policy applies. Default 100. */
  maxEvents?: number;
  /** Maximum buffered bytes held before the policy applies. Default 256 KiB. */
  maxBytes?: number;
  /** Slow-consumer policy. Default `"drop-oldest"`. */
  policy?: SseBufferPolicy;
  /** Close the connection after this long without a drain. Default 60 s. */
  idleTimeoutMs?: number;
  /** Called whenever frames are shed (drop-oldest) or a disconnect is decided. */
  onOverflow?: (info: SseBufferOverflowInfo) => void;
  /** Called exactly once when the buffer disconnects a slow consumer. */
  onDisconnect?: (reason: string) => void;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface BoundedSseBuffer {
  /** Bind the ReadableStream controller so pushes can drain immediately. */
  attach(controller: ReadableStreamDefaultController<Uint8Array>): void;
  /** Enqueue an SSE event (or buffer it, subject to the policy). */
  push(event: string, data: unknown): void;
  /** Enqueue a raw SSE comment line (e.g. `: ping\n\n`), bypasses EventSource parsing. */
  pushComment(comment: string): void;
  /** Enqueue a periodic keep-alive ping comment (`: ping\n\n`) (#1289). */
  ping(): void;
  /** ReadableStream `pull` hook — drains on consumer demand. */
  pull(controller: ReadableStreamDefaultController<Uint8Array>): void;
  /** Stop buffering and close the stream (client already gone). */
  close(): void;
  readonly queuedEvents: number;
  readonly queuedBytes: number;
  readonly droppedEvents: number;
  readonly disconnected: boolean;
}

export const SSE_DEFAULT_MAX_EVENTS = 100;
export const SSE_DEFAULT_MAX_BYTES = 256 * 1024;
export const SSE_DEFAULT_IDLE_TIMEOUT_MS = 60_000;

const encoder = new TextEncoder();

/** Encode a standard SSE frame (`event:` + `data:` + blank line). */
export function encodeSseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

/** Encode an SSE comment line (ignored by clients, visible in a raw tail). */
export function encodeSseComment(text: string): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}

export function createBoundedSseBuffer(
  options: SseBufferOptions = {}
): BoundedSseBuffer {
  const maxEvents = Math.max(1, options.maxEvents ?? SSE_DEFAULT_MAX_EVENTS);
  const maxBytes = Math.max(1, options.maxBytes ?? SSE_DEFAULT_MAX_BYTES);
  const policy = options.policy ?? "drop-oldest";
  const idleTimeoutMs = Math.max(
    1,
    options.idleTimeoutMs ?? SSE_DEFAULT_IDLE_TIMEOUT_MS
  );
  const now = options.now ?? Date.now;

  const queue: Uint8Array[] = [];
  let queuedBytes = 0;
  let droppedEvents = 0;
  let pendingMarker = 0;
  let disconnected = false;
  let disconnectReason: string | null = null;
  let onDisconnectFired = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let lastDrainAt = now();

  const overflowInfo = (): SseBufferOverflowInfo => ({
    droppedEvents,
    queuedEvents: queue.length,
    queuedBytes,
  });

  const requestDisconnect = (reason: string) => {
    if (disconnected) return;
    disconnected = true;
    disconnectReason = reason;
    options.onOverflow?.(overflowInfo());
  };

  const fireDisconnect = () => {
    if (onDisconnectFired) return;
    onDisconnectFired = true;
    options.onDisconnect?.(disconnectReason ?? "slow-consumer");
  };

  const closeWithReason = (
    controller: ReadableStreamDefaultController<Uint8Array>
  ) => {
    try {
      controller.enqueue(
        encodeSseFrame("error", {
          code: SSE_SLOW_CONSUMER_CODE,
          reason: disconnectReason ?? "slow-consumer",
          message:
            "The event stream was closed because this client could not keep up with the event rate.",
        })
      );
    } catch {
      /* controller already closed */
    }
    try {
      controller.close();
    } catch {
      /* already closed */
    }
    fireDisconnect();
  };

  const drain = () => {
    const controller = controllerRef;
    if (!controller) return;

    if (disconnected) {
      closeWithReason(controller);
      return;
    }

    // Emit the slow-consumer marker ahead of the next data frame.
    if (pendingMarker > 0) {
      const droppedMarker = pendingMarker;
      pendingMarker = 0;
      try {
        controller.enqueue(
          encodeSseComment(`dropped ${droppedMarker} slow-consumer event(s)`)
        );
      } catch {
        return;
      }
    }

    while (queue.length > 0) {
      const desired = controller.desiredSize;
      if (desired !== null && desired <= 0) break;
      const chunk = queue.shift() as Uint8Array;
      queuedBytes -= chunk.length;
      lastDrainAt = now();
      try {
        controller.enqueue(chunk);
      } catch {
        return;
      }
    }
  };

  const push = (event: string, data: unknown): void => {
    if (disconnected) return;

    // Idle timeout: backlog that hasn't drained within the budget means the
    // consumer is stalled, not merely bursty.
    if (queue.length > 0 && now() - lastDrainAt > idleTimeoutMs) {
      requestDisconnect("idle-timeout");
      drain();
      return;
    }

    const bytes = encodeSseFrame(event, data);

    if (policy === "disconnect") {
      if (queue.length + 1 > maxEvents || queuedBytes + bytes.length > maxBytes) {
        requestDisconnect("buffer-overflow");
        drain();
        return;
      }
    } else {
      // drop-oldest: evict until the new frame fits.
      while (
        queue.length > 0 &&
        (queue.length + 1 > maxEvents || queuedBytes + bytes.length > maxBytes)
      ) {
        const dropped = queue.shift() as Uint8Array;
        queuedBytes -= dropped.length;
        droppedEvents += 1;
        pendingMarker += 1;
      }
      // A single frame larger than the entire budget is dropped outright.
      if (
        queue.length + 1 > maxEvents ||
        queuedBytes + bytes.length > maxBytes
      ) {
        droppedEvents += 1;
        pendingMarker += 1;
        options.onOverflow?.(overflowInfo());
        drain();
        return;
      }
    }

    queue.push(bytes);
    queuedBytes += bytes.length;
    if (droppedEvents > 0) options.onOverflow?.(overflowInfo());
    drain();
  };

  const pushComment = (comment: string): void => {
    if (disconnected) return;
    const bytes = encodeSseComment(comment);
    const controller = controllerRef;
    if (
      controller &&
      queue.length === 0 &&
      (controller.desiredSize === null || controller.desiredSize > 0)
    ) {
      try {
        controller.enqueue(bytes);
        lastDrainAt = now();
        return;
      } catch {
        /* fall back to queueing */
      }
    }
    queue.push(bytes);
    queuedBytes += bytes.length;
    drain();
  };

  const ping = (): void => {
    pushComment("ping");
  };

  return {
    attach(controller) {
      controllerRef = controller;
    },
    push,
    pushComment,
    ping,
    pull(controller) {
      controllerRef = controller;
      lastDrainAt = now();
      drain();
    },
    close() {
      controllerRef = null;
      disconnected = true;
      fireDisconnect();
    },
    get queuedEvents() {
      return queue.length;
    },
    get queuedBytes() {
      return queuedBytes;
    },
    get droppedEvents() {
      return droppedEvents;
    },
    get disconnected() {
      return disconnected;
    },
  };
}
