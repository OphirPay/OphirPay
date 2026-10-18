// SPDX-License-Identifier: MIT

import type { Batch, BatchProgress, BatchItem, BatchItemStatus, BatchStatus } from "@/types";

export type { Batch, BatchProgress, BatchItem, BatchItemStatus, BatchStatus };

/**
 * Real-time event types streamed over SSE for batch processing.
 */
export type BatchEventType =
  | "connected"
  | "status"
  | "progress"
  | "item_update"
  | "completed"
  | "failed"
  | "cancelled"
  | "heartbeat";

/**
 * Granular stream status states representing the payment batch lifecycle.
 */
export type BatchStreamStatus =
  | "queued"
  | "simulating"
  | "signing"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * SSE progress event payload delivered to listening dashboard clients.
 */
export interface BatchProgressEventPayload {
  batchId: string;
  status: BatchStatus | BatchStreamStatus;
  progress: BatchProgress;
  itemUpdate?: {
    id: string;
    status: BatchItemStatus;
  };
  timestamp: string;
}
