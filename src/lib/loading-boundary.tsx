"use client";
// SPDX-License-Identifier: MIT


import { type ReactNode,Suspense } from "react";

import { LoadingSkeleton } from "@/components/LoadingSkeleton";

interface LoadingBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: "text" | "card" | "table" | "stats";
}

/**
 * Wraps children in a React Suspense boundary with a loading skeleton.
 * Use this for lazy-loaded page sections.
 */
export function LoadingBoundary({
  children,
  fallback,
  variant = "card",
}: LoadingBoundaryProps) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className="animate-fade-in">
            <LoadingSkeleton variant={variant} />
          </div>
        )
      }
    >
      {children}
    </Suspense>
  );
}
