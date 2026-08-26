"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  /** Width as CSS value (e.g., "100%", "200px", "3rem") */
  width?: string;
  /** Height as CSS value */
  height?: string;
}

/**
 * Minimal inline skeleton for quick loading placeholders.
 * For structured skeletons (cards, tables, stats), use LoadingSkeleton instead.
 */
export function Skeleton({ className, width, height = "1rem" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-gray-200 dark:bg-gray-700", className)}
      style={{ width, height }}
    />
  );
}
