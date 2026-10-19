// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { getOpenApiSpec } from "@/lib/openapi";
import { withRequestLogging } from "@/lib/request-logging";

export const dynamic = "force-dynamic";

/**
 * GET /api/openapi.json
 *
 * Serves the compiled OpenAPI 3.1 specification for OphirPay,
 * enriched with Stellar Testnet configurations for Swagger/Scalar viewers.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceReload = searchParams.get("reload") === "true";
    const spec = getOpenApiSpec(forceReload);

    return NextResponse.json(spec, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load OpenAPI specification";
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "OPENAPI_LOAD_ERROR",
          message,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLogging(_GET);
