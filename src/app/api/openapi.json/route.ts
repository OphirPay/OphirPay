// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { getOpenApiSpec } from "@/lib/openapi";
import { serverError } from "@/lib/api-response";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * Serves the parsed OpenAPI 3.1 specification from `docs/openapi.yaml` as JSON.
 * Used by the interactive API reference at `/docs/api` and external OpenAPI tooling.
 */
export const GET = withMetrics(
  "GET /api/openapi.json",
  withRequestLogging(async function GET() {
    try {
      const spec = getOpenApiSpec();
      return NextResponse.json(spec, {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (err) {
      console.error("[OpenAPI] Failed to load docs/openapi.yaml:", err);
      return serverError("Failed to load OpenAPI specification");
    }
  })
);
