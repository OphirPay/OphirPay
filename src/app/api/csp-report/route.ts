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
//   • Rate-limiting for this endpoint is handled globally by src/proxy.ts.

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";

/** Maximum accepted request body size in bytes (16 KiB). */
const MAX_BODY_BYTES = 16 * 1024;

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
  // 1. Size-cap the body before reading it.
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  // 2. Read raw bytes to enforce the cap even when Content-Length is absent.
  let rawText: string;
  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    rawText = new TextDecoder().decode(buffer);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // 3. Determine the report format from Content-Type.
  const contentType = request.headers.get("content-type") ?? "";
  const isLegacyFormat = contentType.includes("application/csp-report");
  const isReportingApi = contentType.includes("application/reports+json");

  if (!isLegacyFormat && !isReportingApi) {
    // Some browsers (mostly older Safari) omit the header; accept the body
    // if it parses as either format rather than rejecting a valid report.
  }

  // 4. Parse the body — reject malformed JSON without logging the raw bytes.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // 5. Extract the safe allow-listed fields and log one structured line.
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

  // 6. Log and count each report.
  for (const report of reports) {
    logger.warn("csp_violation", compact(report as unknown as Record<string, unknown>));
    incMetric("csp_violation_reports_total");
  }

  // 7. Respond with 204 No Content — the browser expects no body.
  return new NextResponse(null, { status: 204 });
}

// GET is intentionally not implemented; the browser never sends GETs here.
