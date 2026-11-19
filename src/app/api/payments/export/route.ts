// SPDX-License-Identifier: MIT

import type { Payment, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { paymentExportParamsSchema } from "@/lib/validation-schemas";
import {
  problemFromError,
  problemFromZodError,
  problemTooManyRequests,
  problemUnauthorized,
} from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  PAYMENT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_CONTENT_TYPES,
  PAYMENT_EXPORT_PAGE_SIZE,
  buildPaymentExportFilename,
  paymentRowToJson,
  paymentToExportRow,
} from "@/lib/payment-export";
import { buildCsvHeader, buildCsvRow } from "@/lib/export-csv";
import {
  PAYMENT_EXPORT_RATE_LIMIT_MAX,
  PAYMENT_EXPORT_RATE_LIMIT_WINDOW_MS,
  getRateLimitStore,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";

/**
 * GET /api/payments/export
 *
 * Streaming export of the CURRENT filter results — every row matching the
 * active `status` / `search` / `dateFrom` / `dateTo` / `asset` filters, not
 * just the page loaded in the browser.
 *
 * Two formats share one record shape (`src/lib/payment-export.ts`):
 *
 *   • `format=csv`  (default) — RFC 4180 rows with the injection guard from
 *     `src/lib/export-csv.ts`.
 *   • `format=json` — an array of objects with the same field names.
 *
 * The export streams: a Prisma cursor walks the result set in 250-row pages,
 * and each page is serialized and flushed as its own chunk. Peak memory is one
 * page plus the runtime's socket buffer, independent of the number of rows,
 * and the first rows reach the client almost immediately (issue #1369).
 *
 * Streaming has two consequences this handler has to handle explicitly,
 * because the 200 and the headers are already on the wire when they happen:
 *
 *   • **Database error mid-stream** — the stream is *errored*, not closed. A
 *     closed stream produces a CSV/JSON file that looks complete but stops
 *     mid-file; an errored stream fails the client's download, which is the
 *     only signal still available once the status line is sent. The failure is
 *     also logged, since the response status no longer reflects it.
 *   • **Client disconnect** — the page iterator is returned (released) so its
 *     `finally` blocks run and the in-flight page request is not followed by
 *     more, instead of continuing to read for a response nobody is waiting for.
 *
 * Exports are quota-limited per authenticated account: each request can walk
 * the entire payment history, so a retry loop is far more expensive than it
 * looks. The quota never replaces authentication, it only bounds abuse.
 */
export async function GET(request: Request) {
  const instance = new URL(request.url).pathname;
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return problemUnauthorized(undefined, { instance });
    }

    const { searchParams } = new URL(request.url);
    const parsed = paymentExportParamsSchema.safeParse({
      // searchParams.get() returns null for absent params, which Zod's
      // .optional() rejects — normalize to undefined first.
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      asset: searchParams.get("asset") ?? undefined,
      format: searchParams.get("format") ?? undefined,
    });
    if (!parsed.success) return problemFromZodError(parsed.error, { instance });

    const { status, search, dateFrom, dateTo, asset, format } = parsed.data;

    // ── Per-account quota ──────────────────────────────────────────
    const rate = await getRateLimitStore().increment(
      `payments:export:${auth.userId}`,
      PAYMENT_EXPORT_RATE_LIMIT_WINDOW_MS,
      PAYMENT_EXPORT_RATE_LIMIT_MAX
    );
    if (!rate.allowed) {
      return problemTooManyRequests(
        "Payment export rate limit exceeded. Try again when the window resets.",
        {
          instance,
          headers: {
            "Retry-After": String(getRetryAfterSeconds(rate)),
            "X-RateLimit-Limit": String(PAYMENT_EXPORT_RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const where = buildPaymentWhere(auth.userId, {
      status,
      search,
      dateFrom,
      dateTo,
      asset,
    });
    const encoder = new TextEncoder();
    const isJson = format === "json";

    // Drive the page iterator by hand rather than with `for await` so a client
    // disconnect can release it (`return()` runs its `finally` blocks).
    const source = iteratePaymentPages(where);
    let released = false;
    const releaseSource = () => {
      if (released) return;
      released = true;
      void Promise.resolve(source.return?.(undefined)).catch(() => {});
    };

    const onAbort = () => releaseSource();
    request.signal.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let settled = false;
        let wroteJsonRow = false;
        // The consumer may already be gone (client disconnect) by the time we
        // settle, in which case close()/error() throw — that is not our error.
        const settle = (action: () => void) => {
          if (settled) return;
          settled = true;
          try {
            action();
          } catch {
            /* consumer already detached */
          }
        };

        // Header first, so a client can start parsing before the first page
        // has even been read from the database.
        if (isJson) {
          controller.enqueue(encoder.encode("["));
        } else {
          controller.enqueue(
            encoder.encode(buildCsvHeader(PAYMENT_EXPORT_COLUMNS) + "\n")
          );
        }

        try {
          for (;;) {
            if (request.signal.aborted) break;

            const next = await source.next();
            if (next.done) break;

            // One chunk per page: far fewer (and smaller) chunk frames than
            // one per row, while still bounding the buffer to a page.
            const rows = next.value.map((payment) => {
              const row = paymentToExportRow(payment);
              return isJson
                ? JSON.stringify(paymentRowToJson(row))
                : buildCsvRow(row, PAYMENT_EXPORT_COLUMNS);
            });
            if (rows.length === 0) continue;

            if (isJson) {
              controller.enqueue(
                encoder.encode(
                  (wroteJsonRow ? ",\n" : "\n") + rows.join(",\n")
                )
              );
              wroteJsonRow = true;
            } else {
              controller.enqueue(encoder.encode(rows.join("\n") + "\n"));
            }
          }

          if (isJson) {
            // The opening `[` was already flushed; close it. Empty exports
            // therefore become `[]` rather than an unterminated `[`.
            controller.enqueue(
              encoder.encode(wroteJsonRow ? "\n]\n" : "]\n")
            );
          }
          settle(() => controller.close());
        } catch (error) {
          if (request.signal.aborted) {
            // A disconnect is not an export failure: the consumer is gone, so
            // close quietly and release the source.
            settle(() => controller.close());
            return;
          }
          const failure =
            error instanceof Error ? error : new Error(String(error));
          logger.error("Payment export failed mid-stream", {
            reason: failure.message,
            format,
          });
          settle(() => controller.error(failure));
        } finally {
          request.signal.removeEventListener("abort", onAbort);
          releaseSource();
        }
      },
      cancel() {
        // The response body was cancelled (client went away).
        releaseSource();
      },
    });

    logger.request("GET", "/api/payments/export", 200, 0);

    return new Response(stream, {
      headers: {
        "Content-Type": PAYMENT_EXPORT_CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${buildPaymentExportFilename(format)}"`,
        // The dataset is filtered per caller and can change between requests.
        "Cache-Control": "no-store",
        "X-Export-Format": format,
        "X-RateLimit-Limit": String(PAYMENT_EXPORT_RATE_LIMIT_MAX),
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
        // The body is sent as it is produced. Node's HTTP/1.1 server would add
        // this itself for a streamed body; declaring it keeps the intention
        // explicit (HTTP/2 framing ignores it).
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

/**
 * Walk the filtered payments one page at a time.
 *
 * Keyset (cursor) pagination, not `skip`: `skip` makes the database re-scan
 * every preceding row on each page, so page *n* costs O(n · pageSize) and the
 * export gets slower the larger the account is. `cursor` seeks straight to the
 * last row of the previous page instead.
 *
 * Ordering matches GET /api/payments (`createdAt DESC, id DESC`) with the
 * unique `id` as the tie-breaker — without it, rows sharing a `createdAt`
 * timestamp could repeat or be skipped as the cursor advances.
 */
async function* iteratePaymentPages(where: Prisma.PaymentWhereInput) {
  let cursor: string | undefined;

  for (;;) {
    const page: Payment[] = await prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAYMENT_EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (page.length === 0) return;
    yield page;

    // A short page means the result set is exhausted; no need to pay for one
    // more empty round trip.
    if (page.length < PAYMENT_EXPORT_PAGE_SIZE) return;
    cursor = page[page.length - 1].id;
  }
}
