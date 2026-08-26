"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";
import type { TimelineStep, TimelineStepState } from "@/lib/payment-timeline";

/**
 * Each state gets a distinct marker and label treatment. `skipped` in
 * particular must not look like `upcoming` — a cancelled payment is not still
 * on its way.
 */
const MARKER: Record<TimelineStepState, string> = {
  done: "bg-green-500 border-green-500",
  current: "bg-blue-500 border-blue-500 animate-pulse",
  upcoming: "bg-transparent border-gray-300 dark:border-gray-600",
  failed: "bg-red-500 border-red-500",
  skipped: "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600",
};

const LABEL: Record<TimelineStepState, string> = {
  done: "text-gray-900 dark:text-white",
  current: "text-blue-700 dark:text-blue-400 font-medium",
  upcoming: "text-gray-400 dark:text-gray-500",
  failed: "text-red-700 dark:text-red-400 font-medium",
  skipped: "text-gray-400 dark:text-gray-500 line-through",
};

const STATE_TEXT: Record<TimelineStepState, string> = {
  done: "completed",
  current: "in progress",
  upcoming: "not started",
  failed: "failed",
  skipped: "skipped",
};

interface PaymentTimelineProps {
  steps: TimelineStep[];
  className?: string;
}

/** Vertical lifecycle timeline for a single payment. */
export function PaymentTimeline({ steps, className }: PaymentTimelineProps) {
  return (
    <ol className={cn("relative space-y-0", className)} aria-label="Payment lifecycle">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[7px] top-4 h-full w-px",
                  step.state === "done"
                    ? "bg-green-500/40"
                    : "bg-gray-200 dark:bg-gray-700"
                )}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-1 h-4 w-4 shrink-0 rounded-full border-2",
                MARKER[step.state]
              )}
            />

            <div className="min-w-0">
              <p className={cn("text-sm", LABEL[step.state])}>{step.label}</p>
              {/* Conveys state to assistive tech and to anyone who cannot
                  distinguish the marker colours. */}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <span className="sr-only">{step.label}: </span>
                {STATE_TEXT[step.state]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
