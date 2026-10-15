// SPDX-License-Identifier: MIT
import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";

/**
 * Readiness probe — `GET /api/health/ready` (issue #1337).
 *
 * Answers: is this pod ready to accept user traffic?
 * Performs only the critical database check (which determines whether
 * the application can serve requests).
 *
 * If the database check fails, returns HTTP 503 so Kubernetes readinessProbe
 * removes the pod from service endpoints without restarting the container.
 * Unlike `/api/health`, it skips slow third-party calls (Soroban RPC, Horizon, Redis)
 * to guarantee sub-second probe evaluation well within the readiness timeout.
 */
export async function GET() {
  const start = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  let dbLatency: number | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - start;
  } catch (err) {
    console.error("[ReadinessCheck] Database connection failed:", err);
    dbStatus = "error";
  }

  const isReady = dbStatus === "ok";

  return successResponse(
    {
      status: isReady ? "ok" : "error",
      probe: "readiness",
      services: {
        database: { status: dbStatus, latencyMs: dbLatency },
      },
      uptime: process.uptime(),
    },
    { timestamp: new Date().toISOString() },
    isReady ? 200 : 503
  );
}
