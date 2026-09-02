// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { STELLAR_NETWORK, SOROBAN_RPC_URL, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID } from "@/lib/contracts";
import { successResponse, serverError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";

// ── Check helpers ──────────────────────────────────────────────

type CheckStatus = "ok" | "error" | "unchecked" | "disabled" | "not_configured";

/** GET a URL and report reachability + latency; null when it errors/times out. */
async function pingUrl(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** POST a JSON-RPC body and report reachability + latency; null on failure. */
async function pingJsonRpc(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = withMetrics("GET /api/health", withRequestLogging(async function GET() {
  try {
    // Critical check: database connectivity
    let dbStatus: "ok" | "error" = "ok";
    let dbLatency: number | null = null;
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
    } catch {
      dbStatus = "error";
    }

    // Optional check: Soroban RPC reachability
    let rpcStatus: CheckStatus = "unchecked";
    let rpcLatency: number | null = null;
    const rpc = await pingJsonRpc(
      SOROBAN_RPC_URL,
      { jsonrpc: "2.0", id: 1, method: "getHealth" },
      5000
    );
    if (rpc) {
      rpcStatus = rpc.ok ? "ok" : "error";
      rpcLatency = rpc.latencyMs;
    } else {
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
      const pingUrlStr =
        redisUrl.replace(/\/\/.*@/, "//health:@").replace(/\/\d+$/, "") +
        "/ping";
      const redis = await pingUrl(pingUrlStr, 3000);
      if (redis) {
        redisStatus = redis.ok ? "ok" : "error";
        redisLatency = redis.latencyMs;
      } else {
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

    const httpStatus = overallStatus === "error" ? 503 : 200;

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
      overallStatus === "error" ? 503 : 200
    );
  } catch {
    return serverError("Health check failed");
  }
}));
