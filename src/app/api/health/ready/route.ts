// SPDX-License-Identifier: MIT
import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";

/** Maximum time allowed for the readiness database ping (ms). */
export const READINESS_DB_TIMEOUT_MS = 2_000;

/**
 * Readiness probe — `GET /api/health/ready` (issue #1337).
 *
 * Verifies that this replica can reach PostgreSQL within `READINESS_DB_TIMEOUT_MS`
 * (2s) without blocking on external third-party dependencies (Stellar Horizon
 * or Soroban RPC). Returns HTTP 200 when ready to receive traffic and HTTP 503
 * when the database is unreachable or times out.
 */
export async function GET() {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database readiness check timed out")),
          READINESS_DB_TIMEOUT_MS,
        );
      }),
    ]);
    const latencyMs = Date.now() - start;

    return successResponse(
      {
        status: "ok",
        probe: "readiness",
        database: { status: "ok", latencyMs },
        uptime: process.uptime(),
      },
      { timestamp: new Date().toISOString() },
      200,
    );
  } catch (err) {
    console.error("[ReadinessCheck] Database readiness check failed:", err);
    return successResponse(
      {
        status: "error",
        probe: "readiness",
        database: { status: "error", latencyMs: Date.now() - start },
        uptime: process.uptime(),
      },
      { timestamp: new Date().toISOString() },
      503,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
