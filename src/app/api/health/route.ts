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
import { getAppVersionInfo } from "@/lib/app-version";

// ── Check helpers ──────────────────────────────────────────────

interface ExternalCheckCache {
  rpc: { status: CheckStatus; latencyMs: number | null };
  horizon: { status: "ok" | "error" | "unchecked"; latencyMs: number | null };
  timestamp: number;
}

let externalCache: ExternalCheckCache | null = null;
const EXTERNAL_CACHE_TTL_MS = 15_000;

export function resetHealthCacheForTests(): void {
  externalCache = null;
}

// ── Route handler ──────────────────────────────────────────────

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

export const GET = withMetrics("GET /api/health", withRequestLogging(async function GET(request: Request) {
  try {
    // ── Lightweight RPC-only probe (`?probe=rpc`) ──────────────
    // The UI polls this every few seconds to drive the network status banner.
    // It must not touch the database, Horizon or Redis on every client tick:
    // only the Soroban RPC reachability and the in-process failover snapshot
    // are needed to tell the user which provider is active and how slow it is.
    if (new URL(request.url).searchParams.get("probe") === "rpc") {
      const rpc = await pingJsonRpc(
        SOROBAN_RPC_URL,
        { jsonrpc: "2.0", id: 1, method: "getHealth" },
        5000
      );
      const failover = getRpcFailoverState();
      const rpcStatus: CheckStatus = rpc?.ok ? "ok" : "error";

      return successResponse(
        {
          status: rpcStatus === "ok" ? "ok" : "degraded",
          services: {
            stellar: {
              network: STELLAR_NETWORK,
              rpcUrl: SOROBAN_RPC_URL,
              rpc: { status: rpcStatus, latencyMs: rpc?.latencyMs ?? null },
            },
          },
          rpcFailover: {
            activeEndpoint: failover.activeEndpoint,
            primaryEndpoint: failover.primaryEndpoint,
            activeProviderName: failover.activeProviderName,
            primaryProviderName: failover.primaryProviderName,
            usingFallback: failover.usingFallback,
            failoverCount: failover.failoverCount,
            recoveryCount: failover.recoveryCount,
            currentFallbackDurationMs: failover.currentFallbackDurationMs,
            longestFallbackDurationMs: failover.longestFallbackDurationMs,
            lastTransitionAt: failover.lastTransitionAt,
            degradedAfterMs: RPC_FAILOVER_DEGRADED_AFTER_MS,
            degraded: isRpcFailoverDegraded(),
            lastFailureReasons: failover.lastFailureReasons,
          },
        },
        { timestamp: new Date().toISOString() },
        // A degraded upstream RPC is reported in the body, not as a 5xx: the
        // app itself is healthy and the client wants the latency/provider
        // details in the same shape either way.
        200
      );
    }

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

    // Optional checks: Soroban RPC and Horizon reachability (parallelized & cached, issue #1337)
    let rpcStatus: CheckStatus = "unchecked";
    let rpcLatency: number | null = null;
    let horizonStatus: "ok" | "error" | "unchecked" = "unchecked";
    let horizonLatency: number | null = null;

    const now = Date.now();
    if (externalCache && now - externalCache.timestamp < EXTERNAL_CACHE_TTL_MS) {
      rpcStatus = externalCache.rpc.status;
      rpcLatency = externalCache.rpc.latencyMs;
      horizonStatus = externalCache.horizon.status;
      horizonLatency = externalCache.horizon.latencyMs;
    } else {
      const [rpc, horizon] = await Promise.all([
        pingJsonRpc(
          SOROBAN_RPC_URL,
          { jsonrpc: "2.0", id: 1, method: "getHealth" },
          3000
        ),
        pingUrl(HORIZON_URL, 3000),
      ]);

      if (rpc) {
        rpcStatus = rpc.ok ? "ok" : "error";
        rpcLatency = rpc.latencyMs;
      } else {
        rpcStatus = "error";
      }

      if (horizon) {
        horizonStatus = horizon.ok ? "ok" : "error";
        horizonLatency = horizon.latencyMs;
      } else {
        horizonStatus = "error";
      }

      externalCache = {
        rpc: { status: rpcStatus, latencyMs: rpcLatency },
        horizon: { status: horizonStatus, latencyMs: horizonLatency },
        timestamp: now,
      };
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
    const { version, commit } = getAppVersionInfo();

    return successResponse(
      {
        status: overallStatus,
        version,
        commit,
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
          activeProviderName: failover.activeProviderName,
          primaryProviderName: failover.primaryProviderName,
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
