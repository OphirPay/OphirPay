// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { donationExportParamsSchema } from "@/lib/validation-schemas";
import {
  unauthorizedError,
  validationError,
  successResponse,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";
import {
  MAX_DONATION_EXPORT_ROWS,
  DONATION_EXPORT_COLUMNS,
  donationToExportRow,
  buildDonationExportFilename,
} from "@/lib/donation-export";

/**
 * GET /api/donations/export
 *
 * Donor history export (issue #571) — returns the CALLING donor's own
 * donations (the payments they sent) for tax/finance record keeping. CSV
 * attachment by default; JSON via `?format=json` or
 * `Accept: application/json`.
 *
 * Scoping: the query is hard-bound to the authenticated user's id. There is
 * no parameter that selects a donor, so one donor can never retrieve
 * another donor's history.
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
    const parsed = donationExportParamsSchema.safeParse({
      // searchParams.get() returns null for absent params, which Zod's
      // .optional() rejects — normalize to undefined first.
      format: searchParams.get("format") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    // Explicit `?format=` wins; without it, negotiate on the Accept header.
    // CSV stays the default so a plain browser link downloads a file.
    const wantsJson =
      parsed.data.format === "json" ||
      (parsed.data.format === undefined &&
        (request.headers.get("accept") ?? "").includes("application/json"));

    // Soft-deleted rows are hidden (issue #50). Fetch one row past the cap
    // so truncation can be detected without a second count query — the same
    // pattern as GET /api/payments/export.
    const donations = await prisma.payment.findMany({
      where: { userId: auth.userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MAX_DONATION_EXPORT_ROWS + 1,
    });

    const truncated = donations.length > MAX_DONATION_EXPORT_ROWS;
    const rows = donations
      .slice(0, MAX_DONATION_EXPORT_ROWS)
      .map(donationToExportRow);

    logger.request("GET", "/api/donations/export", 200, 0);

    if (wantsJson) {
      return successResponse(rows, { total: rows.length });
    }

    const csv = toCsvString(rows, DONATION_EXPORT_COLUMNS);
    return createCsvResponse(buildDonationExportFilename(), csv, {
      "X-Export-Truncated": truncated ? "true" : "false",
    });
  } catch (err) {
    return handleApiError(err, "GET /api/donations/export");
  }
}
