// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  readAuditLogTotalCount,
  matchesAuditFilters,
  type AuditLogEntry,
} from "@/lib/audit-log";

/**
 * GET /api/audit-log
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

    // ── DB entries (refund lifecycle history) ────────────────────
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
        dbEntries.map((e: { id: number; createdAt: Date; action: string; actor: string | null; target: string | null; details: unknown }) => ({
          id: e.id,
          timestamp: new Date(e.createdAt).getTime(),
          action: e.action,
          actor: e.actor ?? "",
          target_id: e.target ?? "",
          details:
            typeof e.details === "string"
              ? e.details
              : e.details != null
                ? JSON.stringify(e.details)
                : null,
        })),
        { page, limit, total: dbEntries.length }
      );
    }

    // ── On-chain entries ────────────────────────────────────────
    const totalCount = await readAuditLogTotalCount();
    if (totalCount === 0) {
      if (source === "all") {
        return successResponse(dbEntries, {
          page,
          limit,
          total: dbEntries.length,
        });
      }
      return successResponse([], { page, limit, total: 0 });
    }

    // Collect the full ledger via the async iterator, then apply
    // filters, paginate, and optionally merge with DB entries.
    const all: AuditLogEntry[] = [];
    for await (const entry of iterateAuditLogEntries(filters)) {
      all.push(entry);
    }

    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);

    const combined =
      source === "all"
        ? [
            ...items.map((e) => ({
              id: e.id,
              timestamp: e.timestamp,
              action: e.action,
              actor: e.actor,
              target_id: e.target_id,
              details: e.details,
            })),
            ...dbEntries.map((e: { id: number; createdAt: Date; action: string; actor: string | null; target: string | null; details: unknown }) => ({
              id: e.id,
              timestamp: new Date(e.createdAt).getTime(),
              action: e.action,
              actor: e.actor ?? "",
              target_id: e.target ?? "",
              details:
                typeof e.details === "string"
                  ? e.details
                  : e.details != null
                    ? JSON.stringify(e.details)
                    : null,
            })),
          ]
        : items;

    return successResponse(source === "all" ? combined : items, {
      page,
      limit,
      total: source === "all" ? all.length + dbEntries.length : all.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
