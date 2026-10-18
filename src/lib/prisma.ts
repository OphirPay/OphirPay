// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";

export { Prisma };

const prismaClientSingleton = () => {
  return new PrismaClient();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Keyset / cursor pagination query parameters for Prisma models (Issue #1361). */
export interface KeysetCursorOptions {
  cursor?: string;
  limit: number;
  order?: "asc" | "desc";
}

/**
 * Builds Prisma cursor arguments for deterministic indexed pagination (Issue #1361).
 */
export function buildPrismaCursorArgs(options: KeysetCursorOptions) {
  const { cursor, limit, order = "desc" } = options;
  return {
    take: limit + 1,
    orderBy: [{ createdAt: order }, { id: order }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

