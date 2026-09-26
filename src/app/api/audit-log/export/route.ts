// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { handleApiError, validationError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  auditEntryToCsvRow,
  buildAuditExportFilename,
  AUDIT_EXPORT_HEADER,
} from "@/lib/audit-log";

/**
 * GET /api/audit-log/export
 *
 * Streaming CSV export of the audit log. Applies exactly the same filters as
 * GET /api/audit-log, so "export the current filters" stays true.
 *
 * Instead of building one in-memory string, rows are streamed from the
 * contract as a `ReadableStream` and flushed chunk by chunk, so arbitrarily
 * large exports don't load the full result set into memory.
 *
 * Streaming means the 200 and the response headers are flushed before the
 * first row is read, so the two failure modes below cannot be reported as a
 * JSON error body. They are therefore made explicit instead of silent:
 *
 *   • **Source error mid-stream** — the stream is *errored*, not closed. A
 *     closed stream produces a CSV that looks complete but stops mid-file;
 *     an errored stream makes the client's download fail, which is the only
 *     signal that survives the fact that the status line is already sent.
 *     The failure is also logged, because the response status (200) no longer
 *     reflects it.
 *   • **Client disconnect** — the underlying audit-log iterator is returned
 *     (released), which runs its `finally` blocks and stops the in-flight
 *     on-chain reads instead of letting them run to completion for a response
 *     nobody is reading.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const param = (name: string): string | undefined => {
      const v = searchParams.get(name);
      return v == null || v.trim() === "" ? undefined : v;
    };

    const parsed = auditLogQuerySchema.safeParse({
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const filters = toAuditLogFilters(parsed.data);
    const encoder = new TextEncoder();

    // Drive the generator by hand rather than with `for await` so that a client
    // disconnect can release it: `return()` runs the generator's `finally`
    // blocks, which is what stops the pending contract reads.
    const source = iterateAuditLogEntries(filters);
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

        controller.enqueue(encoder.encode(AUDIT_EXPORT_HEADER));
        try {
          for (;;) {
            if (request.signal.aborted) break;

            const next = await source.next();
            if (next.done) break;

            controller.enqueue(
              encoder.encode(auditEntryToCsvRow(next.value) + "\r\n")
            );
          }
          settle(() => controller.close());
        } catch (error) {
          if (request.signal.aborted) {
            // A disconnect is not an export failure: settle quietly (the
            // consumer is gone, so close() is a no-op) and release the source.
            settle(() => controller.close());
            return;
          }
          const failure =
            error instanceof Error ? error : new Error(String(error));
          logger.error("Audit log export failed mid-stream", {
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

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildAuditExportFilename()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
