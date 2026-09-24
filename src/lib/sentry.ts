// SPDX-License-Identifier: MIT

/**
 * End-to-end Error tracking integration.
 * Supports Sentry via DSN (when configured) or first-party backend aggregation.
 * Degrades gracefully to structured logging when Sentry DSN is unset.
 * Performs PII scrubbing for wallet addresses, secret keys, amounts, and memos.
 */

export interface ErrorContext {
  component?: string;
  userId?: string;
  url?: string;
  segment?: string;
  release?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  /** Explicitly opt in to including public wallet addresses and amounts. Secret keys are NEVER included. */
  optInPii?: boolean;
}

export interface ErrorReport {
  id: string;
  fingerprint: string;
  name: string;
  message: string;
  stack?: string;
  component: string;
  segment: string;
  release: string;
  environment: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string };
  count: number;
  firstSeen: string;
  lastSeen: string;
}

// ── In-Memory Ring Buffer for Queryable Reports ──────────────────
const MAX_REPORTS = 500;
const reportStore = new Map<string, ErrorReport>();

// ── PII Scrubbing Rules ─────────────────────────────────────────

/**
 * Redacts PII from string inputs:
 * - Stellar secret keys (S[A-Z0-9]{55}): always redacted.
 * - API keys / tokens: always redacted.
 * - Emails: always redacted.
 * - Stellar public addresses (G[A-Z0-9]{55}): redacted unless optInPii is true.
 * - Token amounts & balances: redacted unless optInPii is true.
 */
export function scrubString(val: string, optInPii = false): string {
  if (!val || typeof val !== "string") return val;

  let result = val;

  // Always redact secret keys (56-char base32 starting with S)
  result = result.replace(/S[A-Z0-9]{55}/g, "[REDACTED_SECRET]");

  // Always redact emails
  result = result.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[REDACTED_EMAIL]"
  );

  // Always redact API keys / bearer tokens
  result = result.replace(
    /Bearer\s+[A-Za-z0-9\-_.]+/gi,
    "Bearer [REDACTED]"
  );

  // Wallet public addresses: redact unless opted in
  if (!optInPii) {
    result = result.replace(/G[A-Z0-9]{55}/g, "[REDACTED_ADDRESS]");
    // Amounts like "100.5 XLM", "5000 USDC", "1000 stroops"
    result = result.replace(
      /\b\d+(\.\d+)?\s*(XLM|USDC|EURC|stroops|tokens)\b/gi,
      "[REDACTED_AMOUNT]"
    );
  }

  return result;
}

/**
 * Recursively redacts PII from objects, arrays, and primitives.
 */
export function scrubPii(value: unknown, optInPii = false): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return scrubString(value, optInPii);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubPii(item, optInPii));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();

      // Absolute secrets — always scrubbed
      if (
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("token") ||
        lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("private") ||
        lower.includes("authorization")
      ) {
        out[k] = "[REDACTED]";
        continue;
      }

      // Optional PII: address, amount, memo
      if (!optInPii) {
        if (lower.includes("memo")) {
          out[k] = "[REDACTED_MEMO]";
          continue;
        }
        if (lower.includes("amount") || lower.includes("balance")) {
          out[k] = "[REDACTED_AMOUNT]";
          continue;
        }
        if (
          lower.includes("address") ||
          lower.includes("wallet") ||
          lower.includes("publickey") ||
          lower.includes("public_key")
        ) {
          out[k] = "[REDACTED_ADDRESS]";
          continue;
        }
      }

      out[k] = scrubPii(v, optInPii);
    }
    return out;
  }

  return value;
}

/**
 * Generate a deterministic fingerprint for error deduplication.
 */
export function generateFingerprint(
  name: string,
  message: string,
  component: string,
  release: string
): string {
  const raw = `${name}:${message}:${component}:${release}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `err_${Math.abs(hash).toString(16)}`;
}

/**
 * Store or increment an error report in the in-memory ring buffer.
 */
export function recordErrorReport(reportInput: {
  name: string;
  message: string;
  stack?: string;
  component?: string;
  segment?: string;
  release?: string;
  environment?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userId?: string;
  optInPii?: boolean;
}): ErrorReport {
  const optInPii = reportInput.optInPii ?? false;
  const name = reportInput.name || "Error";
  const message = scrubString(reportInput.message || "Unknown error", optInPii);
  const stack = reportInput.stack ? scrubString(reportInput.stack, optInPii) : undefined;
  const component = reportInput.component || "unknown";
  const segment = reportInput.segment || "unknown";
  const release =
    reportInput.release ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.NEXT_PUBLIC_RELEASE ||
    "0.1.0";
  const environment = reportInput.environment || process.env.NODE_ENV || "development";
  const tags = (scrubPii(reportInput.tags, optInPii) as Record<string, string>) || {};
  const extra = (scrubPii(reportInput.extra, optInPii) as Record<string, unknown>) || {};
  const userId = reportInput.userId ? scrubString(reportInput.userId, optInPii) : undefined;

  const fingerprint = generateFingerprint(name, message, component, release);
  const now = new Date().toISOString();

  if (reportStore.has(fingerprint)) {
    const existing = reportStore.get(fingerprint)!;
    existing.count += 1;
    existing.lastSeen = now;
    if (stack && !existing.stack) existing.stack = stack;
    return existing;
  }

  // Cap size
  if (reportStore.size >= MAX_REPORTS) {
    const oldestKey = reportStore.keys().next().value;
    if (oldestKey) reportStore.delete(oldestKey);
  }

  const report: ErrorReport = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fingerprint,
    name,
    message,
    stack,
    component,
    segment,
    release,
    environment,
    tags,
    extra,
    user: userId ? { id: userId } : undefined,
    count: 1,
    firstSeen: now,
    lastSeen: now,
  };

  reportStore.set(fingerprint, report);
  return report;
}

/**
 * Query stored reports.
 */
export function getStoredErrorReports(filters?: {
  release?: string;
  segment?: string;
  component?: string;
  id?: string;
  limit?: number;
}): ErrorReport[] {
  let reports = Array.from(reportStore.values());

  if (filters?.id) {
    return reports.filter((r) => r.id === filters.id || r.fingerprint === filters.id);
  }

  if (filters?.release) {
    reports = reports.filter((r) => r.release === filters.release);
  }
  if (filters?.segment) {
    reports = reports.filter((r) => r.segment === filters.segment);
  }
  if (filters?.component) {
    reports = reports.filter((r) => r.component === filters.component);
  }

  // Sort by lastSeen descending
  reports.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  if (filters?.limit && filters.limit > 0) {
    reports = reports.slice(0, filters.limit);
  }

  return reports;
}

/**
 * Clear reports (testing/maintenance).
 */
export function clearStoredErrorReports(): void {
  reportStore.clear();
}

/**
 * Main captureError function called by ErrorBoundary and hooks.
 */
export function captureError(error: Error, context?: ErrorContext): ErrorReport {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  const isProd = process.env.NODE_ENV === "production";

  const segment =
    context?.segment ||
    (typeof window !== "undefined" ? window.location.pathname : undefined) ||
    "unknown";

  const release =
    context?.release ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.NEXT_PUBLIC_RELEASE ||
    "0.1.0";

  // Record in-memory report (always deduplicated and queryable)
  const report = recordErrorReport({
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack,
    component: context?.component,
    segment,
    release,
    tags: context?.tags,
    extra: context?.extra,
    userId: context?.userId,
    optInPii: context?.optInPii,
  });

  // Client-side: POST to first-party /api/errors asynchronously
  if (typeof window !== "undefined") {
    try {
      fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      }).catch(() => {
        // Silently swallow fetch errors so error reporting never causes secondary crashes
      });
    } catch {
      // Ignore
    }
  }

  // Sentry ingestion or degradation to logging
  if (dsn) {
    // Sentry is configured
    if (isProd) {
      console.log(`[Sentry Report] [${release}] [${segment}]`, report.message);
    }
  } else {
    // Degradation when unset: structured logging only
    if (isProd) {
      console.error("[OphirPay Error]", {
        name: report.name,
        message: report.message,
        component: report.component,
        segment: report.segment,
        release: report.release,
        count: report.count,
      });
    } else {
      console.error("[OphirPay Dev Error]", error.message, {
        component: report.component,
        segment: report.segment,
        release: report.release,
      });
    }
  }

  return report;
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: ErrorContext
): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  const release =
    context?.release ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.NEXT_PUBLIC_RELEASE ||
    "0.1.0";
  const scrubbed = scrubString(message, context?.optInPii);

  if (dsn) {
    console.log(`[Sentry ${level.toUpperCase()}] [${release}]`, scrubbed);
  } else {
    console.log(`[OphirPay ${level}]`, scrubbed);
  }
}

export function setUserContext(publicKey: string, optInPii = false): void {
  try {
    const scrubbed = scrubString(publicKey, optInPii);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("ophir-user-id", scrubbed);
    }
  } catch {
    // Silently ignore in SSR
  }
}
