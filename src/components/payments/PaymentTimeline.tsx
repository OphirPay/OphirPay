"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";
import type { PaymentLifecycleStep } from "@/lib/payment-lifecycle";

interface PaymentTimelineProps {
  steps: PaymentLifecycleStep[];
  /** Optional explorer URL — linked from the terminal step when reached. */
  explorerUrl?: string;
}

function formatTimestamp(timestamp?: number): string | null {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Visual payment lifecycle timeline.
 *
 * Renders the fixed pipeline (created → signed → submitted → confirmed /
 * failed) with explicit completed, current, and pending states, plus an
 * optional explorer link on the terminal step.
 */
export function PaymentTimeline({ steps, explorerUrl }: PaymentTimelineProps) {
  return (
    <ol className="relative" aria-label="Payment lifecycle">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const failed = step.state === "FAILED";

        return (
          <li key={`${step.state}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Rail */}
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[13px] top-7 bottom-0 w-px",
                  step.reached
                    ? "bg-green-400 dark:bg-green-600"
                    : "bg-gray-200 dark:bg-gray-700"
                )}
              />
            )}

            {/* Icon */}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                failed
                  ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-500"
                  : step.reached
                    ? "border-green-500 bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400"
                    : step.current
                      ? "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/40 text-ophir-600 dark:text-ophir-400"
                      : "border-gray-300 dark:border-gray-600 text-gray-300 dark:text-gray-500"
              )}
              aria-hidden
            >
              {failed ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : step.reached ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : step.current ? (
                <span className="h-2 w-2 rounded-full bg-ophir-500 animate-pulse" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-current" />
              )}
            </span>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={cn(
                    "text-sm font-medium",
                    failed
                      ? "text-red-700 dark:text-red-400"
                      : step.reached
                        ? "text-gray-900 dark:text-white"
                        : step.current
                          ? "text-ophir-700 dark:text-ophir-300"
                          : "text-gray-400 dark:text-gray-500"
                  )}
                >
                  {step.label}
                  {step.current && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-ophir-50 dark:bg-ophir-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ophir-600 dark:text-ophir-400">
                      Current
                    </span>
                  )}
                </p>
                {step.timestamp && (
                  <time
                    className="text-xs text-gray-400 dark:text-gray-500"
                    dateTime={new Date(step.timestamp * 1000).toISOString()}
                  >
                    {formatTimestamp(step.timestamp)}
                  </time>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {step.description}
              </p>
              {isLast && step.reached && explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  View on explorer
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3 w-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
