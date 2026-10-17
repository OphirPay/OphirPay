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
import { getRedisRestConfig } from "@/lib/rate-limit";

// ── Check helpers ──────────────────────────────────────────────

type CheckStatus = "ok" | "error" | "unchecked" | "disabled" | "not_configured";

const TCP_REDIS_URL = /^rediss?:\/\//i;

let sharedTcpClient: {
  status?: string;
  ping: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
} | null = null;
let sharedTcpUrl: string | null = null;

export function resetRedisClientForTests(): void {
  if (sharedTcpClient) {
    try {
      sharedTcpClient.disconnect?.();
    } catch {
      // ignore
    }
    sharedTcpClient = null;
    sharedTcpUrl = null;
  }
}

function parseRestRedisUrl(
  rawUrl: string,
  explicitToken?: string
): { url: string; token?: string } {
  try {
    const parsed = new URL(rawUrl);
    const token =
      explicitToken ||
      (parsed.password ? decodeURIComponent(parsed.password) : undefined);
    parsed.username = "";
    parsed.password = "";
    return { url: parsed.toString().replace(/\/+$/, ""), token };
  } catch {
    return { url: rawUrl.replace(/\/+$/, ""), token: explicitToken };
  }
}

/** Check Upstash / HTTP REST Redis connectivity by issuing PING (#1338). */
async function pingRestRedis(
  rawUrl: string,
  rawToken: string | undefined,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const { url, token } = parseRestRedisUrl(rawUrl, rawToken);
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    // Upstash REST supports GET /ping or POST ["PING"]
    const res = await fetch(`${url}/ping`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true, latencyMs: Date.now() - start };
    }
    const postRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(["PING"]),
      signal: controller.signal,
    });
    return { ok: postRes.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Check TCP Redis connectivity via ioredis on Node runtime by issuing PING (#1338). */
async function pingTcpRedis(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  try {
    if (
      !sharedTcpClient ||
      sharedTcpUrl !== url ||
      (sharedTcpClient.status && sharedTcpClient.status !== "ready")
    ) {
      if (sharedTcpClient) {
        try {
          sharedTcpClient.disconnect?.();
        } catch {
          // ignore
        }
        sharedTcpClient = null;
        sharedTcpUrl = null;
      }

      const mod = await import("ioredis");
      const Redis = mod.Redis ?? mod.default;
      const client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: timeoutMs,
        commandTimeout: timeoutMs,
      });
      client.on?.("error", () => {});
      if (typeof client.connect === "function") {
        await client.connect();
      }
      sharedTcpClient = client;
      sharedTcpUrl = url;
    }

    const pong = await sharedTcpClient.ping();
    const ok = pong === "PONG" || typeof pong === "string";
    return { ok, latencyMs: Date.now() - start };
  } catch {
    if (sharedTcpClient) {
      try {
        sharedTcpClient.disconnect?.();
      } catch {
        // ignore
      }
      sharedTcpClient = null;
      sharedTcpUrl = null;
    }
    return null;
  }
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

    // Check Redis connectivity (if configured) (issue #1338)
    let redisStatus: "ok" | "error" | "disabled" = "disabled";
    let redisLatency: number | null = null;
    const restConfig = getRedisRestConfig();
    const rawRedisUrl = process.env.REDIS_URL;

    if (restConfig) {
      const redis = await pingRestRedis(restConfig.url, restConfig.token, 3000);
      if (redis && redis.ok) {
        redisStatus = "ok";
        redisLatency = redis.latencyMs;
      } else {
        redisStatus = "error";
      }
    } else if (rawRedisUrl && TCP_REDIS_URL.test(rawRedisUrl)) {
      const redis = await pingTcpRedis(rawRedisUrl, 3000);
      if (redis && redis.ok) {
        redisStatus = "ok";
        redisLatency = redis.latencyMs;
      } else {
        redisStatus = "error";
      }
    } else if (rawRedisUrl) {
      redisStatus = "error";
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
