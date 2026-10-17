// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { observeDbQuery } from "@/lib/metrics-counters";

export { Prisma };

/**
 * Threshold in milliseconds above which database connection pool acquisition /
 * query wait logs a structured warning (#1371).
 */
export const DB_POOL_WAIT_WARN_THRESHOLD_MS = 500;

/** Default Prisma connection pool size when `connection_limit` is not in `DATABASE_URL`. */
export const DEFAULT_DB_POOL_SIZE = 10;

export interface DbPoolMetricsSnapshot {
  busy: number;
  idle: number;
  waitDurationMs: number;
  maxWaitDurationMs: number;
  slowAcquireCount: number;
  poolSize: number;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  __ophirpayDbPoolMetrics?: DbPoolMetricsSnapshot;
};

function resolveConfiguredPoolSize(url = process.env.DATABASE_URL): number {
  if (!url) return DEFAULT_DB_POOL_SIZE;
  try {
    const parsed = new URL(url);
    const limit = Number(parsed.searchParams.get("connection_limit"));
    if (Number.isInteger(limit) && limit > 0) {
      return limit;
    }
  } catch {
    // Ignore malformed URLs and fall back to default pool size
  }
  return DEFAULT_DB_POOL_SIZE;
}

function createInitialPoolState(): DbPoolMetricsSnapshot {
  const poolSize = resolveConfiguredPoolSize();
  return {
    busy: 0,
    idle: poolSize,
    waitDurationMs: 0,
    maxWaitDurationMs: 0,
    slowAcquireCount: 0,
    poolSize,
  };
}

function getPoolState(): DbPoolMetricsSnapshot {
  if (!globalForPrisma.__ophirpayDbPoolMetrics) {
    globalForPrisma.__ophirpayDbPoolMetrics = createInitialPoolState();
  }
  return globalForPrisma.__ophirpayDbPoolMetrics;
}

/**
 * Read a snapshot of the current database connection pool metrics (#1371).
 */
export function getDbPoolMetricsSnapshot(): DbPoolMetricsSnapshot {
  return { ...getPoolState() };
}

/**
 * Override connection pool metric values (used by tests or external collectors).
 */
export function setDbPoolMetrics(partial: Partial<DbPoolMetricsSnapshot>): void {
  const state = getPoolState();
  Object.assign(state, partial);
  if (partial.busy !== undefined && partial.idle === undefined) {
    state.idle = Math.max(0, state.poolSize - state.busy);
  }
}

/**
 * Reset database connection pool metrics to their initial state.
 */
export function resetDbPoolMetrics(): void {
  globalForPrisma.__ophirpayDbPoolMetrics = createInitialPoolState();
}

/**
 * Record a connection pool acquisition / wait duration in milliseconds and emit
 * a structured warning log when it exceeds `DB_POOL_WAIT_WARN_THRESHOLD_MS` (500ms, #1371).
 */
export function recordDbPoolAcquisition(
  waitDurationMs: number,
  context?: { model?: string; action?: string }
): void {
  const state = getPoolState();
  const normalizedWait = Math.max(0, Math.round(waitDurationMs * 1000) / 1000);
  state.waitDurationMs = normalizedWait;
  if (normalizedWait > state.maxWaitDurationMs) {
    state.maxWaitDurationMs = normalizedWait;
  }

  if (normalizedWait > DB_POOL_WAIT_WARN_THRESHOLD_MS) {
    state.slowAcquireCount += 1;
    logger.warn("Database connection pool acquisition wait exceeded 500ms", {
      waitDurationMs: normalizedWait,
      thresholdMs: DB_POOL_WAIT_WARN_THRESHOLD_MS,
      busyConnections: state.busy,
      idleConnections: state.idle,
      poolSize: state.poolSize,
      ...(context?.model ? { model: context.model } : {}),
      ...(context?.action ? { action: context.action } : {}),
    });
  }
}

/**
 * Parse Prometheus exposition output from `prisma.$metrics.prometheus()` (when
 * available) to extract `prisma_pool_connections_busy`,
 * `prisma_pool_connections_idle`, and `prisma_pool_wait_duration_ms`.
 */
export function parsePrismaPrometheusMetrics(
  prometheusText: string,
  fallback: DbPoolMetricsSnapshot = getDbPoolMetricsSnapshot()
): DbPoolMetricsSnapshot {
  const result: DbPoolMetricsSnapshot = { ...fallback };

  const busyMatch = /^prisma_pool_connections_busy(?:\{[^}]*\})?\s+([0-9.]+)/m.exec(
    prometheusText
  );
  if (busyMatch) {
    result.busy = Number(busyMatch[1]);
  }

  const idleMatch = /^prisma_pool_connections_idle(?:\{[^}]*\})?\s+([0-9.]+)/m.exec(
    prometheusText
  );
  if (idleMatch) {
    result.idle = Number(idleMatch[1]);
  }

  const waitMatch =
    /^prisma_pool_wait_duration_ms(?:_sum)?(?:\{[^}]*\})?\s+([0-9.]+)/m.exec(
      prometheusText
    ) ??
    /^prisma_client_queries_wait_histogram_ms_sum(?:\{[^}]*\})?\s+([0-9.]+)/m.exec(
      prometheusText
    );
  if (waitMatch) {
    result.waitDurationMs = Number(waitMatch[1]);
  }

  return result;
}

/**
 * Collect connection pool metrics from Prisma (`$metrics.prometheus()` when
 * supported by the client, combined with in-process pool telemetry).
 */
export async function collectPrismaPoolMetrics(
  client: unknown = prisma
): Promise<DbPoolMetricsSnapshot> {
  const snapshot = getDbPoolMetricsSnapshot();
  const maybeMetrics = (
    client as {
      $metrics?: {
        prometheus?: () => Promise<string>;
      };
    } | null
  )?.$metrics;

  if (maybeMetrics && typeof maybeMetrics.prometheus === "function") {
    try {
      const raw = await maybeMetrics.prometheus();
      if (typeof raw === "string" && raw.length > 0) {
        const parsed = parsePrismaPrometheusMetrics(raw, snapshot);
        if (parsed.waitDurationMs > DB_POOL_WAIT_WARN_THRESHOLD_MS) {
          recordDbPoolAcquisition(parsed.waitDurationMs, {
            action: "$metrics.prometheus",
          });
        }
        return parsed;
      }
    } catch (err) {
      logger.warn("Failed to collect Prisma $metrics.prometheus(); using fallback pool snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return snapshot;
}

const prismaClientSingleton = () => {
  const client = new PrismaClient();
  const maybeUse = (
    client as unknown as {
      $use?: (
        middleware: (
          params: { model?: string; action?: string },
          next: (params: unknown) => Promise<unknown>
        ) => Promise<unknown>
      ) => void;
    }
  ).$use;

  if (typeof maybeUse === "function") {
    maybeUse.call(client, async (params, next) => {
      const state = getPoolState();
      state.busy += 1;
      state.idle = Math.max(0, state.poolSize - state.busy);
      const startedAt = performance.now();
      try {
        return await next(params);
      } finally {
        const durationMs = performance.now() - startedAt;
        state.busy = Math.max(0, state.busy - 1);
        state.idle = Math.max(0, state.poolSize - state.busy);
        observeDbQuery(durationMs / 1000);
        recordDbPoolAcquisition(durationMs, {
          model: params?.model,
          action: params?.action,
        });
      }
    });
  }

  return client;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
