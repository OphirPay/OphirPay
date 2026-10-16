// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";

export { Prisma };

export const CONNECTION_WAIT_WARN_THRESHOLD_MS = 500;

export interface ConnectionWaitContext {
  model?: string;
  operation?: string;
  action?: string;
  [key: string]: unknown;
}

/**
 * Log structured warning if database connection acquisition or query wait duration
 * exceeds the warning threshold (500ms).
 */
export function logSlowConnectionWait(durationMs: number, context?: ConnectionWaitContext): void {
  if (durationMs > CONNECTION_WAIT_WARN_THRESHOLD_MS) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "database_slow_connection_wait",
        message: `Database connection acquisition wait time of ${durationMs}ms exceeded threshold of ${CONNECTION_WAIT_WARN_THRESHOLD_MS}ms`,
        durationMs,
        thresholdMs: CONNECTION_WAIT_WARN_THRESHOLD_MS,
        context: context ?? {},
        timestamp: new Date().toISOString(),
      })
    );
  }
}

export { getPrismaMetrics } from "./prisma-metrics";

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = Date.now();
          try {
            return await query(args);
          } finally {
            const duration = Date.now() - start;
            if (duration > CONNECTION_WAIT_WARN_THRESHOLD_MS) {
              logSlowConnectionWait(duration, { model, operation });
            }
          }
        },
      },
    },
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof prismaClientSingleton> | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

