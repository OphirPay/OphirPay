// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import type { Payment } from "@prisma/client";
import { paymentExportParamsSchema } from "@/lib/validation-schemas";
import {
  unauthorizedError,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  MAX_EXPORT_ROWS,
  EXPORT_CHUNK_SIZE,
  PAYMENT_EXPORT_HEADER,
  formatPaymentCsvChunk,
  buildPaymentExportFilename,
} from "@/lib/payment-export";

/**
 * GET /api/payments/export
 *
 * Streaming chunked CSV export of the CURRENT filter results (Issue #1369).
 *
 * Instead of buffering the entire dataset in memory, matching records are
 * fetched in 250-row chunks using Prisma cursor pagination and streamed
 * as a chunked HTTP response (`Transfer-Encoding: chunked`).
 *
 * Handles client disconnects by listening to `request.signal.abort` and
 * terminating the database iteration immediately, preventing memory leaks
 * and unneeded database load.
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
    const parsed = paymentExportParamsSchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { status, search } = parsed.data;
    const where = buildPaymentWhere(auth.userId, { status, search });
    const encoder = new TextEncoder();

    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };
    request.signal.addEventListener("abort", onAbort, { once: true });

    let exportedCount = 0;
    let truncated = false;
    if (typeof prisma.payment.count === "function") {
      const totalCount = await prisma.payment.count({ where });
      if (totalCount > MAX_EXPORT_ROWS) {
        truncated = true;
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let settled = false;
        const settle = (action: () => void) => {
          if (settled) return;
          settled = true;
          try {
            action();
          } catch {
            // Consumer already detached
          }
        };

        try {
          // 1. Enqueue CSV headers
          controller.enqueue(encoder.encode(PAYMENT_EXPORT_HEADER));

          let lastId: string | undefined = undefined;

          // 2. Stream in 250-row chunks
          while (!aborted && !request.signal.aborted) {
            const remaining = MAX_EXPORT_ROWS - exportedCount;
            if (remaining <= 0) break;

            const batchLimit = Math.min(EXPORT_CHUNK_SIZE, remaining);

            const chunk: Payment[] = await prisma.payment.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: batchLimit,
              ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}),
            });

            if (chunk.length === 0) break;

            const chunkCsv = formatPaymentCsvChunk(chunk);
            controller.enqueue(encoder.encode(chunkCsv));

            exportedCount += chunk.length;
            lastId = chunk[chunk.length - 1]!.id;

            if (chunk.length < batchLimit) break;
          }

          logger.request("GET", "/api/payments/export", 200, 0);
          settle(() => controller.close());
        } catch (error) {
          if (aborted || request.signal.aborted) {
            settle(() => controller.close());
            return;
          }
          const failure =
            error instanceof Error ? error : new Error(String(error));
          logger.error("Payment export failed mid-stream", {
            reason: failure.message,
          });
          settle(() => controller.error(failure));
        } finally {
          request.signal.removeEventListener("abort", onAbort);
        }
      },
      cancel() {
        aborted = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildPaymentExportFilename()}"`,
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
        "X-Export-Truncated": truncated ? "true" : "false",
      },
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}
