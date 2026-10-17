// SPDX-License-Identifier: MIT

import { PrismaClient } from "@prisma/client";

const prismaClientSingleton = () => {
  return new PrismaClient();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

import { recordDbQueryLatency } from "@/lib/metrics-counters";

export interface PrismaMiddlewareParams {
  model?: string;
  action: string;
  args?: unknown;
  dataPath?: string[];
  runInTransaction?: boolean;
}

/**
 * Prisma middleware that records query duration by model and operation in the
 * Prometheus database latency histogram (issue #1304).
 */
export function createPrismaMetricsMiddleware() {
  return async function prismaMetricsMiddleware<T>(
    params: PrismaMiddlewareParams,
    next: (params: PrismaMiddlewareParams) => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await next(params);
    } finally {
      const durationSeconds = (performance.now() - startedAt) / 1000;
      recordDbQueryLatency(params.model ?? "raw", params.action, durationSeconds);
    }
  };
}

const prismaClientSingleton = () => {
  const client = new PrismaClient();
  if (typeof (client as unknown as { $use?: unknown }).$use === "function") {
    (client as unknown as { $use: (fn: ReturnType<typeof createPrismaMetricsMiddleware>) => void }).$use(
      createPrismaMetricsMiddleware()
    );
  }
  return client;
};


const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
