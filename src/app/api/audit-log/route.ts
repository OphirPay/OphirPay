// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  type AuditLogEntry,
} from "@/lib/audit-log";

export type { AuditLogEntry };

/**
 * GET /api/audit-log
 *
 * Returns contract audit log entries. Requires API-key authentication with the
 * `admin` scope. Supports offset pagination (`page` / `limit`) and combined
 * filters: `actor`, `action`, `resource` (matches `target_id`), a `since` /
 * `until` date range (Unix seconds or ISO 8601), and `order` (asc | desc).
 *
 * Filtering is applied server-side across the full on-chain ledger, so the
 * `total` in `meta` reflects the filtered set, not the raw contract count.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Blank query params are treated as absent (Zod .optional() only applies
    // to undefined).
    const param = (name: string): string | undefined => {
      const v = searchParams.get(name);
      return v == null || v.trim() === "" ? undefined : v;
    };

    const parsed = auditLogQuerySchema.safeParse({
      page: param("page"),
      limit: param("limit"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit } = parsed.data;
    const filters = toAuditLogFilters(parsed.data);

    // Collect the filtered set (bounded by the on-chain ledger) to compute the
    // total for offset pagination.
    const all: AuditLogEntry[] = [];
    for await (const entry of iterateAuditLogEntries(filters)) {
      all.push(entry);
    }
    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    const hasMore = start + limit < total;

    return successResponse(items, {
      page,
      limit,
      total,
      nextCursor: null,
      hasMore,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
