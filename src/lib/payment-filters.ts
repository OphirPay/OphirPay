// SPDX-License-Identifier: MIT

/**
 * Shared query construction for the payment list and export endpoints.
 *
 * Both `GET /api/payments` and `GET /api/payments/export` must resolve the same
 * rows for the same filters — otherwise "export the current filter results"
 * silently stops being true the first time one route is edited and the other is
 * not. Keeping the `where` clause and ordering in one place makes that drift a
 * compile-time concern rather than a runtime surprise.
 */

export interface PaymentFilters {
  /** Authenticated user's id. Always applied — never expose other users' data. */
  userId: string;
  /** Exact `PaymentStatus` match. */
  status?: string;
  /** Substring match across description, memo and transaction hash. */
  search?: string;
}

/**
 * Build the Prisma `where` clause for a payment query.
 *
 * Note: soft-deleted rows (`deletedAt != null`) are intentionally NOT excluded
 * here, because the list endpoint does not exclude them either. Filtering them
 * out belongs in a separate change that updates both call sites together.
 */
export function buildPaymentWhere({
  userId,
  status,
  search,
}: PaymentFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { userId };

  if (status) where.status = status;

  if (search) {
    where.OR = [
      { description: { contains: search } },
      { memo: { contains: search } },
      { transactionHash: { contains: search } },
    ];
  }

  return where;
}

/** Ordering shared by the list and export endpoints. */
export const PAYMENT_ORDER_BY = { createdAt: "desc" } as const;
