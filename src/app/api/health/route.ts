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

/**
 * Per-dependency timeout budget (ms). Must stay strictly smaller than
 * Kubernetes `readinessProbe.timeoutSeconds` (5s) so a slow upstream never
 * causes kubelet to abort the probe before `/api/health` responds (#1337).
 */
export const HEALTH_DEPENDENCY_TIMEOUT_MS = 2_000;

interface CachedExternalChecks {
  expiresAt: number;
  rpcStatus: CheckStatus;
  rpcLatency: number | null;
  horizonStatus: "ok" | "error" | "unchecked";
  horizonLatency: number | null;
}

let cachedExternalChecks: CachedExternalChecks | null = null;

export function clearHealthCheckCache(): void {
  cachedExternalChecks = null;
}

function getExternalCacheTtlMs(): number {
  if (process.env.HEALTH_CACHE_TTL_MS !== undefined) {
    const parsed = Number(process.env.HEALTH_CACHE_TTL_MS);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return process.env.NODE_ENV === "test" ? 0 : 15_000;
}

/** GET a URL and report reachability + latency; null when it errors/times out. */
async function pingUrl(
  url: string,
  timeoutMs: number = HEALTH_DEPENDENCY_TIMEOUT_MS,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      fetch(url, {
        signal: controller.signal,
        ...(headers ? { headers } : {}),
      }),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    if (!res) return null;
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** POST a JSON-RPC body and report reachability + latency; null on failure. */
async function pingJsonRpc(
  url: string,
  body: unknown,
  timeoutMs: number = HEALTH_DEPENDENCY_TIMEOUT_MS,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    if (!res) return null;
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const GET = withMetrics("GET /api/health", withRequestLogging(async function GET() {
  try {
    const dbCheckPromise = (async (): Promise<{
      status: "ok" | "error";
      latencyMs: number | null;
    }> => {
      try {
        const start = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        return { status: "ok", latencyMs: Date.now() - start };
      } catch (err) {
        console.error("[HealthCheck] Database connection failed:", err);
        return { status: "error", latencyMs: null };
      }
    })();

    const externalCheckPromise = (async (): Promise<
      Omit<CachedExternalChecks, "expiresAt">
    > => {
      const ttlMs = getExternalCacheTtlMs();
      const now = Date.now();
      if (ttlMs > 0 && cachedExternalChecks && cachedExternalChecks.expiresAt > now) {
        return {
          rpcStatus: cachedExternalChecks.rpcStatus,
          rpcLatency: cachedExternalChecks.rpcLatency,
          horizonStatus: cachedExternalChecks.horizonStatus,
          horizonLatency: cachedExternalChecks.horizonLatency,
        };
      }

      const [rpc, horizon] = await Promise.all([
        pingJsonRpc(
          SOROBAN_RPC_URL,
          { jsonrpc: "2.0", id: 1, method: "getHealth" },
          HEALTH_DEPENDENCY_TIMEOUT_MS,
        ),
        pingUrl(HORIZON_URL, HEALTH_DEPENDENCY_TIMEOUT_MS),
      ]);

      const result = {
        rpcStatus: (rpc ? (rpc.ok ? "ok" : "error") : "error") as CheckStatus,
        rpcLatency: rpc ? rpc.latencyMs : null,
        horizonStatus: (horizon ? (horizon.ok ? "ok" : "error") : "error") as
          | "ok"
          | "error"
          | "unchecked",
        horizonLatency: horizon ? horizon.latencyMs : null,
      };

      if (ttlMs > 0) {
        cachedExternalChecks = {
          ...result,
          expiresAt: Date.now() + ttlMs,
        };
      }
      return result;
    })();

    const redisCheckPromise = (async (): Promise<{
      status: "ok" | "error" | "disabled";
      latencyMs: number | null;
    }> => {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        return { status: "disabled", latencyMs: null };
      }
      const pingUrlStr =
        redisUrl.replace(/\/\/.*@/, "//health:@").replace(/\/\d+$/, "") +
        "/ping";
      const redis = await pingUrl(pingUrlStr, HEALTH_DEPENDENCY_TIMEOUT_MS);
      if (redis) {
        return { status: redis.ok ? "ok" : "error", latencyMs: redis.latencyMs };
      }
      return { status: "error", latencyMs: null };
    })();

    const [dbCheck, externalCheck, redisCheck] = await Promise.all([
      dbCheckPromise,
      externalCheckPromise,
      redisCheckPromise,
    ]);

    const dbStatus = dbCheck.status;
    const dbLatency = dbCheck.latencyMs;
    const rpcStatus = externalCheck.rpcStatus;
    const rpcLatency = externalCheck.rpcLatency;
    const horizonStatus = externalCheck.horizonStatus;
    const horizonLatency = externalCheck.horizonLatency;
    const redisStatus = redisCheck.status;
    const redisLatency = redisCheck.latencyMs;

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
