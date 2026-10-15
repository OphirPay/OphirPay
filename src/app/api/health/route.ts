// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { STELLAR_NETWORK, SOROBAN_RPC_URL, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID } from "@/lib/contracts";
import { successResponse, serverError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import {
  getRpcFailoverState,
  isRpcFailoverDegraded,
  RPC_FAILOVER_DEGRADED_AFTER_MS,
} from "@/lib/rpc-failover";

// ── Check helpers ──────────────────────────────────────────────

type CheckStatus = "ok" | "error" | "unchecked" | "disabled" | "not_configured";

export interface ExternalChecksResult {
  rpcStatus: CheckStatus;
  rpcLatency: number | null;
  horizonStatus: "ok" | "error" | "unchecked";
  horizonLatency: number | null;
  redisStatus: "ok" | "error" | "disabled";
  redisLatency: number | null;
}

interface CachedChecks {
  timestamp: number;
  result: ExternalChecksResult;
}

let checksCache: CachedChecks | null = null;
export const EXTERNAL_CHECKS_TTL_MS = 15_000;

export function resetHealthChecksCache(): void {
  checksCache = null;
}

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

/**
 * Runs optional external checks in parallel with a bounded timeout and
 * caches the result for EXTERNAL_CHECKS_TTL_MS (issue #1337).
 */
export async function getExternalChecks(forceRefresh = false): Promise<ExternalChecksResult> {
  const now = Date.now();
  if (!forceRefresh && checksCache && now - checksCache.timestamp < EXTERNAL_CHECKS_TTL_MS) {
    return checksCache.result;
  }

  const TIMEOUT_MS = 2500;

  const [rpcRes, horizonRes, redisRes] = await Promise.allSettled([
    pingJsonRpc(
      SOROBAN_RPC_URL,
      { jsonrpc: "2.0", id: 1, method: "getHealth" },
      TIMEOUT_MS
    ),
    pingUrl(HORIZON_URL, TIMEOUT_MS),
    (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        return { disabled: true as const };
      }
      const pingUrlStr =
        redisUrl.replace(/\/\/.*@/, "//health:@").replace(/\/\d+$/, "") +
        "/ping";
      const res = await pingUrl(pingUrlStr, TIMEOUT_MS);
      return res
        ? { disabled: false as const, ok: res.ok, latencyMs: res.latencyMs }
        : { disabled: false as const, ok: false, latencyMs: null };
    })(),
  ]);

  let rpcStatus: CheckStatus = "error";
  let rpcLatency: number | null = null;
  if (rpcRes.status === "fulfilled" && rpcRes.value) {
    rpcStatus = rpcRes.value.ok ? "ok" : "error";
    rpcLatency = rpcRes.value.latencyMs;
  }

  let horizonStatus: "ok" | "error" | "unchecked" = "error";
  let horizonLatency: number | null = null;
  if (horizonRes.status === "fulfilled" && horizonRes.value) {
    horizonStatus = horizonRes.value.ok ? "ok" : "error";
    horizonLatency = horizonRes.value.latencyMs;
  }

  let redisStatus: "ok" | "error" | "disabled" = "disabled";
  let redisLatency: number | null = null;
  if (redisRes.status === "fulfilled") {
    if (redisRes.value.disabled) {
      redisStatus = "disabled";
    } else {
      redisStatus = redisRes.value.ok ? "ok" : "error";
      redisLatency = redisRes.value.latencyMs;
    }
  }

  const result: ExternalChecksResult = {
    rpcStatus,
    rpcLatency,
    horizonStatus,
    horizonLatency,
    redisStatus,
    redisLatency,
  };

  checksCache = { timestamp: now, result };
  return result;
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
    } catch (err) {
      console.error("[HealthCheck] Database connection failed:", err);
      dbStatus = "error";
    }

    // Optional external checks run concurrently and are cached (issue #1337)
    const {
      rpcStatus,
      rpcLatency,
      horizonStatus,
      horizonLatency,
      redisStatus,
      redisLatency,
    } = await getExternalChecks();

    // Check Contract-ID presence
    const contractStatus: "ok" | "error" =
      OPHIRPAY_CONTRACT_ID && OPHIRPAY_CONTRACT_ID.startsWith("C") && OPHIRPAY_CONTRACT_ID.length === 56
        ? "ok"
        : "error";

    // ── RPC failover state (issue #820) ─────────────────────
    // Which endpoint is currently serving, whether we are on a fallback,
    // and how many failovers have occurred — the first questions an
    // operator asks during an upstream RPC incident.
    const failover = getRpcFailoverState();
    const failoverDegraded = isRpcFailoverDegraded();

    const optionalChecks = [rpcStatus, horizonStatus, contractStatus, redisStatus].filter(
      (s: string) => s !== "disabled" && s !== "unchecked"
    );
    const hasOptionalError = optionalChecks.includes("error");
    const isDegraded = dbStatus === "ok" && (hasOptionalError || failoverDegraded);
    const overallStatus = dbStatus === "error" ? "error" : isDegraded ? "degraded" : "ok";

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
        rpcFailover: {
          activeEndpoint: failover.activeEndpoint,
          primaryEndpoint: failover.primaryEndpoint,
          usingFallback: failover.usingFallback,
          failoverCount: failover.failoverCount,
          recoveryCount: failover.recoveryCount,
          currentFallbackDurationMs: failover.currentFallbackDurationMs,
          longestFallbackDurationMs: failover.longestFallbackDurationMs,
          lastTransitionAt: failover.lastTransitionAt,
          degradedAfterMs: RPC_FAILOVER_DEGRADED_AFTER_MS,
          degraded: failoverDegraded,
          lastFailureReasons: failover.lastFailureReasons,
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
