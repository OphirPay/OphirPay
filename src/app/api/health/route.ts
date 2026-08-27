// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { STELLAR_NETWORK, SOROBAN_RPC_URL, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID } from "@/lib/contracts";
import { successResponse, serverError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withRequestLogging(async function GET() {
  try {
    // Check database connectivity
    let dbStatus: "ok" | "error" = "ok";
    let dbLatency: number | null = null;
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
    } catch {
      dbStatus = "error";
    }

    // Check Soroban RPC connectivity
    let rpcStatus: "ok" | "error" | "unchecked" = "unchecked";
    let rpcLatency: number | null = null;
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(SOROBAN_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      rpcLatency = Date.now() - start;
      rpcStatus = res.ok ? "ok" : "error";
    } catch {
      rpcStatus = "error";
    }

    // Check Horizon reachability
    let horizonStatus: "ok" | "error" | "unchecked" = "unchecked";
    let horizonLatency: number | null = null;
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(HORIZON_URL, { signal: controller.signal });
      clearTimeout(timeout);
      horizonLatency = Date.now() - start;
      horizonStatus = res.ok ? "ok" : "error";
    } catch {
      horizonStatus = "error";
    }

    // Check Redis connectivity (if configured)
    let redisStatus: "ok" | "error" | "disabled" = "disabled";
    let redisLatency: number | null = null;
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(redisUrl.replace(/\/\/.*@/, "//health:@").replace(/\/\d+$/, "") + "/ping", {
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeout);
        redisLatency = Date.now() - start;
        redisStatus = res?.ok ? "ok" : "error";
      } catch {
        redisStatus = "error";
      }
    }

    // Check Contract-ID presence
    const contractStatus: "ok" | "error" = 
      OPHIRPAY_CONTRACT_ID && OPHIRPAY_CONTRACT_ID.startsWith("C") && OPHIRPAY_CONTRACT_ID.length === 56 
        ? "ok" 
        : "error";

    const optionalChecks = [rpcStatus, horizonStatus, contractStatus, redisStatus].filter(
      (s: string) => s !== "disabled" && s !== "unchecked"
    );
    const hasOptionalError = optionalChecks.includes("error");
    const isDegraded = dbStatus === "ok" && hasOptionalError;
    const overallStatus = dbStatus === "error" ? "error" : isDegraded ? "degraded" : "ok";
    const healthy = overallStatus !== "error";

    return successResponse(
      {
        status: overallStatus,
        version: "0.1.0",
        services: {
          database: { status: dbStatus, latencyMs: dbLatency },
          redis: { status: redisStatus, latencyMs: redisLatency },
          stellar: {
            network: STELLAR_NETWORK,
            rpcUrl: SOROBAN_RPC_URL,
            horizonUrl: HORIZON_URL,
            rpc: { status: rpcStatus, latencyMs: rpcLatency },
            horizon: { status: horizonStatus, latencyMs: horizonLatency },
          },
          contract: {
            id: OPHIRPAY_CONTRACT_ID || null,
            status: contractStatus,
          },
        },
        uptime: process.uptime(),
      },
      { timestamp: new Date().toISOString() },
      healthy ? 200 : 503
    );
  } catch {
    return serverError("Health check failed");
  }
});
