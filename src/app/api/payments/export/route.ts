// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
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
  PAYMENT_EXPORT_COLUMNS,
  paymentToCsvRow,
  buildPaymentExportFilename,
} from "@/lib/payment-export";
import { toCsvString } from "@/lib/export-csv";

/** Number of rows fetched per Prisma cursor batch during streaming CSV export (#1369). */
export const PAYMENT_EXPORT_BATCH_SIZE = 250;

/**
 * Format a batch of mapped payment rows into CSV data lines (without the header).
 */
function formatPaymentBatchToCsvLines(
  rows: ReturnType<typeof paymentToCsvRow>[]
): string {
  if (rows.length === 0) return "";
  const withHeader = toCsvString(rows, PAYMENT_EXPORT_COLUMNS);
  const newlineIndex = withHeader.indexOf("\n");
  if (newlineIndex === -1) return "";
  return withHeader.slice(newlineIndex + 1) + "\n";
}

/**
 * GET /api/payments/export
 *
 * Streaming chunked CSV export of the current filter results (`status` /
 * `search`). Streams the CSV header immediately followed by 250-row cursor
 * batches from Prisma so memory consumption stays constant O(batch_size)
 * regardless of dataset size. Stops querying immediately if the client
 * disconnects or cancels the stream (#1369).
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
    const headerLine =
      PAYMENT_EXPORT_COLUMNS.map((c) => c.header).join(",") + "\n";

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          try {
            fn();
          } catch {
            /* stream already closed or cancelled by consumer */
          }
        };

        controller.enqueue(encoder.encode(headerLine));

        let cursorId: string | undefined;
        let totalExported = 0;

        try {
          while (!cancelled && !request.signal?.aborted && totalExported < MAX_EXPORT_ROWS) {
            const remainingBudget = MAX_EXPORT_ROWS - totalExported;
            const takeCount = Math.min(PAYMENT_EXPORT_BATCH_SIZE, remainingBudget);

            const batch = await prisma.payment.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
              take: takeCount,
            });

            if (cancelled || request.signal?.aborted || batch.length === 0) {
              break;
            }

            const slice = batch.slice(0, takeCount);
            const csvChunk = formatPaymentBatchToCsvLines(
              slice.map(paymentToCsvRow)
            );
            if (csvChunk) {
              controller.enqueue(encoder.encode(csvChunk));
            }

            totalExported += slice.length;
            const nextCursorId = slice[slice.length - 1]?.id;

            // Stop when fewer rows than a full batch were returned or cursor did not advance
            if (
              batch.length < PAYMENT_EXPORT_BATCH_SIZE ||
              !nextCursorId ||
              nextCursorId === cursorId
            ) {
              break;
            }
            cursorId = nextCursorId;
          }

          settle(() => controller.close());
        } catch (err) {
          if (cancelled || request.signal?.aborted) {
            settle(() => controller.close());
            return;
          }
          const failure = err instanceof Error ? err : new Error(String(err));
          logger.error("Payment CSV export failed mid-stream", {
            reason: failure.message,
          });
          settle(() => controller.error(failure));
        } finally {
          request.signal?.removeEventListener("abort", onAbort);
        }
      },
      cancel() {
        cancelled = true;
        request.signal?.removeEventListener("abort", onAbort);
      },
    });

    logger.request("GET", "/api/payments/export", 200, 0);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildPaymentExportFilename()}"`,
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
        "X-Export-Chunk-Size": String(PAYMENT_EXPORT_BATCH_SIZE),
      },
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}

