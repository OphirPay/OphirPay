// SPDX-License-Identifier: MIT

/**
 * Per-item status within a batch payment.
 * Maps directly to Payment.status values but scoped to batch context.
 */
export type BatchItemStatus = "pending" | "sent" | "failed";

/**
 * Progress counts for a batch.
 */
export interface BatchProgress {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  percentComplete: number;
}

/**
 * Map a payment's status to its batch item status.
 *
 * - CREATED / PENDING → pending (not yet sent)
 * - PROCESSING / SIGNED / SUBMITTED → sent (in flight, awaiting confirmation)
 * - COMPLETED / CONFIRMED → sent (done)
 * - FAILED / CANCELLED → failed
 */
export function toBatchItemStatus(
  paymentStatus: string | undefined
): BatchItemStatus {
  switch (paymentStatus) {
    case "CREATED":
    case "PENDING":
      return "pending";
    case "PROCESSING":
    case "SIGNED":
    case "SUBMITTED":
    case "COMPLETED":
    case "CONFIRMED":
      return "sent";
    case "FAILED":
    case "CANCELLED":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Compute batch-level progress from its payments array.
 */
export function computeBatchProgress(
  payments: { status?: string }[]
): BatchProgress {
  const total = payments.length;
  if (total === 0) {
    return { total: 0, pending: 0, sent: 0, failed: 0, percentComplete: 0 };
  }

  let pending = 0;
  let sent = 0;
  let failed = 0;

  for (const payment of payments) {
    const itemStatus = toBatchItemStatus(payment.status);
    if (itemStatus === "failed") failed++;
    else if (itemStatus === "sent") sent++;
    else pending++;
  }

  const resolved = sent + failed;
  const percentComplete = Math.round((resolved / total) * 100);

  return { total, pending, sent, failed, percentComplete };
}

import type { BatchProgressEvent, BatchSseStage } from "@/types/batch";
export type { BatchProgressEvent, BatchSseStage };

/**
 * Map a batch status and payment statuses to the SSE lifecycle stage (#1315).
 */
export function resolveBatchSseStage(
  batchStatus: string | undefined,
  payments: { status?: string }[],
  explicitStage?: BatchSseStage
): BatchSseStage {
  if (explicitStage) return explicitStage;

  const isTerminalPayment = (s: string | undefined) =>
    s === "COMPLETED" || s === "CONFIRMED" || s === "FAILED" || s === "CANCELLED";

  if (
    batchStatus === "COMPLETED" ||
    batchStatus === "PARTIALLY_COMPLETED" ||
    batchStatus === "FAILED" ||
    (payments.length > 0 && payments.every((p) => isTerminalPayment(p.status)))
  ) {
    return "completed";
  }

  if (payments.some((p) => p.status === "SIGNED")) {
    return "signing";
  }
  if (payments.some((p) => p.status === "SIMULATING")) {
    return "simulating";
  }
  const progress = computeBatchProgress(payments);
  if (
    batchStatus === "PROCESSING" ||
    progress.sent > 0 ||
    progress.failed > 0 ||
    payments.some((p) => p.status === "PROCESSING" || p.status === "SUBMITTED")
  ) {
    return "processing";
  }

  return "queued";
}

/**
 * Construct a real-time SSE batch progress payload (#1315).
 */
export function buildBatchProgressEvent(
  batchId: string,
  batchStatus: string,
  payments: { status?: string }[],
  explicitStage?: BatchSseStage
): BatchProgressEvent {
  const progress = computeBatchProgress(payments);
  const stage = resolveBatchSseStage(batchStatus, payments, explicitStage);
  const processedCount = progress.sent + progress.failed;

  return {
    batchId,
    stage,
    status: batchStatus,
    processedCount,
    totalCount: progress.total,
    failureCount: progress.failed,
    sentCount: progress.sent,
    pendingCount: progress.pending,
    percentComplete: progress.percentComplete,
    timestamp: new Date().toISOString(),
  };
}

type BatchProgressListener = (event: BatchProgressEvent) => void;

const batchListeners = new Map<string, Set<BatchProgressListener>>();

/**
 * Subscribe to real-time progress events for a specific batch ID.
 * Returns an unsubscribe callback.
 */
export function subscribeBatchProgress(
  batchId: string,
  listener: BatchProgressListener
): () => void {
  let set = batchListeners.get(batchId);
  if (!set) {
    set = new Set();
    batchListeners.set(batchId, set);
  }
  set.add(listener);

  return () => {
    const current = batchListeners.get(batchId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      batchListeners.delete(batchId);
    }
  };
}

/**
 * Emit a batch progress update to in-memory SSE subscribers and optional Redis pub/sub (#1315).
 */
export async function emitBatchProgressEvent(
  event: BatchProgressEvent,
  redisPublisher?: { publish: (channel: string, message: string) => Promise<unknown> }
): Promise<void> {
  const listeners = batchListeners.get(event.batchId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must never break the emitter
      }
    }
  }

  if (redisPublisher) {
    try {
      await redisPublisher.publish(
        `ophirpay:batch-progress:${event.batchId}`,
        JSON.stringify(event)
      );
    } catch {
      // Non-fatal if Redis pub/sub is unreachable
    }
  }
}
