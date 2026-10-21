// SPDX-License-Identifier: MIT
import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";

export async function GET() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return successResponse(
      {
        status: "ok",
        probe: "readiness",
        services: { database: { status: "ok", latencyMs: Date.now() - start } },
      },
      { timestamp: new Date().toISOString() }
    );
  } catch (error) {
    console.error("[HealthCheck] Readiness database connection failed:", error);
    return successResponse(
      {
        status: "error",
        probe: "readiness",
        services: { database: { status: "error", latencyMs: Date.now() - start } },
      },
      { timestamp: new Date().toISOString() },
      503
    );
  }
}