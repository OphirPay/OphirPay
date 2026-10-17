// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { paymentExportParamsSchema } from "@/lib/validation-schemas";
import {
  unauthorizedError,
  validationError,
  rateLimitError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  MAX_EXPORT_ROWS,
  PAYMENT_EXPORT_COLUMNS,
  paymentToCsvRow,
  serializePaymentsToJson,
  buildPaymentExportFilename,
} from "@/lib/payment-export";
import {
  toCsvString,
  createCsvResponse,
  createJsonExportResponse,
} from "@/lib/export-csv";
import { getRateLimitStore, getRetryAfterSeconds } from "@/lib/rate-limit";

export const EXPORT_RATE_LIMIT_WINDOW_MS = 60_000;
export const EXPORT_RATE_LIMIT_MAX_REQUESTS = 30;

/**
 * GET /api/payments/export
 *
 * Server-side CSV/JSON export of the CURRENT filter results — every row matching
 * `status` / `search` / `asset` / `dateFrom` / `dateTo`, not just the
 * page loaded in the browser. Returns a dated CSV or JSON attachment that includes
 * all key fields plus fee, memo, and transaction hash.
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const rateLimit = await getRateLimitStore().increment(
      `payments-export:${auth.userId}`,
      EXPORT_RATE_LIMIT_WINDOW_MS,
      EXPORT_RATE_LIMIT_MAX_REQUESTS
    );
    if (!rateLimit.allowed) {
      return rateLimitError(
        "Export rate limit exceeded. Please try again shortly.",
        getRetryAfterSeconds(rateLimit)
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = paymentExportParamsSchema.safeParse({
      // searchParams.get() returns null for absent params, which Zod's
      // .optional() rejects — normalize to undefined first.
      status: searchParams.get("status") ?? undefined,
      search: (searchParams.get("search") ?? searchParams.get("q")) ?? undefined,
      asset: (searchParams.get("asset") ?? searchParams.get("assetCode")) ?? undefined,
      dateFrom: (searchParams.get("dateFrom") ?? searchParams.get("from")) ?? undefined,
      dateTo: (searchParams.get("dateTo") ?? searchParams.get("to")) ?? undefined,
      format: searchParams.get("format") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { status, search, asset, dateFrom, dateTo, format } = parsed.data;

    // Fetch one row past the cap so truncation can be detected without a
    // second count query. The file is materialised as a single string in
    // memory, so the cap bounds memory usage and is never silently applied.
    const payments = await prisma.payment.findMany({
      where: buildPaymentWhere(auth.userId, {
        status,
        search,
        asset,
        dateFrom,
        dateTo,
      }),
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS + 1,
    });

    const truncated = payments.length > MAX_EXPORT_ROWS;
    const sliced = payments.slice(0, MAX_EXPORT_ROWS);
    const extraHeaders = {
      "X-Export-Truncated": truncated ? "true" : "false",
    };

    logger.request("GET", "/api/payments/export", 200, 0);

    if (format === "json") {
      const json = serializePaymentsToJson(sliced);
      return createJsonExportResponse(
        buildPaymentExportFilename(new Date(), "json"),
        json,
        extraHeaders
      );
    }

    const rows = sliced.map(paymentToCsvRow);
    const csv = toCsvString(rows, PAYMENT_EXPORT_COLUMNS);

    return createCsvResponse(
      buildPaymentExportFilename(new Date(), "csv"),
      csv,
      extraHeaders
    );
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}
