// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { exportFiltersSchema } from "@/lib/validation-schemas";
import {
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere, PAYMENT_ORDER_BY } from "@/lib/payment-filters";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";
import {
  MAX_EXPORT_ROWS,
  exportColumnSpec,
  exportFilename,
  toExportRow,
} from "@/lib/payment-export";

/**
 * GET /api/payments/export
 *
 * Streams the caller's payments as CSV. Accepts the same `status` and `search`
 * filters as `GET /api/payments` and resolves them through the same
 * `buildPaymentWhere` helper, so the export always matches the list for a given
 * filter combination — including rows beyond the page the user is looking at.
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = exportFiltersSchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsed.success) return validationError(parsed.error);

    const { status, search } = parsed.data;
    const where = buildPaymentWhere({ userId: auth.userId, status, search });

    // Fetch one extra row to detect truncation without a second count query.
    const payments = await prisma.payment.findMany({
      where,
      orderBy: PAYMENT_ORDER_BY,
      take: MAX_EXPORT_ROWS + 1,
    });

    const truncated = payments.length > MAX_EXPORT_ROWS;
    const rows = truncated ? payments.slice(0, MAX_EXPORT_ROWS) : payments;

    const csv = toCsvString(
      rows.map((p: Record<string, unknown>) => toExportRow(p)),
      exportColumnSpec()
    );

    logger.request("GET", "/api/payments/export", 200, 0);

    return createCsvResponse(exportFilename(), csv, {
      "X-Export-Row-Count": String(rows.length),
      "X-Export-Truncated": String(truncated),
      "Cache-Control": "no-store",
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}
