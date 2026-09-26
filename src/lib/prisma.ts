// SPDX-License-Identifier: MIT

import { PrismaClient } from "@prisma/client";
import {
  isTracingEnabled,
  withSpan,
  SpanKind,
  getCurrentRequestId,
  redactTraceAttributes,
} from "@/lib/tracing";

/**
 * Creates a Prisma client with automatic OpenTelemetry tracing for all queries.
 *
 * When tracing is disabled, queries execute with zero overhead via standard Prisma.
 * When tracing is enabled, each database read/write creates a child span
 * (e.g. `prisma.Payment.create`, `prisma.Payment.update`) with model, operation,
 * and the correlating `request.id` attribute.
 */
function createTracedPrismaClient(): PrismaClient {
  const baseClient = new PrismaClient();

  if (typeof (baseClient as unknown as { $extends?: unknown }).$extends === "function") {
    return (baseClient as unknown as {
      $extends: (extension: unknown) => PrismaClient;
    }).$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model: string;
            operation: string;
            args: unknown;
            query: (args: unknown) => Promise<unknown>;
          }) {
            if (!isTracingEnabled()) {
              return query(args);
            }

            const spanName = `prisma.${model}.${operation}`;
            return withSpan(
              spanName,
              async (span) => {
                const reqId = getCurrentRequestId();
                span.setAttributes(
                  redactTraceAttributes({
                    "db.system": "prisma",
                    "db.operation": operation,
                    "db.model": model,
                    "request.id": reqId,
                  })
                );
                return query(args);
              },
              { kind: SpanKind.CLIENT }
            );
          },
        },
      },
    });
  }

  return baseClient;
}

const prismaClientSingleton = () => {
  return createTracedPrismaClient();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;
export { createTracedPrismaClient };

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
