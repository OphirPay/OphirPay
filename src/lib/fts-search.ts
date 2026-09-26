// SPDX-License-Identifier: MIT

/**
 * Ranked full-text search over GIN-indexed tsvector columns (issue #823).
 *
 * PostgreSQL path: exact transaction-hash matches first, then ts_rank
 * relevance. SQLite development path has no tsvector support, so callers
 * must fall back to the existing LIKE-based search when this module reports
 * the FTS path unavailable. API response contracts are unchanged — only the
 * ordering and the index behind it change.
 */

import prisma from "@/lib/prisma";
import type { Prisma, Payment } from "@prisma/client";
import { getDatabaseProvider } from "@/lib/env";

/** True only on PostgreSQL, where the search_vector migration applies. */
export function isFtsAvailable(): boolean {
  return getDatabaseProvider() === "postgresql";
}

export interface RankedId {
  id: string;
  rank: number;
}

/**
 * Ranked Payment ids for a user query. Exact transaction-hash matches rank
 * first (hashes are canonical; partial matches are false positives), then
 * ts_rank over memo/description/hash. Bounded to keep in-memory pagination
 * cheap for callers.
 */
export async function searchPaymentIds(
  userId: string,
  query: string,
  limit = 500,
): Promise<RankedId[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT id,
      CASE WHEN "transactionHash" = ${query} THEN 1e9 ELSE 0 END
      + ts_rank("search_vector", plainto_tsquery('english', ${query})) AS rank
    FROM "Payment"
    WHERE "userId" = ${userId}
      AND (
        "search_vector" @@ plainto_tsquery('english', ${query})
        OR "transactionHash" = ${query}
      )
    ORDER BY rank DESC, "createdAt" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: r.id, rank: Number(r.rank) }));
}

/**
 * Ranked Payment rows for a search query. Applies the caller's baseWhere
 * (status, soft-delete, user scope) on top of the FTS id set and returns
 * rows in rank order with offset pagination applied. Shape-agnostic: the
 * route builds its usual response meta around the result.
 */
export async function searchPaymentsRanked(
  userId: string,
  query: string,
  baseWhere: Prisma.PaymentWhereInput,
  opts: { page?: number | null; limit: number },
): Promise<{ rows: Payment[]; total: number; hasMore: boolean }> {
  const ranked = await searchPaymentIds(userId, query);
  if (ranked.length === 0) return { rows: [], total: 0, hasMore: false };
  const order = new Map(ranked.map((r, i) => [r.id, i]));
  const rows = await prisma.payment.findMany({
    where: { ...baseWhere, id: { in: ranked.map((r) => r.id) } },
  });
  rows.sort(
    (a, b) => (order.get(a.id) ?? ranked.length) - (order.get(b.id) ?? ranked.length),
  );
  const page = opts.page ?? 1;
  const start = (page - 1) * opts.limit;
  const visible = rows.slice(start, start + opts.limit);
  return { rows: visible, total: rows.length, hasMore: start + opts.limit < rows.length };
}

/**
 * Ranked AuditLog ids for free-text queries over action/actor/details.
 * Exact action matches rank first for stable admin filtering.
 */
export async function searchAuditLogIds(
  query: string,
  limit = 500,
): Promise<RankedId[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT id,
      CASE WHEN "action" = ${query} THEN 1e9 ELSE 0 END
      + ts_rank("search_vector", plainto_tsquery('english', ${query})) AS rank
    FROM "AuditLog"
    WHERE "search_vector" @@ plainto_tsquery('english', ${query})
       OR "action" = ${query}
    ORDER BY rank DESC, "createdAt" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: r.id, rank: Number(r.rank) }));
}
