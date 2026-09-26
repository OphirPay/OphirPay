"use client";
// SPDX-License-Identifier: MIT

import { useCallback } from "react";
import { captureError, captureMessage, type ErrorReport } from "@/lib/sentry";

export interface ErrorTrackerOptions {
  segment?: string;
  optInPii?: boolean;
}

/**
 * React hook wrapping the error tracking integration.
 * Provides stable callbacks for capturing errors from component event handlers.
 *
 * @example
 * Capture a failed wallet-connect attempt with extra context:
 *
 * ```tsx
 * function ConnectButton() {
 *   const { trackError } = useErrorTracker("ConnectButton");
 *   const { connect } = useWallet();
 *
 *   return (
 *     <button
 *       onClick={async () => {
 *         try {
 *           await connect("freighter");
 *         } catch (err) {
 *           trackError(err as Error, { attempt: "freighter" });
 *         }
 *       }}
 *     >
 *       Connect
 *     </button>
 *   );
 * }
 * ```
 */
export function useErrorTracker(
  component?: string,
  options?: ErrorTrackerOptions
) {
  const trackError = useCallback(
    (
      error: Error,
      extra?: Record<string, unknown>,
      tags?: Record<string, string>
    ): ErrorReport => {
      return captureError(error, {
        component,
        segment: options?.segment,
        optInPii: options?.optInPii,
        extra,
        tags,
      });
    },
    [component, options?.segment, options?.optInPii]
  );

  const trackMessage = useCallback(
    (
      message: string,
      level: "info" | "warning" | "error" = "error",
      extra?: Record<string, unknown>
    ) => {
      captureMessage(message, level, {
        component,
        segment: options?.segment,
        optInPii: options?.optInPii,
        extra,
      });
    },
    [component, options?.segment, options?.optInPii]
  );

  return { trackError, trackMessage };
}
