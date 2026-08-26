"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
  variant?: "text" | "card" | "table" | "stats";
}

export function LoadingSkeleton({ className, lines = 3, variant = "text" }: SkeletonProps) {
  if (variant === "stats") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
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
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse", className)}>
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
      <div className={cn("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse", className)}>
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

  return (
    <div className={cn("space-y-2 animate-pulse", className)}>
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
