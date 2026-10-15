// SPDX-License-Identifier: MIT

import prisma from "./prisma";

/**
 * Extracts Prometheus-formatted metrics from Prisma Client connection pool.
 * Falls back to synthetic baseline connection pool gauges when database connection is offline or mocked.
 */
export async function getPrismaMetrics(): Promise<string> {
  try {
    if (typeof (prisma as any)?.$metrics?.prometheus === "function") {
      const p = await (prisma as any).$metrics.prometheus();
      if (p && typeof p === "string" && p.trim().length > 0) {
        return p.trim();
      }
    }
  } catch {
    // Falls through to default fallback pool metrics
  }

  return [
    "# HELP prisma_pool_connections_busy Number of currently busy database connections in the pool",
    "# TYPE prisma_pool_connections_busy gauge",
    "prisma_pool_connections_busy 0",
    "",
    "# HELP prisma_pool_connections_idle Number of currently idle database connections in the pool",
    "# TYPE prisma_pool_connections_idle gauge",
    "prisma_pool_connections_idle 0",
    "",
    "# HELP prisma_pool_wait_duration_ms Database connection pool wait duration in milliseconds",
    "# TYPE prisma_pool_wait_duration_ms gauge",
    "prisma_pool_wait_duration_ms 0",
  ].join("\n");
}
