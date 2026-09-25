"use client";
// SPDX-License-Identifier: MIT

import { useEffect } from "react";
import { captureError } from "@/lib/sentry";

export interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Route segment name, reported as a tracking tag (issue #791). */
  segment: string;
  /** Human label for the area, e.g. "Payments". */
  title: string;
}

/**
 * Contained error state for a route segment (used by per-segment
 * error.tsx files). Keeps the shell and navigation usable — unlike the root
 * boundary, which replaces the whole page — and tags the report.
 */
export function SegmentError({ error, reset, segment, title }: SegmentErrorProps) {
  useEffect(() => {
    console.error(`[OphirPay:${segment}] Unhandled error:`, error);
    captureError(error, { tags: { segment } });
  }, [error, segment]);

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900"
      role="alert"
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {title} hit a problem
      </p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {error.message || "An unexpected error occurred. Navigation still works — try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ophir-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ophir-700"
      >
        Try Again
      </button>
    </div>
  );
}
