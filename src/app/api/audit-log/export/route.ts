// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { handleApiError, validationError } from "@/lib/api-response";
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(AUDIT_EXPORT_HEADER));
        try {
          for await (const entry of iterateAuditLogEntries(filters)) {
            controller.enqueue(
              encoder.encode(auditEntryToCsvRow(entry) + "\r\n")
            );
          }
        } finally {
          controller.close();
        }
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