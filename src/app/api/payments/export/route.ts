// SPDX-License-Identifier: MIT

import type { Payment, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { paymentExportParamsSchema } from "@/lib/validation-schemas";
import {
  problemFromError,
  problemFromZodError,
  problemUnauthorized,
} from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  PAYMENT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_PAGE_SIZE,
  paymentToCsvRow,
  buildPaymentExportFilename,
} from "@/lib/payment-export";
import { buildCsvHeader, buildCsvRow } from "@/lib/export-csv";

/**
 * GET /api/payments/export
 *
 * Streaming CSV export of the CURRENT filter results — every row matching
 * `status` / `search` (the same filters as GET /api/payments), not just the
 * page loaded in the browser.
 *
 * The export used to `findMany()` every matching row, map it to a row object
 * and join the lot into one string. For an account with a few thousand
 * transactions that meant the whole result set existed in memory (twice: once
 * as Prisma objects, once as the CSV string) and the client saw nothing until
 * the last row had been serialized — the failure mode was a memory spike or a
 * timeout, with no partial data to show for it (issue #1369).
 *
 * It now streams: a Prisma cursor walks the result set in 250-row pages, and
 * each page is serialized and flushed as its own chunk. Peak memory is one page
 * plus the runtime's socket buffer, independent of the number of rows, and the
 * first rows reach the client almost immediately.
 *
 * Streaming has two consequences this handler has to handle explicitly,
 * because the 200 and the headers are already on the wire when they happen:
 *
 *   • **Database error mid-stream** — the stream is *errored*, not closed. A
 *     closed stream produces a CSV that looks complete but stops mid-file; an
 *     errored stream fails the client's download, which is the only signal
 *     still available once the status line is sent. The failure is also logged,
 *     since the response status no longer reflects it.
 *   • **Client disconnect** — the page iterator is returned (released) so its
 *     `finally` blocks run and the in-flight page request is not followed by
 *     more, instead of continuing to read for a response nobody is waiting for.
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
    });
    if (!parsed.success) return problemFromZodError(parsed.error, { instance });

    const { status, search } = parsed.data;
    const where = buildPaymentWhere(auth.userId, { status, search });
    const encoder = new TextEncoder();

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
        controller.enqueue(
          encoder.encode(buildCsvHeader(PAYMENT_EXPORT_COLUMNS) + "\n")
        );

        try {
          for (;;) {
            if (request.signal.aborted) break;

            const next = await source.next();
            if (next.done) break;

            // One chunk per page: far fewer (and smaller) chunk frames than
            // one per row, while still bounding the buffer to a page.
            const rows = next.value
              .map((payment) =>
                buildCsvRow(paymentToCsvRow(payment), PAYMENT_EXPORT_COLUMNS)
              )
              .join("\n");
            controller.enqueue(encoder.encode(rows + "\n"));
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
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildPaymentExportFilename()}"`,
        // The dataset is filtered per caller and can change between requests.
        "Cache-Control": "no-store",
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
