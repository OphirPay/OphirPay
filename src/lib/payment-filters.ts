// SPDX-License-Identifier: MIT

import type { PaymentStatus, Prisma } from "@prisma/client";

import { buildFallbackWhere } from "@/lib/full-text-search";

/**
 * Filters shared by the payment list route (GET /api/payments) and the
 * server-side CSV export (GET /api/payments/export). Keeping them in one
 * place guarantees "export the current filter results" stays true: if the
 * list route starts filtering differently, the export follows automatically
 * instead of silently diverging.
 */
export interface PaymentFilters {
  status?: string;
  search?: string;
  /** Inclusive start of the range, as a `YYYY-MM-DD` date (UTC). */
  dateFrom?: string;
  /** Inclusive end of the range, as a `YYYY-MM-DD` date (UTC). */
  dateTo?: string;
  /** Asset code filter (e.g. `XLM`). */
  asset?: string;
}

export function buildPaymentWhere(
  userId: string,
  filters: PaymentFilters = {}
): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = { userId };
  if (filters.status) {
    // Prisma only knows the PaymentStatus enum values, so narrow the raw
    // string here. Invalid values surface as a Prisma validation error, the
    // same behavior the list route had before this helper existed.
    where.status = filters.status as PaymentStatus;
  }
  if (filters.dateFrom || filters.dateTo) {
    // The list UI expresses the range as calendar dates. Interpret them in
    // UTC so the export cannot silently shift rows across a day boundary
    // depending on the server's timezone.
    where.createdAt = {
      ...(filters.dateFrom
        ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) }
        : {}),
      ...(filters.dateTo
        ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) }
        : {}),
    };
  }
  if (filters.asset) {
    where.assetCode = filters.asset;
  }
  if (filters.search) {
    // Issue #157 — server-side reconciliation search. The predicates live in
    // `buildFallbackWhere` (src/lib/full-text-search.ts, issue #823) so the
    // Postgres full-text path and this Prisma/SQLite fallback cannot drift:
    //  - `memo` and `description` are substring matches, case-insensitive for
    //    `memo` (the Postgres ILIKE equivalent via Prisma `mode`), because memo
    //    text users type rarely matches on-chain casing;
    //  - `transactionHash` is an EXACT match — hashes are emitted by the network
    //    in a canonical case, and a partial match would produce false positives
    //    across near-identical hashes.
    // On Postgres the generated `searchVector` GIN index (issue #823) serves the
    // ranked query; this `where` is the documented SQLite / local fallback.
    const or = buildFallbackWhere("Payment", filters.search);
    if (or.length > 0) where.OR = or;
  }
  return where;
}
