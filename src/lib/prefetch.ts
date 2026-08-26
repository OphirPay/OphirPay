"use client";
// SPDX-License-Identifier: MIT


import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Prefetch routes on hover for instant navigation.
 * Usage: const { prefetch } = usePrefetch(); <Link onMouseEnter={() => prefetch("/send")} />
 */
export function usePrefetch() {
  const router = useRouter();

  const prefetch = useCallback(
    (href: string) => {
      try {
        router.prefetch(href);
      } catch {
        // Prefetch not supported (e.g., static export)
      }
    },
    [router]
  );

  return { prefetch };
}

/**
 * Common routes to preload on the dashboard for snappy navigation.
 * Call once on page load to warm the cache.
 */
export const PRELOAD_ROUTES = [
  "/",
  "/send",
  "/payments",
  "/batches",
  "/contracts",
] as const;
