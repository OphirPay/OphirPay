// SPDX-License-Identifier: MIT

import type { BatchStatus } from "@/types";

export type BatchItemStatus = "pending" | "sent" | "failed";

export interface BatchProgress {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  percentComplete: number;
}

export type BatchSseStage =
  | "queued"
  | "simulating"
  | "signing"
  | "processing"
  | "completed";

export interface BatchProgressEvent {
  batchId: string;
  stage: BatchSseStage;
  status: BatchStatus | string;
  processedCount: number;
  totalCount: number;
  failureCount: number;
  sentCount: number;
  pendingCount: number;
  percentComplete: number;
  timestamp: string;
}
