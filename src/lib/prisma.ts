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

export interface AuditLogCursorPaginationOptions {
  cursor?: string;
  page?: number;
  limit: number;
  order: "asc" | "desc";
  where?: Record<string, unknown>;
}

/**
 * Builds Prisma `findMany` arguments for cursor-based or offset-based
 * pagination over `AuditLog` using the indexed `(createdAt, id)` composite key.
 * Requests `limit + 1` records so the caller can determine `hasMore` and
 * `nextCursor` in a single indexed lookup without `OFFSET` drift.
 */
export function buildAuditLogCursorArgs(options: AuditLogCursorPaginationOptions) {
  const { cursor, page = 1, limit, order, where = {} } = options;
  const orderBy: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }> = [
    { createdAt: order },
    { id: order },
  ];

  if (cursor) {
    return {
      where,
      orderBy,
      cursor: { id: cursor },
      skip: 1,
      take: limit + 1,
    };
  }

  return {
    where,
    orderBy,
    skip: (page - 1) * limit,
    take: limit + 1,
  };
}
