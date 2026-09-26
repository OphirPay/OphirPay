// SPDX-License-Identifier: MIT

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import {
  recordErrorReport,
  getStoredErrorReports,
  clearStoredErrorReports,
} from "@/lib/sentry";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/errors — Ingests client or server error reports, applies PII scrubbing,
 * deduplicates reports, and persists them into the queryable report store.
 */
export const POST = withMetrics(
  "POST /api/errors",
  withRequestLogging(async function POST(request: NextRequest) {
    try {
      const body = await request.json();

      if (!body || typeof body !== "object") {
        return errorResponse("INVALID_BODY", "Request body must be a JSON object", 400);
      }

      const {
        name,
        message,
        stack,
        component,
        segment,
        release,
        environment,
        tags,
        extra,
        optInPii,
        userId,
      } = body;

      if (!message || typeof message !== "string") {
        return errorResponse("INVALID_MESSAGE", "Error report must contain a message string", 400);
      }

      const report = recordErrorReport({
        name: typeof name === "string" ? name : "Error",
        message,
        stack: typeof stack === "string" ? stack : undefined,
        component: typeof component === "string" ? component : undefined,
        segment: typeof segment === "string" ? segment : undefined,
        release: typeof release === "string" ? release : undefined,
        environment: typeof environment === "string" ? environment : undefined,
        tags: tags && typeof tags === "object" ? tags : undefined,
        extra: extra && typeof extra === "object" ? extra : undefined,
        userId: typeof userId === "string" ? userId : undefined,
        optInPii: Boolean(optInPii),
      });

      return successResponse(report, undefined, report.count > 1 ? 200 : 201);
    } catch (err) {
      return errorResponse("INTERNAL_ERROR", (err as Error).message, 500);
    }
  })
);

/**
 * GET /api/errors — Query stored error reports by release, segment, component, or ID.
 */
export const GET = withMetrics(
  "GET /api/errors",
  withRequestLogging(async function GET(request: NextRequest) {
    try {
      const { searchParams } = new URL(request.url);
      const release = searchParams.get("release") || undefined;
      const segment = searchParams.get("segment") || undefined;
      const component = searchParams.get("component") || undefined;
      const id = searchParams.get("id") || undefined;
      const limitParam = searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : 50;

      const reports = getStoredErrorReports({ release, segment, component, id, limit });

      return successResponse({
        reports,
        total: reports.length,
      });
    } catch (err) {
      return errorResponse("INTERNAL_ERROR", (err as Error).message, 500);
    }
  })
);

/**
 * DELETE /api/errors — Clear stored error reports (testing/maintenance).
 */
export const DELETE = withMetrics(
  "DELETE /api/errors",
  withRequestLogging(async function DELETE() {
    clearStoredErrorReports();
    return successResponse({ cleared: true });
  })
);
