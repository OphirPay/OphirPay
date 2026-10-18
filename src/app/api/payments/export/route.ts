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
import { toCsvString, createCsvResponse, createJsonResponse } from "@/lib/export-csv";
import { getRateLimitStore, getRetryAfterSeconds } from "@/lib/rate-limit";

/** Rate limit window in ms for payments export (1 minute) */
export const PAYMENT_EXPORT_RATE_LIMIT_WINDOW_MS = 60_000;
/** Maximum export requests allowed per user per window (issue #1296) */
export const PAYMENT_EXPORT_RATE_LIMIT_MAX = 10;

/**
 * GET /api/payments/export
 *
 * Server-side CSV & JSON export of the CURRENT filter results — every row matching
 * `status` / `search` / `asset` / `startDate` / `endDate`, not just the
 * page loaded in the browser. Returns a dated attachment that includes
 * all key fields: timestamp, transaction hash, sender, recipient, asset, amount, fee, memo, status.
 *
 * Enforces authentication and rate limits (issue #1296).
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    // Rate limit check: enforce per-user quota (issue #1296)
    const rateLimitStore = getRateLimitStore();
    const rateLimit = await rateLimitStore.increment(
      `rate_limit:payments_export:${auth.userId}`,
      PAYMENT_EXPORT_RATE_LIMIT_WINDOW_MS,
      PAYMENT_EXPORT_RATE_LIMIT_MAX
    );
    if (!rateLimit.allowed) {
      const retryAfter = getRetryAfterSeconds(rateLimit);
      return rateLimitError(
        "Export rate limit exceeded. Please wait before exporting again.",
        retryAfter
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = paymentExportParamsSchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      format: searchParams.get("format") ?? undefined,
      asset: searchParams.get("asset") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { status, search, format = "csv", asset, startDate, endDate } = parsed.data;

    // Fetch one row past the cap so truncation can be detected without a
    // second count query. The file is materialised as a single string in
    // memory, so the cap bounds memory usage and is never silently applied.
    const payments = await prisma.payment.findMany({
      where: buildPaymentWhere(auth.userId, { status, search, asset, startDate, endDate }),
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS + 1,
    });

    const truncated = payments.length > MAX_EXPORT_ROWS;
    const rows = payments.slice(0, MAX_EXPORT_ROWS).map(paymentToCsvRow);

    logger.request("GET", "/api/payments/export", 200, 0);

    const extraHeaders: Record<string, string> = {
      "X-Export-Truncated": truncated ? "true" : "false",
      "X-RateLimit-Limit": String(PAYMENT_EXPORT_RATE_LIMIT_MAX),
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(rateLimit.resetAt),
    };

    if (format === "json") {
      const jsonOutput = serializePaymentsToJson(rows);
      return createJsonResponse(buildPaymentExportFilename("json"), jsonOutput, extraHeaders);
    }

    const csv = toCsvString(rows, PAYMENT_EXPORT_COLUMNS);
    return createCsvResponse(buildPaymentExportFilename("csv"), csv, extraHeaders);
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}
