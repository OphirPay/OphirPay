"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
  variant?: "text" | "card" | "table" | "stats" | "detail" | "timeline";
}

export function LoadingSkeleton({ className, lines = 3, variant = "text" }: SkeletonProps) {
  if (variant === "stats") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse motion-reduce:animate-none">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
          >
            <div className="flex justify-between mb-3">
              <div className="h-8 w-8 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="h-8 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-2" />
            <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse motion-reduce:animate-none", className)}>
        <div className="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-gray-200 dark:bg-gray-700" style={{ width: `${[100, 75, 60, 90, 50][i % 5]}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse motion-reduce:animate-none", className)}>
        <div className="flex justify-between mb-4">
          <div className="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex gap-4 py-3 border-b border-gray-100 dark:border-gray-800/50">
            <div className="flex-1 h-4 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="w-24 h-4 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="w-20 h-4 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 animate-pulse motion-reduce:animate-none space-y-6", className)}>
        <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="h-6 w-48 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-6 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex justify-between py-2 border-b border-gray-50 dark:border-gray-800/40">
              <div className="w-32 h-4 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="w-48 h-4 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "timeline") {
    return (
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 animate-pulse motion-reduce:animate-none", className)}>
        <div className="h-5 w-36 rounded bg-gray-200 dark:bg-gray-700 mb-6" />
        <div className="space-y-6">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 animate-pulse motion-reduce:animate-none", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-gray-200 dark:bg-gray-700"
          style={{ width: `${[100, 75, 60, 90, 50][i % 5]}%` }}
        />
      ))}
    </div>
  );
}
