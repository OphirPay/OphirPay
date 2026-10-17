// SPDX-License-Identifier: MIT
// Issue #698 — CSP violation reporting collector.
//
// The browser POSTs violation reports here when a resource is blocked by the
// Content-Security-Policy set in src/proxy.ts.  Both the legacy
// `report-uri` format (application/csp-report) and the modern Reporting API
// format (application/reports+json) are accepted.
//
// Security requirements met by this handler:
//   • Body is size-capped at 16 KiB.  Oversized bodies are rejected with 413
//     before any parse or log attempt.
//   • Cookies, Authorization headers, and any field matching the logger's
//     SENSITIVE_FIELDS list are never logged (the logger redacts them).
//   • Query-string parameters are ignored entirely.
//   • The structured log line includes: violated-directive, blocked-uri,
//     document-uri, disposition, effective-directive, and source-file.
//     Fields that browsers omit are undefined and are stripped from the log
//     entry before writing, so the line never contains a literal "undefined".
//   • Each accepted report increments the csp_violation_reports_total metric
//     so operators can observe report volume without replaying raw log lines.
//   • Rate-limiting for this endpoint is enforced per-IP and per-session (#1392).

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { incMetric, incCspReportsDropped } from "@/lib/metrics-counters";
import {
  getRateLimitStore,
  getRetryAfterSeconds,
  CSP_REPORT_RATE_LIMIT_MAX,
  CSP_REPORT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/proxy-config";

/** Maximum accepted request body size in bytes (16 KiB). */
const MAX_BODY_BYTES = 16 * 1024;

/** 5-minute sliding window for report deduplication (#1392). */
export const CSP_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/** In-memory cache tracking report hashes and expiration timestamp (#1392). */
const dedupeCache = new Map<string, number>();

/** Compute a stable SHA-256 hash from directive and blocked URI (#1392). */
export function computeReportDedupeHash(
  effectiveDirective?: string,
  violatedDirective?: string,
  blockedUri?: string
): string {
  const directive = (effectiveDirective || violatedDirective || "").trim().toLowerCase();
  const uri = (blockedUri || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${directive}|${uri}`).digest("hex");
}

/** Check if a report hash has already been received within the 5-minute window (#1392). */
export function isDuplicateCspReport(hash: string, now = Date.now()): boolean {
  const expiresAt = dedupeCache.get(hash);
  if (expiresAt !== undefined && expiresAt > now) {
    return true;
  }
  return false;
}

/** Record report hash into deduplication cache with a 5-minute TTL (#1392). */
export function recordCspReportDedupe(hash: string, now = Date.now()): void {
  dedupeCache.set(hash, now + CSP_DEDUPE_WINDOW_MS);
  if (dedupeCache.size > 10_000) {
    for (const [k, exp] of dedupeCache.entries()) {
      if (exp <= now) dedupeCache.delete(k);
    }
  }
}

/** Reset deduplication cache. Intended for tests. */
export function clearCspDedupeCacheForTests(): void {
  dedupeCache.clear();
}

// ── Type helpers ──────────────────────────────────────────────

/** Shape of the `csp-report` object inside an application/csp-report POST. */
interface LegacyCspReport {
  "document-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "blocked-uri"?: string;
  "disposition"?: string;
  "source-file"?: string;
  "line-number"?: number;
  "column-number"?: number;
  "status-code"?: number;
  "original-policy"?: string;
  // Intentionally exclude referrer — it can contain PII.
  [key: string]: unknown;
}

/** Shape of a single entry in an application/reports+json array. */
interface ReportingApiEntry {
  type?: string;
  age?: number;
  url?: string;
  body?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
    "disposition"?: string;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
    "status-code"?: number;
    [key: string]: unknown;
  };
}

/** Fields we log from a CSP report — a strict allow-list to avoid logging user PII. */
interface SafeReportFields {
  documentUri?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  blockedUri?: string;
  disposition?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  statusCode?: number;
  reportFormat: "csp-report" | "reports+json";
}

function extractLegacyFields(report: LegacyCspReport): Omit<SafeReportFields, "reportFormat"> {
  return {
    documentUri: report["document-uri"] ?? undefined,
    violatedDirective: report["violated-directive"] ?? undefined,
    effectiveDirective: report["effective-directive"] ?? undefined,
    blockedUri: report["blocked-uri"] ?? undefined,
    disposition: report["disposition"] ?? undefined,
    sourceFile: report["source-file"] ?? undefined,
    lineNumber: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
    columnNumber:
      typeof report["column-number"] === "number" ? report["column-number"] : undefined,
    statusCode: typeof report["status-code"] === "number" ? report["status-code"] : undefined,
  };
}

function extractReportingApiFields(
  entry: ReportingApiEntry
): Omit<SafeReportFields, "reportFormat"> {
  const body = entry.body ?? {};
  return {
    documentUri: body["document-uri"] ?? entry.url ?? undefined,
    violatedDirective: body["violated-directive"] ?? undefined,
    effectiveDirective: body["effective-directive"] ?? undefined,
    blockedUri: body["blocked-uri"] ?? undefined,
    disposition: body["disposition"] ?? undefined,
    sourceFile: body["source-file"] ?? undefined,
    lineNumber: typeof body["line-number"] === "number" ? body["line-number"] : undefined,
    columnNumber:
      typeof body["column-number"] === "number" ? body["column-number"] : undefined,
    statusCode: typeof body["status-code"] === "number" ? body["status-code"] : undefined,
  };
}

/** Remove keys whose value is undefined so the log line stays compact. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

// ── Route handler ─────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Size-cap the body before reading it (#1392).
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    incCspReportsDropped("oversized");
    return new NextResponse(null, { status: 413 });
  }

  // 2. Read raw bytes to enforce the cap even when Content-Length is absent.
  let rawText: string;
  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      incCspReportsDropped("oversized");
      return new NextResponse(null, { status: 413 });
    }
    rawText = new TextDecoder().decode(buffer);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // 3. Rate-limit check per IP and per session (60 reports/min, #1392)
  const rateLimitStore = getRateLimitStore();
  const ip = getClientIp(request.headers);
  const ipResult = await rateLimitStore.increment(
    `csp:ip:${ip}`,
    CSP_REPORT_RATE_LIMIT_WINDOW_MS,
    CSP_REPORT_RATE_LIMIT_MAX
  );

  const sessionId =
    request.cookies.get("ophirpay_session")?.value ||
    request.headers.get("x-session-id");
  let sessionAllowed = true;
  if (sessionId) {
    const sessionResult = await rateLimitStore.increment(
      `csp:session:${sessionId}`,
      CSP_REPORT_RATE_LIMIT_WINDOW_MS,
      CSP_REPORT_RATE_LIMIT_MAX
    );
    sessionAllowed = sessionResult.allowed;
  }

  if (!ipResult.allowed || !sessionAllowed) {
    incCspReportsDropped("rate_limited");
    const retryAfter = getRetryAfterSeconds(ipResult);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many CSP violation reports. Please slow down.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  // 4. Determine the report format from Content-Type.
  const contentType = request.headers.get("content-type") ?? "";
  const isLegacyFormat = contentType.includes("application/csp-report");
  const isReportingApi = contentType.includes("application/reports+json");

  if (!isLegacyFormat && !isReportingApi) {
    // Some browsers (mostly older Safari) omit the header; accept the body
    // if it parses as either format rather than rejecting a valid report.
  }

  // 5. Parse the body — reject malformed JSON without logging the raw bytes.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // 6. Extract the safe allow-listed fields.
  const reports: SafeReportFields[] = [];

  if (isReportingApi && Array.isArray(parsed)) {
    // application/reports+json — an array of report objects.
    for (const entry of parsed as ReportingApiEntry[]) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry.type === "csp-violation" || entry.type === undefined)
      ) {
        reports.push({
          ...extractReportingApiFields(entry),
          reportFormat: "reports+json",
        });
      }
    }
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    "csp-report" in (parsed as Record<string, unknown>)
  ) {
    // application/csp-report — a single { "csp-report": { … } } envelope.
    const envelope = parsed as { "csp-report": LegacyCspReport };
    reports.push({
      ...extractLegacyFields(envelope["csp-report"] ?? {}),
      reportFormat: "csp-report",
    });
  } else if (Array.isArray(parsed) && !isLegacyFormat) {
    // Ambiguous array without a clear Content-Type — treat as Reporting API.
    for (const entry of parsed as ReportingApiEntry[]) {
      if (typeof entry === "object" && entry !== null) {
        reports.push({
          ...extractReportingApiFields(entry),
          reportFormat: "reports+json",
        });
      }
    }
  } else {
    // Unrecognised structure.
    return new NextResponse(null, { status: 400 });
  }

  if (reports.length === 0) {
    // Nothing meaningful to log, but the browser did its job.
    return new NextResponse(null, { status: 204 });
  }

  // 7. Deduplicate and log reports within 5-minute sliding window (#1392).
  for (const report of reports) {
    const dedupeHash = computeReportDedupeHash(
      report.effectiveDirective,
      report.violatedDirective,
      report.blockedUri
    );

    if (isDuplicateCspReport(dedupeHash)) {
      incCspReportsDropped("deduplicated");
      continue;
    }

    recordCspReportDedupe(dedupeHash);
    logger.warn("csp_violation", compact(report as unknown as Record<string, unknown>));
    incMetric("csp_violation_reports_total");
  }

  // 8. Respond with 204 No Content — the browser expects no body.
  return new NextResponse(null, { status: 204 });
}

// GET is intentionally not implemented; the browser never sends GETs here.
