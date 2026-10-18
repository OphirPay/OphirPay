"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import type { BatchProgress, BatchStatus } from "@/types";
import { isBatchTerminalStatus } from "@/lib/batch-progress";

export interface BatchProgressTrackerProps {
  batchId: string;
  initialProgress: BatchProgress;
  initialStatus: BatchStatus | string;
  onCompleted?: () => void;
  onProgressUpdate?: (progress: BatchProgress, status: string) => void;
}

export function BatchProgressTracker({
  batchId,
  initialProgress,
  initialStatus,
  onCompleted,
  onProgressUpdate,
}: BatchProgressTrackerProps) {
  const [progress, setProgress] = useState<BatchProgress>(initialProgress);
  const [status, setStatus] = useState<string>(initialStatus);
  const [connectionMode, setConnectionMode] = useState<"sse" | "polling">("sse");
  const onCompletedRef = useRef(onCompleted);
  const onProgressUpdateRef = useRef(onProgressUpdate);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onProgressUpdateRef.current = onProgressUpdate;
  });

  useEffect(() => {
    // If the batch is already finished, nothing to subscribe to
    if (isBatchTerminalStatus(status)) {
      return;
    }

    let es: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let aborted = false;

    const startPollingFallback = () => {
      if (pollInterval || aborted) return;
      setConnectionMode("polling");

      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/batches/${batchId}`);
          if (!res.ok) return;
          const json = await res.json();
          const data = json.data || json;
          if (data?.progress) {
            setProgress(data.progress);
            if (data.status) setStatus(data.status);
            onProgressUpdateRef.current?.(data.progress, data.status);

            if (isBatchTerminalStatus(data.status)) {
              if (pollInterval) clearInterval(pollInterval);
              onCompletedRef.current?.();
            }
          }
        } catch {
          // Silently retry on next poll cycle
        }
      }, 3_000);
    };

    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        es = new EventSource(`/api/batches/${batchId}/events`);
        setConnectionMode("sse");

        es.addEventListener("progress", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.progress) {
              setProgress(data.progress);
              if (data.status) setStatus(data.status);
              onProgressUpdateRef.current?.(data.progress, data.status);
            }
          } catch {
            // ignore malformed frame
          }
        });

        es.addEventListener("completed", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.status) setStatus(data.status);
          } catch {
            setStatus("COMPLETED");
          }
          if (es) {
            es.close();
            es = null;
          }
          onCompletedRef.current?.();
        });

        es.onerror = () => {
          // Fall back gracefully to polling on error or proxy disconnect
          if (es) {
            es.close();
            es = null;
          }
          startPollingFallback();
        };
      } catch {
        startPollingFallback();
      }
    } else {
      startPollingFallback();
    }

    return () => {
      aborted = true;
      if (es) es.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [batchId, status]);

  const isTerminal = isBatchTerminalStatus(status);

  return (
    <div
      data-testid="batch-progress-tracker"
      data-connection-mode={connectionMode}
      data-status={status}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Progress
          </h2>
          <span
            data-testid="connection-mode-badge"
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
              connectionMode === "sse"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
            }`}
          >
            {connectionMode === "sse" ? "⚡ Live Stream" : "🔄 Auto-poll"}
          </span>
        </div>
        <span
          data-testid="percent-complete"
          className="text-sm font-mono font-semibold text-gray-900 dark:text-white"
        >
          {progress.percentComplete}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          data-testid="progress-bar-fill"
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progress.percentComplete}%`,
            backgroundColor:
              progress.failed > 0
                ? progress.percentComplete === 100
                  ? "#ef4444"
                  : "#f59e0b"
                : "#10b981",
          }}
        />
      </div>

      {/* Counts */}
      <div className="flex items-center gap-6 mt-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {progress.pending} pending
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {progress.sent} sent
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {progress.failed} failed
          </span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {progress.total} total {isTerminal ? "• Completed" : ""}
        </span>
      </div>
    </div>
  );
}

export default BatchProgressTracker;
