// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
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
 * Returns audit log entries. Requires API-key authentication with the `admin`
 * scope.
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue
 *                  #365), queryable by action/target;
 *   - `contract` → the on-chain immutable audit ledger, filtered server-side
 *                  with offset pagination (`page` / `limit`) and the combined
 *                  filters `actor`, `action`, `resource`, `since`, `until`,
 *                  `order`;
 *   - `all`      → DB entries plus matching on-chain entries.
 *
 * For the on-chain sources, filtering is applied across the full ledger, so
 * `meta.total` reflects the filtered set, not the raw contract count.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Blank query params are treated as absent.
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
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, source } = parsed.data;
    const filters = toAuditLogFilters(parsed.data);

    // Persisted (DB) audit entries — refund lifecycle history with record
    // ids, queryable by action/target (issue #365).
    const dbEntries =
      source === "db" || source === "all"
        ? await prisma.auditLog.findMany({
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            where: {
              ...(filters.action ? { action: filters.action } : {}),
              ...(filters.actor ? { actor: filters.actor } : {}),
              ...(filters.resource != null
                ? { target: String(filters.resource) }
                : {}),
            },
          })
        : [];

    if (source === "db") {
      return successResponse(
        dbEntries.map((e) => ({
          id: e.id,
          timestamp: Math.floor(new Date(e.createdAt).getTime() / 1000),
          action: e.action,
          actor: e.actor ?? "",
          target_id: Number(e.target ?? 0),
          details:
            typeof e.details === "string"
              ? e.details
              : e.details != null
                ? JSON.stringify(e.details)
                : "",
        })),
        { page, limit, total: dbEntries.length }
      );
    }

    // On-chain entries: collect the filtered set (bounded by the ledger) to
    // compute the total for offset pagination, then slice the requested page.
    const all: AuditLogEntry[] = [];
    for await (const entry of iterateAuditLogEntries(filters)) {
      all.push(entry);
    }

    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);

    const combined =
      source === "all"
        ? [
            ...items,
            ...dbEntries.map((e) => ({
              id: e.id,
              timestamp: Math.floor(new Date(e.createdAt).getTime() / 1000),
              action: e.action,
              actor: e.actor ?? "",
              target_id: Number(e.target ?? 0),
              details:
                typeof e.details === "string"
                  ? e.details
                  : e.details != null
                    ? JSON.stringify(e.details)
                    : "",
            })),
          ]
        : items;

    return successResponse(combined, {
      page,
      limit,
      total: source === "all" ? all.length + dbEntries.length : all.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
