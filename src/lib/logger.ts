// SPDX-License-Identifier: MIT

/**
 * Structured logger for API requests and application events.
 * In production, replace console.log with a proper logger (e.g., pino, winston).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_FIELDS = new Set([
  "memo",
  "memos",
  "email",
  "emails",
  "apiKey",
  "api_key",
  "apikey",
  "authorization",
  "token",
  "secret",
  "password",
]);

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Redact email addresses
    return value.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      "[REDACTED]"
    );
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactValue(entry);
      }
    }
    return out;
  }
  return value;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(redactValue(entry));
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
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
