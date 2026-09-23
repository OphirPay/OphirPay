import { useCallback } from "react";

export interface ErrorReportOptions {
  segment?: string;
  component?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function trackError(error: unknown, options?: ErrorReportOptions | string) {
  const opts: ErrorReportOptions =
    typeof options === "string" ? { segment: options } : options || {};
  const segment = opts.segment || "global";

  if (process.env.NODE_ENV !== "test") {
    console.error(`[ErrorTracker] [Segment: ${segment}]`, error, opts);
  }

  try {
    if (typeof window !== "undefined" && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: { segment, ...opts.tags },
        extra: opts.extra,
      });
    }
  } catch {
    // Ignore reporting errors
  }

  return { error, segment, options: opts };
}

export function useErrorTracker() {
  const logError = useCallback((error: unknown, options?: ErrorReportOptions | string) => {
    return trackError(error, options);
  }, []);

  return { trackError: logError };
}
