// SPDX-License-Identifier: MIT

import { Prisma } from "@prisma/client";

/**
 * Configure Prisma client logging for development.
 * Logs queries, warnings, and errors at appropriate levels.
 */
export function getPrismaLogConfig(): Prisma.PrismaClientOptions["log"] {
  if (process.env.NODE_ENV === "production") {
    return [{ level: "error", emit: "stdout" }];
  }

  return [
    { level: "warn", emit: "stdout" },
    { level: "error", emit: "stdout" },
    { level: "query", emit: "event" },
  ];
}

/**
 * Optional: set up a Prisma query event listener for performance monitoring.
 * In development, logs slow queries (>100ms).
 */
export function setupPrismaQueryLogging(prisma: { $on: (event: string, cb: (e: unknown) => void) => void }): void {
  if (process.env.NODE_ENV === "production") return;

  prisma.$on("query" as never, (e: unknown) => {
    const event = e as { query: string; params: string; duration: number };
    if (event.duration > 100) {
      console.warn(`[Prisma] Slow query (${event.duration}ms):`, event.query.slice(0, 200));
    }
  });
}
