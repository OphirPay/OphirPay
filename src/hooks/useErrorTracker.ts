"use client";
// SPDX-License-Identifier: MIT


import { useCallback } from "react";
import { captureError, captureMessage } from "@/lib/sentry";

/**
 * React hook wrapping the error tracking integration.
 * Provides a stable callback for capturing errors from component event handlers.
 */
export function useErrorTracker(component?: string) {
  const trackError = useCallback(
    (error: Error, extra?: Record<string, unknown>) => {
      captureError(error, { component, extra });
    },
    [component]
  );

  const trackMessage = useCallback(
    (message: string, level: "info" | "warning" | "error" = "error") => {
      captureMessage(message, level);
    },
    []
  );

  return { trackError, trackMessage };
}
