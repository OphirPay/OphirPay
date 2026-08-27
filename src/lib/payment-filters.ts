// SPDX-License-Identifier: MIT

import type { PaymentStatus, Prisma } from "@prisma/client";

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
  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search } },
      { memo: { contains: filters.search } },
      { transactionHash: { contains: filters.search } },
    ];
  }
  return where;
}
