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

import type { BatchEventType, BatchStreamStatus } from "@/types/batch";

/**
 * Maps high-level database batch status to granular SSE stream lifecycle state.
 */
export function mapBatchStatusToStreamState(status: string): BatchStreamStatus {
  switch (status.toUpperCase()) {
    case "CREATED":
    case "PENDING":
      return "queued";
    case "SIMULATING":
      return "simulating";
    case "SIGNING":
      return "signing";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
    case "CONFIRMED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "FAILED":
    default:
      return "failed";
  }
}

/**
 * Formats a message into a standard Server-Sent Event text payload.
 */
export function formatBatchSseEvent(event: BatchEventType, data: unknown): string {
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${serialized}\n\n`;
}

/**
 * Determines whether a batch has reached an immutable terminal state.
 */
export function isBatchTerminalStatus(status: string): boolean {
  const upper = status.toUpperCase();
  return (
    upper === "COMPLETED" ||
    upper === "CONFIRMED" ||
    upper === "FAILED" ||
    upper === "CANCELLED"
  );
}

