// SPDX-License-Identifier: MIT

/**
 * CSP Violation Reporting Collector (POST /api/csp-report).
 *
 * Receives Content Security Policy violation reports from browsers:
 * - Legacy CSP Level 2 format: Content-Type: application/csp-report
 * - Modern Reporting API format: Content-Type: application/reports+json
 * - Standard JSON: Content-Type: application/json
 *
 * Security & Privacy:
 * - Drops cookies, session identifiers, and auth tokens.
 * - Strips query strings and hash fragments from all URL fields.
 * - Enforces per-IP rate limiting to prevent DoS and log flooding.
 * - Limits request body size (max 16KB).
 * - Rejects oversized or malformed payloads without logging their raw contents.
 * - Increments Prometheus counter `ophirpay_csp_reports_total`.
 * - Logs structured warnings via `logger.warn`.
 * - Returns 204 No Content on successful ingestion.
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { incCspReports } from "@/lib/metrics-counters";
import { withMetrics } from "@/lib/metrics-middleware";
import { enforceCspRateLimit } from "@/lib/csp-rate-limit";
import { ERROR_CODES } from "@/lib/error-codes";

/** Maximum allowed payload size: 16 KB */
const MAX_BODY_BYTES = 16 * 1024;

interface SanitizedCspViolation {
  documentUri?: string;
  blockedUri?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  disposition?: string;
  referrer?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  statusCode?: number;
  sample?: string;
}

/**
 * Strips query strings, credentials, and hash fragments from URLs to prevent
 * leaking tokens or sensitive query parameters into logs.
 */
function stripUrlSensitiveData(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return undefined;
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    // Relative URL or non-standard scheme (e.g. data:, inline, eval, blob:, chrome-extension:)
    return trimmed.split("?")[0].split("#")[0];
  }
}

/**
 * Truncates and sanitizes inline script samples.
 */
function sanitizeSample(rawSample: unknown): string | undefined {
  if (typeof rawSample !== "string" || !rawSample.trim()) return undefined;
  return rawSample.trim().slice(0, 128);
}

/**
 * Safely reads the request body with a strict maximum byte limit.
 * Protects against oversized payloads and streaming attacks.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; error: "too_large" }> {
  const cl = request.headers.get("content-length");
  if (cl) {
    const len = parseInt(cl, 10);
    if (!Number.isNaN(len) && len > maxBytes) {
      return { ok: false, error: "too_large" };
    }
  }

  if (request.body && typeof request.body.getReader === "function") {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            return { ok: false, error: "too_large" };
          }
          chunks.push(value);
        }
      }
    } catch {
      // Stream reading error or cancellation
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(combined) };
  }

  const text = await request.text();
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true, text };
}

/**
 * Normalizes a raw violation object into a sanitized representation.
 */
function normalizeViolation(obj: Record<string, unknown>, fallbackDocUrl?: string): SanitizedCspViolation | null {
  const documentUri =
    stripUrlSensitiveData(obj["document-uri"] || obj["documentURL"] || obj["documentUri"]) ||
    stripUrlSensitiveData(fallbackDocUrl);

  const blockedUri = stripUrlSensitiveData(
    obj["blocked-uri"] || obj["blockedURL"] || obj["blockedUri"]
  );

  const violatedDirective =
    typeof (obj["violated-directive"] || obj["violatedDirective"]) === "string"
      ? String(obj["violated-directive"] || obj["violatedDirective"])
      : undefined;

  const effectiveDirective =
    typeof (obj["effective-directive"] || obj["effectiveDirective"]) === "string"
      ? String(obj["effective-directive"] || obj["effectiveDirective"])
      : undefined;

  const disposition =
    typeof obj["disposition"] === "string" ? String(obj["disposition"]) : undefined;

  const referrer = stripUrlSensitiveData(obj["referrer"]);
  const sourceFile = stripUrlSensitiveData(
    obj["source-file"] || obj["sourceFile"]
  );

  const rawLine = obj["line-number"] ?? obj["lineNumber"];
  const lineNumber =
    typeof rawLine === "number" ? rawLine : typeof rawLine === "string" ? parseInt(rawLine, 10) || undefined : undefined;

  const rawCol = obj["column-number"] ?? obj["columnNumber"];
  const columnNumber =
    typeof rawCol === "number" ? rawCol : typeof rawCol === "string" ? parseInt(rawCol, 10) || undefined : undefined;

  const rawStatus = obj["status-code"] ?? obj["statusCode"];
  const statusCode =
    typeof rawStatus === "number" ? rawStatus : typeof rawStatus === "string" ? parseInt(rawStatus, 10) || undefined : undefined;

  const sample = sanitizeSample(
    obj["script-sample"] || obj["scriptSample"] || obj["sample"]
  );

  // A valid CSP report must have at least one distinguishing violation field
  if (!blockedUri && !violatedDirective && !effectiveDirective && !sourceFile) {
    return null;
  }

  return {
    documentUri,
    blockedUri,
    violatedDirective,
    effectiveDirective,
    disposition,
    referrer,
    sourceFile,
    lineNumber,
    columnNumber,
    statusCode,
    sample,
  };
}

/**
 * Extracts and sanitizes violation entries from parsed JSON payload.
 */
function extractViolations(payload: unknown): SanitizedCspViolation[] {
  const violations: SanitizedCspViolation[] = [];

  if (Array.isArray(payload)) {
    // Modern Reporting API payload: array of reports
    for (const item of payload) {
      if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        if (itemObj.type === "csp-violation" && itemObj.body && typeof itemObj.body === "object") {
          const v = normalizeViolation(
            itemObj.body as Record<string, unknown>,
            typeof itemObj.url === "string" ? itemObj.url : undefined
          );
          if (v) violations.push(v);
        } else if (itemObj["csp-report"] && typeof itemObj["csp-report"] === "object") {
          const v = normalizeViolation(itemObj["csp-report"] as Record<string, unknown>);
          if (v) violations.push(v);
        } else {
          const v = normalizeViolation(itemObj);
          if (v) violations.push(v);
        }
      }
    }
  } else if (payload && typeof payload === "object") {
    const payloadObj = payload as Record<string, unknown>;
    if (payloadObj["csp-report"] && typeof payloadObj["csp-report"] === "object") {
      // Legacy CSP Level 2: { "csp-report": { ... } }
      const v = normalizeViolation(payloadObj["csp-report"] as Record<string, unknown>);
      if (v) violations.push(v);
    } else if (payloadObj.type === "csp-violation" && payloadObj.body && typeof payloadObj.body === "object") {
      // Single Reporting API object: { type: "csp-violation", body: { ... } }
      const v = normalizeViolation(
        payloadObj.body as Record<string, unknown>,
        typeof payloadObj.url === "string" ? payloadObj.url : undefined
      );
      if (v) violations.push(v);
    } else {
      // Direct violation object
      const v = normalizeViolation(payloadObj);
      if (v) violations.push(v);
    }
  }

  return violations;
}

export const POST = withMetrics(
  "POST /api/csp-report",
  async function POST(request: Request) {
    // 1. Rate limiting check (per-IP)
    const rateLimitError = await enforceCspRateLimit(request);
    if (rateLimitError) {
      return rateLimitError;
    }

    // 2. Validate Content-Type
    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    const isSupportedContentType =
      contentType.includes("application/csp-report") ||
      contentType.includes("application/reports+json") ||
      contentType.includes("application/json");

    if (!isSupportedContentType) {
      logger.warn("CSP report rejected: unsupported media type");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
            message:
              "Unsupported Content-Type. Expected application/csp-report or application/reports+json.",
          },
        },
        {
          status: 415,
          headers: { "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    // 3. Read body with size limit
    const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      logger.warn("CSP report rejected: payload too large");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            message: "CSP report payload exceeds maximum allowed size.",
          },
        },
        {
          status: 413,
          headers: { "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    if (!bodyResult.text || !bodyResult.text.trim()) {
      logger.warn("CSP report rejected: empty payload");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.BAD_REQUEST,
            message: "Empty CSP report payload.",
          },
        },
        {
          status: 400,
          headers: { "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    // 4. Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyResult.text);
    } catch {
      logger.warn("CSP report rejected: malformed JSON payload");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.BAD_REQUEST,
            message: "Malformed JSON payload.",
          },
        },
        {
          status: 400,
          headers: { "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    // 5. Extract and sanitize violations
    const violations = extractViolations(parsed);
    if (violations.length === 0) {
      logger.warn("CSP report rejected: invalid or empty violation report structure");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.BAD_REQUEST,
            message: "Invalid or empty CSP violation report.",
          },
        },
        {
          status: 400,
          headers: { "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    // 6. Log sanitized violations (no cookies, tokens, or query strings)
    for (const v of violations) {
      logger.warn("CSP violation detected", {
        documentUri: v.documentUri,
        blockedUri: v.blockedUri,
        violatedDirective: v.violatedDirective,
        effectiveDirective: v.effectiveDirective,
        disposition: v.disposition,
        referrer: v.referrer,
        sourceFile: v.sourceFile,
        lineNumber: v.lineNumber,
        columnNumber: v.columnNumber,
        statusCode: v.statusCode,
        ...(v.sample ? { sample: v.sample } : {}),
      });
    }

    // 7. Increment metric counter
    incCspReports(violations.length);

    // 8. Return 204 No Content
    return new NextResponse(null, { status: 204 });
  }
);

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: ERROR_CODES.METHOD_NOT_ALLOWED,
        message: "Method not allowed. Use POST to report CSP violations.",
      },
    },
    {
      status: 405,
      headers: {
        Allow: "POST, OPTIONS",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
