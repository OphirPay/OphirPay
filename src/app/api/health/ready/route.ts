// SPDX-License-Identifier: MIT
import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * Readiness probe — `GET /api/health/ready` (issue #1337).
 *
 * Lightweight probe for orchestrators (Kubernetes / Helm).
 * Only checks critical local database connectivity (PostgreSQL via Prisma),
 * which is the single dependency that causes /api/health to return 503.
 *
 * Running this isolated probe prevents external public endpoint latency
 * (Soroban RPC / Horizon) from timing out Kubernetes readiness checks and
 * causing healthy pods to flap NotReady.
 */
export const GET = withMetrics(
  "GET /api/health/ready",
  withRequestLogging(async function GET() {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;

      return successResponse(
        {
          status: "ok",
          probe: "readiness",
          database: { status: "ok", latencyMs },
          uptime: process.uptime(),
        },
        { timestamp: new Date().toISOString() },
        200
      );
    } catch (err) {
      console.error("[HealthReady] Database connection failed:", err);
      return successResponse(
        {
          status: "error",
          probe: "readiness",
          database: { status: "error", latencyMs: null },
          uptime: process.uptime(),
        },
        { timestamp: new Date().toISOString() },
        503
      );
    }
  })
);
