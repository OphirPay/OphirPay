// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  parseAuditTimestamp,
  readAuditLogTotalCount,
  readAuditEntryById,
  type AuditLogEntry,
} from "@/lib/audit-log";

/**
 * GET /api/audit-log
 *
 * Returns audit log entries. Requires API-key authentication with the
 * `admin` scope. Supports offset pagination (`page` / `limit`) and combined
 * filters: `actor` (substring, case-insensitive), `action` (exact), a
 * `since` / `until` timestamp range (Unix seconds or ISO 8601), and `order`
 * (asc | desc).
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue
 *                  #365), queryable by action/target;
 *   - `contract` → the on-chain immutable audit ledger (default), filtered
 *                  server-side with offset pagination;
 *   - `all`      → DB entries plus matching on-chain entries.
 *
 * For the on-chain sources, filtering is applied across the full ledger, so
 * `meta.total` reflects the filtered set, not the raw contract count.
 */

type DbAuditRow = {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  target_id: string;
  details: string | null;
};

function mapDbRow(e: {
  id: string;
  action: string;
  actor: string | null;
  target: string | null;
  details: unknown;
  createdAt: Date;
}): DbAuditRow {
  return {
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
  };
}

/** Applies the combined filters with AND semantics to one on-chain entry. */
function matchesFilters(
  entry: AuditLogEntry,
  filters: {
    actor?: string;
    action?: string;
    resource?: number;
    since?: number;
    until?: number;
  }
): boolean {
  if (filters.actor && !entry.actor.toLowerCase().includes(filters.actor)) {
    return false;
  }
  if (filters.action && entry.action !== filters.action) return false;
  if (filters.resource != null && entry.target_id !== filters.resource) {
    return false;
  }
  if (filters.since != null && entry.timestamp < filters.since) return false;
  if (filters.until != null && entry.timestamp > filters.until) return false;
  return true;
}

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
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, source } = parsed.data;
    const hasFilters = Boolean(
      parsed.data.actor ||
        parsed.data.action ||
        parsed.data.resource != null ||
        parsed.data.since != null ||
        parsed.data.until != null
    );

    // Filters shared by the contract path (numeric seconds) and the DB path
    // (exact action / target-id match on the persisted trail).
    const filters = {
      actor: parsed.data.actor?.toLowerCase(),
      action: parsed.data.action,
      resource: parsed.data.resource,
      since:
        parsed.data.since != null
          ? (parseAuditTimestamp(parsed.data.since) ?? undefined)
          : undefined,
      until:
        parsed.data.until != null
          ? (parseAuditTimestamp(parsed.data.until) ?? undefined)
          : undefined,
    };
    const dbWhere = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actor ? { actor: { contains: parsed.data.actor } } : {}),
      ...(filters.resource != null
        ? { target: String(filters.resource) }
        : {}),
    };

    // Persisted (DB) audit entries — refund lifecycle history with record
    // ids (issue #365).
    const dbRows =
      source === "db" || source === "all"
        ? (
            await prisma.auditLog.findMany({
              where: dbWhere,
              orderBy: { createdAt: "desc" },
              skip: (page - 1) * limit,
              take: limit,
            })
          ).map(mapDbRow)
        : [];
    const dbTotal =
      source === "db" || source === "all"
        ? await prisma.auditLog.count({ where: dbWhere })
        : 0;

    if (source === "db") {
      return successResponse(dbRows, { page, limit, total: dbTotal });
    }

    // ── On-chain ledger (source=contract | all) ────────────────
    const totalCount = await readAuditLogTotalCount();
    if (totalCount === 0) {
      return successResponse(dbRows, { page, limit, total: dbTotal });
    }

    // Which ids to read (ids are 1-indexed, newest = highest id):
    // - Unfiltered: only the page window, so plain reads stay cheap.
    // - Filtered: scan the whole ledger so the filtered `total` (and therefore
    //   pagination) is exact regardless of where matches fall.
    const descending = parsed.data.order !== "asc";
    const ascendingIds = (count: number) => {
      const ids: number[] = [];
      for (let id = 1; id <= count; id++) ids.push(id);
      return ids;
    };
    const windowIds = (count: number) => {
      const ids: number[] = [];
      const startId = Math.max(1, count - (page - 1) * limit);
      const endId = Math.max(1, startId - limit + 1);
      for (let id = startId; id >= endId; id--) ids.push(id);
      return ids;
    };

    const idPool = hasFilters ? ascendingIds(totalCount) : windowIds(totalCount);
    if (!descending) idPool.reverse();

    const entries: AuditLogEntry[] = [];
    for (let i = 0; i < idPool.length; i += 10) {
      const chunk = idPool.slice(i, i + 10);
      const results = await Promise.all(chunk.map((id) => readAuditEntryById(id)));
      for (const entry of results) {
        if (entry && (!hasFilters || matchesFilters(entry, filters))) {
          entries.push(entry);
        }
      }
    }

    if (!hasFilters) {
      // Unfiltered page window — total is the ledger size.
      return successResponse(entries, { page, limit, total: totalCount });
    }

    // Filtered — slice the page from the matching set (kept in id order).
    const start = (page - 1) * limit;
    const pageItems = entries.slice(start, start + limit);
    const total = entries.length + (source === "all" ? dbTotal : 0);
    const data =
      source === "all"
        ? [...pageItems, ...dbRows]
        : pageItems;
    return successResponse(data, { page, limit, total });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
