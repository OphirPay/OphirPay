// SPDX-License-Identifier: MIT

import { getCurrentRequestId } from "@/lib/request-context";

/**
 * Structured logger for API requests and application events.
 * In production, replace console.log with a proper logger (e.g., pino, winston).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Attach the current request id (from the async request context) to a log
 * entry's context when the caller did not already provide one. This is what
 * makes "every log entry for one request shares an id end to end" true
 * without requiring every call site to thread the id through manually — the
 * request-logging middleware sets the context once, and the logger reads it
 * for every subsequent line in that request.
 *
 * A caller-provided `requestId` (e.g. `logger.request()` or `handleApiError`)
 * always wins, so explicit ids are preserved verbatim. The caller's object is
 * never mutated; a new context is returned when an id is attached.
 */
function withRequestId(
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const id = getCurrentRequestId();
  if (!id) return context;
  if (context && Object.prototype.hasOwnProperty.call(context, "requestId")) {
    return context;
  }
  return { ...(context ?? {}), requestId: id };
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: withRequestId(context),
  };

  const line = formatEntry(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),

  /**
   * Log an API request with method, path, status, duration, and (when
   * available) the request id so a log line can be correlated with the
   * X-Request-Id response header.
   */
  request: (
    method: string,
    path: string,
    status: number,
    durationMs: number,
    requestId?: string
  ) => {
    log("info", `${method} ${path} ${status}`, {
      method,
      path,
      status,
      durationMs,
      ...(requestId ? { requestId } : {}),
    });
  },

  /** Track a metric with a name and value for monitoring */
  metric: (name: string, value: number, tags?: Record<string, string>) => {
    log("debug", `metric:${name}`, { name, value, ...tags });
  },

  /** Log a performance timing */
  timing: (label: string, durationMs: number) => {
    log("debug", `timing:${label}`, { label, durationMs });
  },
};
