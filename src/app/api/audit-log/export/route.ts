// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { withApiAuth } from "@/lib/api-auth";
import { handleApiError, validationError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  auditEntryToCsvRow,
  escapeCsvField,
  buildAuditExportFilename,
  AUDIT_EXPORT_HEADER,
} from "@/lib/audit-log";

/** Number of rows fetched per Prisma cursor batch during streaming DB audit-log export (#1369). */
export const AUDIT_EXPORT_BATCH_SIZE = 250;

function dbAuditRowToCsvLine(row: {
  id: string;
  action: string;
  actor: string | null;
  target: string | null;
  details: unknown;
  createdAt: Date;
}): string {
  const timestamp = Math.floor(new Date(row.createdAt).getTime() / 1000);
  const detailsStr =
    typeof row.details === "string"
      ? row.details
      : row.details != null
        ? JSON.stringify(row.details)
        : "";
  return (
    [
      row.id,
      timestamp,
      row.action,
      row.actor ?? "",
      row.target ?? "",
      detailsStr,
    ]
      .map(escapeCsvField)
      .join(",") + "\r\n"
  );
}

/**
 * GET /api/audit-log/export
 *
 * Streaming chunked CSV export of the audit log. Applies the same filters as
 * GET /api/audit-log. Supports both `source=contract` (streaming on-chain
 * entries) and `source=db` (streaming 250-row Prisma cursor batches without
 * buffering the full dataset in memory, issue #1369).
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
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const filters = toAuditLogFilters(parsed.data);
    const { source, order } = parsed.data;
    const encoder = new TextEncoder();

    if (source === "db") {
      const dbWhere = {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.actor ? { actor: { contains: parsed.data.actor } } : {}),
        ...(filters.resource != null
          ? { target: String(filters.resource) }
          : {}),
        ...(filters.since != null || filters.until != null
          ? {
              createdAt: {
                ...(filters.since != null
                  ? { gte: new Date(filters.since * 1000) }
                  : {}),
                ...(filters.until != null
                  ? { lte: new Date(filters.until * 1000) }
                  : {}),
              },
            }
          : {}),
      };

      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      const dbStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let settled = false;
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
          let cursorId: string | undefined;

          try {
            while (!cancelled && !request.signal.aborted) {
              const batch = await prisma.auditLog.findMany({
                where: dbWhere,
                orderBy: [{ createdAt: order }, { id: order }],
                ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
                take: AUDIT_EXPORT_BATCH_SIZE,
              });

              if (cancelled || request.signal.aborted || batch.length === 0) {
                break;
              }

              const chunkText = batch.map(dbAuditRowToCsvLine).join("");
              controller.enqueue(encoder.encode(chunkText));

              const nextCursorId = batch[batch.length - 1]?.id;
              if (
                batch.length < AUDIT_EXPORT_BATCH_SIZE ||
                !nextCursorId ||
                nextCursorId === cursorId
              ) {
                break;
              }
              cursorId = nextCursorId;
            }
            settle(() => controller.close());
          } catch (error) {
            if (cancelled || request.signal.aborted) {
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
          }
        },
        cancel() {
          cancelled = true;
          request.signal.removeEventListener("abort", onAbort);
        },
      });

      return new Response(dbStream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${buildAuditExportFilename()}"`,
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-store",
        },
      });
    }

    // Drive the generator by hand rather than with `for await` so that a client
    // disconnect can release it: `return()` runs the generator's `finally`
    // blocks, which is what stops the pending contract reads.
    const sourceIter = iterateAuditLogEntries(filters);
    let released = false;
    const releaseSource = () => {
      if (released) return;
      released = true;
      void Promise.resolve(sourceIter.return?.(undefined)).catch(() => {});
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
            if (request.signal.aborted || released) break;

            const next = await sourceIter.next();
            if (next.done) break;

            controller.enqueue(
              encoder.encode(auditEntryToCsvRow(next.value) + "\r\n")
            );
          }
          settle(() => controller.close());
        } catch (error) {
          if (request.signal.aborted || released) {
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
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));

