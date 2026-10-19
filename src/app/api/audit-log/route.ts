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
  paginateAuditEntriesByCursor,
  type AuditLogEntry,
} from "@/lib/audit-log";

/**
 * GET /api/audit-log
 *
 * Returns audit log entries. Requires API-key authentication with the
 * `admin` scope. Supports both cursor-based pagination (`cursor` / `limit`)
 * and offset pagination (`page` / `limit`), directional sorting (`order`:
 * `asc` | `desc`), and combined filters (`actor`, `action`, `resource`,
 * `since`, `until`).
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
    const param = (name: string): string | undefined => {
      const v = searchParams.get(name);
      return v == null || v.trim() === "" ? undefined : v;
    };

    const parsed = auditLogQuerySchema.safeParse({
      page: param("page"),
      limit: param("limit"),
      cursor: param("cursor"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, cursor, order, source } = parsed.data;
    const sortDirection: "asc" | "desc" = order === "asc" ? "asc" : "desc";
    const hasFilters = Boolean(
      parsed.data.actor ||
        parsed.data.action ||
        parsed.data.resource != null ||
        parsed.data.since != null ||
        parsed.data.until != null
    );

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

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (filters.since != null) createdAtFilter.gte = new Date(filters.since * 1000);
    if (filters.until != null) createdAtFilter.lte = new Date(filters.until * 1000);

    const dbWhere = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actor ? { actor: { contains: parsed.data.actor } } : {}),
      ...(filters.resource != null ? { target: String(filters.resource) } : {}),
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    };

    // Persisted (DB) audit entries using indexed (createdAt, id) cursor pagination (#1361)
    const rawDbRows =
      source === "db" || source === "all"
        ? (
            await prisma.auditLog.findMany({
              where: dbWhere,
              orderBy: [{ createdAt: sortDirection }, { id: sortDirection }],
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip: (page - 1) * limit }),
              take: limit + 1,
            })
          ).map(mapDbRow)
        : [];
    const dbHasMore = rawDbRows.length > limit;
    const dbRows = dbHasMore ? rawDbRows.slice(0, limit) : rawDbRows;
    const dbNextCursor = dbHasMore && dbRows.length > 0 ? dbRows[dbRows.length - 1].id : null;

    const dbTotal =
      source === "db" || source === "all"
        ? await prisma.auditLog.count({ where: dbWhere })
        : 0;

    if (source === "db") {
      return successResponse(dbRows, {
        page,
        limit,
        total: dbTotal,
        nextCursor: dbNextCursor,
        hasMore: dbHasMore,
      });
    }

    // ── On-chain ledger (source=contract | all) ────────────────
    const totalCount = await readAuditLogTotalCount();
    if (totalCount === 0) {
      return successResponse(dbRows, {
        page,
        limit,
        total: dbTotal,
        nextCursor: dbNextCursor,
        hasMore: dbHasMore,
      });
    }

    const descending = sortDirection === "desc";
    const ascendingIds = (count: number) => {
      const ids: number[] = [];
      for (let id = 1; id <= count; id++) ids.push(id);
      return ids;
    };
    const windowIds = (count: number) => {
      const ids: number[] = [];
      const parsedCursorId = cursor != null && /^\d+$/.test(cursor) ? Number(cursor) : null;
      if (parsedCursorId != null) {
        if (descending) {
          const startId = Math.min(count, parsedCursorId - 1);
          const endId = Math.max(1, startId - limit);
          for (let id = startId; id >= endId; id--) ids.push(id);
        } else {
          const startId = Math.max(1, parsedCursorId + 1);
          const endId = Math.min(count, startId + limit);
          for (let id = startId; id <= endId; id++) ids.push(id);
        }
        return ids;
      }
      if (descending) {
        const startId = Math.max(1, count - (page - 1) * limit);
        const endId = Math.max(1, startId - limit);
        for (let id = startId; id >= endId; id--) ids.push(id);
      } else {
        const startId = Math.min(count, 1 + (page - 1) * limit);
        const endId = Math.min(count, startId + limit);
        for (let id = startId; id <= endId; id++) ids.push(id);
      }
      return ids;
    };

    const idPool = hasFilters ? ascendingIds(totalCount) : windowIds(totalCount);
    if (hasFilters && !descending) {
      // already ascending
    } else if (hasFilters && descending) {
      idPool.reverse();
    }

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
      const hasMore = entries.length > limit;
      const pageData = hasMore ? entries.slice(0, limit) : entries;
      const nextCursor =
        hasMore && pageData.length > 0 ? String(pageData[pageData.length - 1].id) : null;
      return successResponse(pageData, {
        page,
        limit,
        total: totalCount,
        nextCursor,
        hasMore,
      });
    }

    if (cursor) {
      const paged = paginateAuditEntriesByCursor(entries, {
        cursor,
        limit,
        order: sortDirection,
      });
      const total = entries.length + (source === "all" ? dbTotal : 0);
      const data = source === "all" ? [...paged.data, ...dbRows] : paged.data;
      return successResponse(data, {
        page,
        limit,
        total,
        nextCursor: paged.nextCursor,
        hasMore: paged.hasMore,
      });
    }

    const start = (page - 1) * limit;
    const pageItems = entries.slice(start, start + limit);
    const hasMore = start + limit < entries.length;
    const nextCursor =
      hasMore && pageItems.length > 0 ? String(pageItems[pageItems.length - 1].id) : null;
    const total = entries.length + (source === "all" ? dbTotal : 0);
    const data = source === "all" ? [...pageItems, ...dbRows] : pageItems;
    return successResponse(data, {
      page,
      limit,
      total,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
