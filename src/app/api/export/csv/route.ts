// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import prisma from "@/lib/prisma";
import { problemUnauthorized, problemFromError } from "@/lib/api-errors";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentCsv, createCsvResponse, type PaymentRecord } from "@/lib/export-csv";

/**
 * GET /api/export/csv
 *
 * Export user payment roster to sanitized CSV (issue #1959).
 * Formula injection characters (=, +, -, @) are sanitized with a leading quote.
 */
export const GET = withMetrics(
  "GET /api/export/csv",
  withRequestLogging(async function GET(request: Request) {
    const instance = new URL(request.url).pathname;
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return problemUnauthorized(undefined, { instance });
      }

      const payments = await prisma.payment.findMany({
        where: { userId: auth.userId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      const records: PaymentRecord[] = payments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        currency: p.assetCode,
        status: p.status,
        created_at: p.createdAt.toISOString(),
        memo: p.memo,
        tx_hash: p.transactionHash,
      }));

      const csvContent = buildPaymentCsv(records);
      return createCsvResponse("export.csv", csvContent);
    } catch (err) {
      return problemFromError(err, instance);
    }
  })
);
