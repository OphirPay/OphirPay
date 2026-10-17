// SPDX-License-Identifier: MIT
import net from "node:net";
import tls from "node:tls";
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

/** GET a URL and report reachability + latency; null when it errors/times out. */
async function pingUrl(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(headers ? { headers } : {}),
    });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a RESP PING over a raw TCP/TLS socket to a `redis://` or `rediss://` endpoint.
 */
async function pingTcpRedis(
  redisUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    return null;
  }

  const isTls = parsed.protocol === "rediss:";
  const host = parsed.hostname || "127.0.0.1";
  const port = Number(parsed.port || 6379);
  const username = parsed.username ? decodeURIComponent(parsed.username) : "";
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";

  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; latencyMs: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const onConnect = () => {
      const commands: string[] = [];
      if (password) {
        if (username && username !== "default") {
          commands.push(
            `*3\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(username)}\r\n${username}\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`,
          );
        } else {
          commands.push(
            `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`,
          );
        }
      }
      commands.push("*1\r\n$4\r\nPING\r\n");
      socket.write(commands.join(""));
    };

    const socket = isTls
      ? tls.connect({ host, port, servername: host }, onConnect)
      : net.createConnection({ host, port }, onConnect);

    const timer = setTimeout(() => finish(null), timeoutMs);

    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("-ERR") || buffer.includes("-NOAUTH") || buffer.includes("-WRONGPASS")) {
        finish({ ok: false, latencyMs: Date.now() - start });
      } else if (buffer.includes("+PONG")) {
        finish({ ok: true, latencyMs: Date.now() - start });
      }
    });

    socket.on("error", () => finish(null));
    socket.on("close", () => {
      if (!settled) finish(null);
    });
  });
}

/**
 * Ping Redis according to its configured URL scheme (#1338):
 * - `https://` / `http://`: Upstash-compatible REST `/ping` with Bearer token
 * - `redis://` / `rediss://`: RESP `PING` over TCP/TLS socket
 */
export async function pingRedis(
  redisUrl: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  if (/^https?:\/\//i.test(redisUrl)) {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      return null;
    }
    const embeddedToken = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    parsed.username = "";
    parsed.password = "";
    const baseUrl = parsed.toString().replace(/\/+$/, "");
    const token =
      process.env.REDIS_TOKEN ||
      process.env.REDIS_REST_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      embeddedToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return pingUrl(`${baseUrl}/ping`, timeoutMs, headers);
  }

  if (/^rediss?:\/\//i.test(redisUrl)) {
    return pingTcpRedis(redisUrl, timeoutMs);
  }

  return null;
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

    // Check Redis connectivity (if configured)
    let redisStatus: "ok" | "error" | "disabled" = "disabled";
    let redisLatency: number | null = null;
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redis = await pingRedis(redisUrl, 3000);
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
