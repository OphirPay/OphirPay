"use client";
// SPDX-License-Identifier: MIT

import { useEffect } from "react";
import Link from "next/link";
import { reportRenderedError } from "@/lib/analytics-events";

export interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  segment: string;
  title?: string;
  description?: string;
}

export function SegmentError({
  error,
  reset,
  segment,
  title,
  description,
}: SegmentErrorProps) {
  useEffect(() => {
    console.error(`[OphirPay ${segment}] Route error:`, error);
    reportRenderedError(error, undefined, segment);
  }, [error, segment]);

  const displayTitle =
    title ||
    `${segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")}`;

  return (
    <div
      data-testid={`segment-error-${segment}`}
      className="p-6 md:p-8 max-w-2xl mx-auto my-8 animate-fade-in"
      role="alert"
      aria-live="assertive"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-red-200 dark:border-red-900/40 p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <div>
            <span
              data-testid="segment-badge"
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 capitalize mb-1"
            >
              {segment}
            </span>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Failed to load {displayTitle}
            </h2>
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {description ||
            "An unexpected error occurred while loading this section. Navigation and the rest of the application remain available."}
        </p>

        {error.message && (
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 text-xs font-mono text-gray-700 dark:text-gray-300 break-words mb-6 border border-gray-200 dark:border-gray-800">
            {error.message}
          </div>
        )}

        {error.digest && (
          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mb-4">
            Error digest: {error.digest}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Back to Treasury
          </Link>
        </div>
      </div>
    </div>
  );
}

export default SegmentError;
