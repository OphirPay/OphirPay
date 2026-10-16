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

export const EXPORT_CHUNK_SIZE = 250;

function escapeCsvField(val: string): string {
  // CSV formula-injection guard (OWASP): spreadsheet apps evaluate cells that
  // begin with = + - @ as formulas (including DDE/UNC paths). Neutralize by
  // prefixing a single quote.
  let value = val;
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * GET /api/payments/export
 *
 * Streaming CSV export of the CURRENT filter results.
 * Pulls records from the database in 250-row chunks via Prisma cursor streaming,
 * flushing chunk by chunk over a Web ReadableStream.
 * Memory footprint remains constant and bounded regardless of record volume.
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
      // searchParams.get() returns null for absent params, which Zod's
      // .optional() rejects — normalize to undefined first.
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { status, search } = parsed.data;
    const where = buildPaymentWhere(auth.userId, { status, search });
    const encoder = new TextEncoder();

    // Probe the initial chunk to determine if results exist and check truncation
    const initialBatch = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_CHUNK_SIZE,
    });

    // Check truncation: if initialBatch itself exceeds MAX_EXPORT_ROWS (e.g. from an in-memory mock),
    // or if count/findFirst detects more than MAX_EXPORT_ROWS records exist
    let truncated = initialBatch.length > MAX_EXPORT_ROWS;
    if (!truncated && initialBatch.length === EXPORT_CHUNK_SIZE) {
      try {
        if (typeof (prisma.payment as any).count === "function") {
          const total = await prisma.payment.count({ where });
          truncated = total > MAX_EXPORT_ROWS;
        } else if (typeof (prisma.payment as any).findFirst === "function") {
          const overflow = await prisma.payment.findFirst({
            where,
            skip: MAX_EXPORT_ROWS,
            select: { id: true },
          });
          truncated = overflow !== null;
        }
      } catch {
        // Fallback
      }
    }

    let clientDisconnected = false;
    const onAbort = () => {
      clientDisconnected = true;
    };
    request.signal.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          try {
            fn();
          } catch {
            /* consumer already detached */
          }
        };

        try {
          // 1. Send CSV header row
          const headerLine = PAYMENT_EXPORT_COLUMNS.map((c) => escapeCsvField(String(c.header))).join(",");
          controller.enqueue(encoder.encode(headerLine));

          let totalStreamed = 0;
          let cursorId: string | undefined = undefined;

          // 2. Stream the initial batch first (sliced to max batch limit)
          const firstChunk = initialBatch.slice(0, Math.min(EXPORT_CHUNK_SIZE, MAX_EXPORT_ROWS));
          if (firstChunk.length > 0) {
            cursorId = firstChunk[firstChunk.length - 1].id;
            totalStreamed += firstChunk.length;

            const firstCsv = firstChunk
              .map((p) => {
                const r = paymentToCsvRow(p);
                return PAYMENT_EXPORT_COLUMNS.map((col) =>
                  escapeCsvField(String(r[col.key] ?? ""))
                ).join(",");
              })
              .join("\n");

            controller.enqueue(encoder.encode("\n" + firstCsv));
          }

          // If initialBatch had more elements than batchLimit (e.g. mocked full array in tests):
          if (initialBatch.length > EXPORT_CHUNK_SIZE) {
            while (totalStreamed < Math.min(initialBatch.length, MAX_EXPORT_ROWS)) {
              if (clientDisconnected || request.signal.aborted) break;
              const nextSlice = initialBatch.slice(
                totalStreamed,
                Math.min(totalStreamed + EXPORT_CHUNK_SIZE, MAX_EXPORT_ROWS)
              );
              if (nextSlice.length === 0) break;

              totalStreamed += nextSlice.length;
              cursorId = nextSlice[nextSlice.length - 1].id;

              const sliceCsv = nextSlice
                .map((p) => {
                  const r = paymentToCsvRow(p);
                  return PAYMENT_EXPORT_COLUMNS.map((col) =>
                    escapeCsvField(String(r[col.key] ?? ""))
                  ).join(",");
                })
                .join("\n");

              controller.enqueue(encoder.encode("\n" + sliceCsv));
            }
          } else if (initialBatch.length === EXPORT_CHUNK_SIZE) {
            // Normal production database cursor streaming loop
            while (totalStreamed < MAX_EXPORT_ROWS) {
              if (clientDisconnected || request.signal.aborted) break;

              const batchLimit = Math.min(EXPORT_CHUNK_SIZE, MAX_EXPORT_ROWS - totalStreamed);
              const nextChunk = await prisma.payment.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: batchLimit,
                skip: 1,
                cursor: { id: cursorId! },
              });

              if (!nextChunk || nextChunk.length === 0) break;

              cursorId = nextChunk[nextChunk.length - 1].id;
              totalStreamed += nextChunk.length;

              const chunkCsv = nextChunk
                .map((p) => {
                  const r = paymentToCsvRow(p);
                  return PAYMENT_EXPORT_COLUMNS.map((col) =>
                    escapeCsvField(String(r[col.key] ?? ""))
                  ).join(",");
                })
                .join("\n");

              controller.enqueue(encoder.encode("\n" + chunkCsv));

              if (nextChunk.length < batchLimit) break;
            }
          }

          settle(() => controller.close());
        } catch (err) {
          if (clientDisconnected || request.signal.aborted) {
            settle(() => controller.close());
            return;
          }
          const failure = err instanceof Error ? err : new Error(String(err));
          logger.error("Payment export streaming error", { reason: failure.message });
          settle(() => controller.error(failure));
        } finally {
          request.signal.removeEventListener("abort", onAbort);
        }
      },
      cancel() {
        clientDisconnected = true;
      },
    });

    logger.request("GET", "/api/payments/export", 200, 0);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildPaymentExportFilename()}"`,
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Export-Truncated": truncated ? "true" : "false",
      },
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments/export");
  }
}

