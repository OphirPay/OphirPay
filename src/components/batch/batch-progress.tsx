"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import type { BatchProgressEvent, BatchSseStage } from "@/types/batch";

export interface BatchProgressProps {
  batchId: string;
  initialTotal?: number;
  pollIntervalMs?: number;
  onComplete?: (event: BatchProgressEvent) => void;
}

const STAGE_LABELS: Record<BatchSseStage, string> = {
  queued: "Queued",
  simulating: "Simulating",
  signing: "Awaiting Signature",
  processing: "Processing",
  completed: "Completed",
};

/**
 * Real-time batch progress bar (#1315).
 * Subscribes to `/api/batches/[id]/events` over Server-Sent Events (SSE)
 * and automatically falls back to HTTP polling (`/api/batches/[id]`) if
 * SSE is blocked or drops.
 */
export function BatchProgress({
  batchId,
  initialTotal = 0,
  pollIntervalMs = 3000,
  onComplete,
}: BatchProgressProps) {
  const [state, setState] = useState<BatchProgressEvent>({
    batchId,
    stage: "queued",
    status: "CREATED",
    processedCount: 0,
    totalCount: initialTotal,
    failureCount: 0,
    sentCount: 0,
    pendingCount: initialTotal,
    percentComplete: 0,
    timestamp: new Date().toISOString(),
  });
  const [transport, setTransport] = useState<"sse" | "polling">("sse");

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const handleProgressUpdate = (next: BatchProgressEvent) => {
      if (!active) return;
      setState(next);
      if (next.stage === "completed") {
        onComplete?.(next);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    };

    const startPolling = () => {
      if (!active || pollTimer) return;
      setTransport("polling");

      const pollOnce = async () => {
        if (!active) return;
        try {
          const res = await fetch(`/api/batches/${batchId}`, {
            credentials: "same-origin",
          });
          if (!res.ok) return;
          const body = await res.json();
          const data = body?.data;
          if (!data?.progress) return;
          const totalCount = Number(data.progress.total ?? 0);
          const sentCount = Number(data.progress.sent ?? 0);
          const failureCount = Number(data.progress.failed ?? 0);
          const pendingCount = Number(data.progress.pending ?? 0);
          const processedCount = sentCount + failureCount;
          const percentComplete = Number(data.progress.percentComplete ?? 0);
          const isDone =
            data.status === "COMPLETED" ||
            data.status === "PARTIALLY_COMPLETED" ||
            data.status === "FAILED" ||
            (totalCount > 0 && pendingCount === 0);

          handleProgressUpdate({
            batchId,
            stage: isDone ? "completed" : processedCount > 0 ? "processing" : "queued",
            status: data.status ?? "PROCESSING",
            processedCount,
            totalCount,
            failureCount,
            sentCount,
            pendingCount,
            percentComplete,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Retry on next interval
        }
      };

      void pollOnce();
      pollTimer = setInterval(pollOnce, pollIntervalMs);
    };

    if (typeof EventSource !== "undefined") {
      try {
        const es = new EventSource(`/api/batches/${batchId}/events`);
        eventSource = es;

        const stages: BatchSseStage[] = [
          "queued",
          "simulating",
          "signing",
          "processing",
          "completed",
        ];
        for (const stage of stages) {
          es.addEventListener(stage, (evt: MessageEvent) => {
            try {
              const parsed = JSON.parse(evt.data) as BatchProgressEvent;
              handleProgressUpdate(parsed);
            } catch {
              // Ignore malformed frames
            }
          });
        }

        es.onerror = () => {
          es.close();
          eventSource = null;
          startPolling();
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      active = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, [batchId, pollIntervalMs, onComplete]);

  return (
    <div
      className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-3"
      data-testid="batch-progress"
      data-transport={transport}
    >
      <div className="flex items-center justify-between text-sm">
        <span
          className="font-medium text-gray-900 dark:text-white"
          data-testid="batch-progress-stage"
        >
          {STAGE_LABELS[state.stage]}
        </span>
        <span
          className="font-mono text-xs text-gray-600 dark:text-gray-300"
          data-testid="batch-progress-counts"
        >
          {state.processedCount} / {state.totalCount} processed
          {state.failureCount > 0 ? ` (${state.failureCount} failed)` : ""}
        </span>
      </div>

      <div
        className="w-full h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={state.percentComplete}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-ophir-600 transition-all duration-300"
          style={{ width: `${state.percentComplete}%` }}
          data-testid="batch-progress-bar"
        />
      </div>
    </div>
  );
}
