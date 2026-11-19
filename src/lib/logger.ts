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
  "cookie",
  "cookies",
  "set-cookie",
  "x-api-key",
  "auth",
  "bearer",
  "privatekey",
  "private_key",
  "seed",
  "secretkey",
  "secret_key",
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
  /** Correlation id of the request that produced this entry, when in scope. */
  requestId?: string;
  context?: Record<string, unknown>;
}

/**
 * Read the current request id without importing the async-context module here.
 *
 * `logger` is imported by the Edge proxy, where `node:async_hooks` is not
 * available. `request-logging` publishes its lookup function on `globalThis`
 * once loaded, so every log emitted inside a handled request automatically
 * carries its id while the logger itself stays runtime-agnostic.
 */
const REQUEST_ID_PROVIDER = "__ophirpayRequestIdProvider";

type GlobalWithRequestIdProvider = typeof globalThis & {
  [REQUEST_ID_PROVIDER]?: () => string | undefined;
};

function currentRequestId(): string | undefined {
  try {
    return (globalThis as GlobalWithRequestIdProvider)[REQUEST_ID_PROVIDER]?.();
  } catch {
    return undefined;
  }
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(redactValue(entry));
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const requestId = currentRequestId();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(requestId ? { requestId } : {}),
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

  /** Log structured unhandled route errors */
  logError: (
    err: unknown,
    requestOrContext?: Request | { method?: string; path?: string; url?: string } | string,
    extraContext?: Record<string, unknown>
  ) => logError(err, requestOrContext, extraContext),
};

export interface ErrorLogContext extends Record<string, unknown> {
  method?: string;
  path?: string;
  requestId?: string;
  error?: string;
  stack?: string;
}

/**
 * Centralized error logging utility that outputs structured JSON logs (issue #1955).
 * Formats unhandled API route errors with timestamp, method, path, request ID,
 * and stack trace while redacting sensitive fields and secrets.
 */
export function logError(
  err: unknown,
  requestOrContext?: Request | { method?: string; path?: string; url?: string } | string,
  extraContext?: Record<string, unknown>
): void {
  let method: string | undefined;
  let path: string | undefined;
  let customContext: Record<string, unknown> = {};

  if (typeof Request !== "undefined" && requestOrContext instanceof Request) {
    method = requestOrContext.method;
    try {
      path = new URL(requestOrContext.url).pathname;
    } catch {
      path = requestOrContext.url;
    }
  } else if (typeof requestOrContext === "object" && requestOrContext !== null) {
    if ("method" in requestOrContext && typeof requestOrContext.method === "string") {
      method = requestOrContext.method;
    }
    if ("path" in requestOrContext && typeof requestOrContext.path === "string") {
      path = requestOrContext.path;
    } else if ("url" in requestOrContext && typeof requestOrContext.url === "string") {
      try {
        path = new URL(requestOrContext.url).pathname;
      } catch {
        path = requestOrContext.url;
      }
    }
    customContext = { ...requestOrContext };
    delete customContext.method;
    delete customContext.path;
    delete customContext.url;
  } else if (typeof requestOrContext === "string") {
    path = requestOrContext;
  }

  if (extraContext) {
    customContext = { ...customContext, ...extraContext };
  }

  const errorMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const requestId = currentRequestId() || (customContext.requestId as string | undefined);

  const context: ErrorLogContext = {
    ...(method ? { method } : {}),
    ...(path ? { path } : {}),
    ...(requestId ? { requestId } : {}),
    error: errorMessage,
    ...(stack ? { stack } : {}),
    ...customContext,
  };

  const logMessage = typeof requestOrContext === "string" ? requestOrContext : (errorMessage || "Unhandled error");
  logger.error(logMessage, context);
}
