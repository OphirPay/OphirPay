// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import {
  MAX_EXPORT_ROWS,
  PAYMENT_EXPORT_COLUMNS,
  paymentToCsvRow,
} from "@/lib/payment-export";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const payments = await prisma.payment.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS + 1,
    });

    const truncated = payments.length > MAX_EXPORT_ROWS;
    const records = payments.slice(0, MAX_EXPORT_ROWS);

    logger.request("GET", "/api/donations/export", 200, 0);

    const acceptHeader = request.headers.get("accept") || "";
    if (acceptHeader.includes("application/json")) {
      return NextResponse.json(records, {
        headers: {
          "X-Export-Truncated": truncated ? "true" : "false",
        },
      });
    }

    const rows = records.map(paymentToCsvRow);
    const csv = toCsvString(rows, PAYMENT_EXPORT_COLUMNS);
    const now = new Date();
    const filename = `ophirpay-donations-${now.toISOString().split("T")[0]}.csv`;

    return createCsvResponse(filename, csv, {
      "X-Export-Truncated": truncated ? "true" : "false",
    });
  } catch (err) {
    return handleApiError(err, "GET /api/donations/export");
  }
}
