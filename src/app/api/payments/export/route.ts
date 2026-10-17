// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { paymentExportParamsSchema } from "@/lib/validation-schemas";
import {
  unauthorizedProblem,
  validationProblem,
  handleProblemApiError,
} from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  MAX_EXPORT_ROWS,
  PAYMENT_EXPORT_COLUMNS,
  paymentToCsvRow,
  buildPaymentExportFilename,
} from "@/lib/payment-export";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";

const INSTANCE_PATH = "/api/payments/export";

/**
 * GET /api/payments/export
 *
 * Server-side CSV export of the CURRENT filter results — every row matching
 * `status` / `search` (the same filters as GET /api/payments), not just the
 * page loaded in the browser. Returns a dated CSV attachment that includes
 * all key fields plus memo and transaction hash.
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblem(
        "Authentication required. Connect your wallet or provide an API key.",
        INSTANCE_PATH
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = paymentExportParamsSchema.safeParse({
      // searchParams.get() returns null for absent params, which Zod's
      // .optional() rejects — normalize to undefined first.
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) return validationProblem(parsed.error, INSTANCE_PATH);

    const { status, search } = parsed.data;

    // Fetch one row past the cap so truncation can be detected without a
    // second count query. The file is materialised as a single string in
    // memory, so the cap bounds memory usage and is never silently applied.
    const payments = await prisma.payment.findMany({
      where: buildPaymentWhere(auth.userId, { status, search }),
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS + 1,
    });

    const truncated = payments.length > MAX_EXPORT_ROWS;
    const rows = payments.slice(0, MAX_EXPORT_ROWS).map(paymentToCsvRow);
    const csv = toCsvString(rows, PAYMENT_EXPORT_COLUMNS);

    logger.request("GET", "/api/payments/export", 200, 0);

    return createCsvResponse(buildPaymentExportFilename(), csv, {
      "X-Export-Truncated": truncated ? "true" : "false",
    });
  } catch (err) {
    return handleProblemApiError(err, "GET /api/payments/export", INSTANCE_PATH);
  }
}
