// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { successResponse } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * Lightweight liveness probe endpoint.
 * Returns HTTP 200 as long as the Node.js process is running and responsive.
 * Does not check external dependencies to avoid pod restart loops during transient dependency outages.
 */
export const GET = withMetrics(
  "GET /api/health/liveness",
  withRequestLogging(async function GET() {
    return successResponse(
      {
        status: "ok",
        probe: "liveness",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      { timestamp: new Date().toISOString() },
      200
    );
  })
);
