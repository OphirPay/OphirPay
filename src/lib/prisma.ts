// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "./logger";

export { Prisma };

/** Default threshold for alerting on slow database connection acquisition / query wait */
export const CONNECTION_WAIT_THRESHOLD_MS = 500;

/**
 * Check a connection wait duration against the threshold and emit a structured warning log
 * if the wait time exceeded the threshold.
 */
export function checkConnectionAcquisitionWait(
  waitDurationMs: number,
  thresholdMs: number = CONNECTION_WAIT_THRESHOLD_MS,
  context?: Record<string, unknown>
): boolean {
  if (waitDurationMs > thresholdMs) {
    logger.warn(`[Prisma] Database connection acquisition wait exceeded ${thresholdMs}ms`, {
      waitDurationMs,
      thresholdMs,
      ...context,
    });
    return true;
  }
  return false;
}

const prismaClientSingleton = () => {
  const client = new PrismaClient();

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          const result = await query(args);
          const durationMs = performance.now() - start;

          if (durationMs > CONNECTION_WAIT_THRESHOLD_MS) {
            checkConnectionAcquisitionWait(durationMs, CONNECTION_WAIT_THRESHOLD_MS, {
              model,
              operation,
            });
          }

          return result;
        },
      },
    },
  });
};

type ExtendedPrismaClient = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const DEFAULT_FALLBACK_POOL_METRICS = [
  "# HELP prisma_pool_connections_busy Number of currently used database connections",
  "# TYPE prisma_pool_connections_busy gauge",
  "prisma_pool_connections_busy 0",
  "",
  "# HELP prisma_pool_connections_idle Number of currently unused database connections",
  "# TYPE prisma_pool_connections_idle gauge",
  "prisma_pool_connections_idle 0",
  "",
  "# HELP prisma_pool_wait_duration_ms Time in milliseconds spent waiting for a database connection",
  "# TYPE prisma_pool_wait_duration_ms histogram",
  'prisma_pool_wait_duration_ms_bucket{le="0"} 0',
  'prisma_pool_wait_duration_ms_bucket{le="500"} 0',
  'prisma_pool_wait_duration_ms_bucket{le="+Inf"} 0',
  "prisma_pool_wait_duration_ms_sum 0",
  "prisma_pool_wait_duration_ms_count 0",
].join("\n");

/**
 * Inspect Prisma connection pool metrics and Prometheus exposition text.
 * Triggers structured warnings if any pool wait duration exceeds threshold.
 */
export async function getPrismaPoolMetrics(
  thresholdMs: number = CONNECTION_WAIT_THRESHOLD_MS
): Promise<string> {
  try {
    const rawClient = prisma as unknown as {
      $metrics?: {
        prometheus: () => Promise<string>;
        json: () => Promise<{
          histograms?: Array<{
            key: string;
            value?: { max?: number; buckets?: [number, number][] };
          }>;
          gauges?: Array<{ key: string; value: number }>;
          counters?: Array<{ key: string; value: number }>;
        }>;
      };
    };

    if (typeof rawClient.$metrics?.prometheus === "function") {
      const prometheusOutput = await rawClient.$metrics.prometheus();

      // Inspect json metrics for wait duration alerts
      if (typeof rawClient.$metrics?.json === "function") {
        try {
          const jsonMetrics = await rawClient.$metrics.json();
          const waitHistogram = jsonMetrics.histograms?.find(
            (h) => h.key === "prisma_pool_wait_duration_ms"
          );
          if (waitHistogram?.value?.max !== undefined) {
            checkConnectionAcquisitionWait(waitHistogram.value.max, thresholdMs, {
              metric: "prisma_pool_wait_duration_ms",
            });
          }
        } catch {
          // Non-blocking json inspection
        }
      }

      if (prometheusOutput && prometheusOutput.trim().length > 0) {
        return prometheusOutput;
      }
    }
  } catch (error) {
    logger.debug("Prisma metrics collection unavailable or failed, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return DEFAULT_FALLBACK_POOL_METRICS;
}


