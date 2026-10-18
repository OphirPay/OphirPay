// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";
import { recordDbQueryLatency } from "@/lib/metrics-counters";

export { Prisma };

const prismaClientSingleton = () => {
  return new PrismaClient().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const before = performance.now();
          try {
            const result = await query(args);
            const durationSeconds = (performance.now() - before) / 1000;
            recordDbQueryLatency(model ?? "$raw", operation, durationSeconds);
            return result;
          } catch (err) {
            const durationSeconds = (performance.now() - before) / 1000;
            recordDbQueryLatency(model ?? "$raw", operation, durationSeconds);
            throw err;
          }
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

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

