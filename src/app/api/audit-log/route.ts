// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import {
  successResponse,
  handleApiError,
  validationError,
  jsonSafe,
} from "@/lib/api-response";
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
 * `admin` scope. Supports cursor-based pagination (`cursor` / `limit`) using
 * Prisma's indexed `(createdAt, id)` keys as well as offset pagination
 * (`page` / `limit`), plus combined filters: `actor` (substring,
 * case-insensitive), `action` (exact), `resource` (target_id), a
 * `since` / `until` timestamp range (Unix seconds or ISO 8601), and
 * directional timestamp sorting via `order` or `sort` (`asc` | `desc`).
 *
 * Standardized response payload includes `{ data, nextCursor, hasMore }` along
 * with `meta: { page, limit, total, nextCursor, hasMore, order, timestamp }`.
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue
 *                  #365), queryable with cursor pagination (`cursor: { id }`);
 *   - `contract` → the on-chain immutable audit ledger (default), supporting
 *                  both cursor and offset pagination;
 *   - `all`      → DB entries plus matching on-chain entries.
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

function buildAuditPaginatedResponse<T>(
  data: T[],
  meta: {
    page: number;
    limit: number;
    total: number;
    nextCursor: string | null;
    hasMore: boolean;
    order: "asc" | "desc";
  }
) {
  const base = successResponse(data, {
    page: meta.page,
    limit: meta.limit,
    total: meta.total,
    nextCursor: meta.nextCursor,
    hasMore: meta.hasMore,
  });
  return NextResponse.json(
    {
      success: true,
      data: jsonSafe(data) as T[],
      nextCursor: meta.nextCursor,
      hasMore: meta.hasMore,
      meta: {
        timestamp: new Date().toISOString(),
        page: meta.page,
        limit: meta.limit,
        total: meta.total,
        nextCursor: meta.nextCursor,
        hasMore: meta.hasMore,
        order: meta.order,
      },
    },
    { status: base.status }
  );
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
      cursor: param("cursor"),
      page: param("page"),
      limit: param("limit"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
      sort: param("sort"),
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { cursor, page, limit, order, source } = parsed.data;
    const hasFilters = Boolean(
      parsed.data.actor ||
        parsed.data.action ||
        parsed.data.resource != null ||
        parsed.data.since != null ||
        parsed.data.until != null
    );

    // Filters shared by the contract path (numeric seconds) and the DB path
    // (exact action / target-id / timestamp range match on the persisted trail).
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

    // Persisted (DB) audit entries — supports cursor pagination (`cursor: { id }`)
    // and directional sorting on the indexed `(createdAt, id)` columns.
    let dbRows: DbAuditRow[] = [];
    let dbTotal = 0;
    let dbHasMore = false;
    let dbNextCursor: string | null = null;

    if (source === "db" || source === "all") {
      const rawDbRows = await prisma.auditLog.findMany({
        where: dbWhere,
        orderBy: [{ createdAt: order }, { id: order }],
        ...(cursor
          ? { cursor: { id: cursor }, skip: 1 }
          : { skip: (page - 1) * limit }),
        take: limit + 1,
      });
      const hasExtraRow = rawDbRows.length > limit;
      const visibleDbRows = hasExtraRow ? rawDbRows.slice(0, limit) : rawDbRows;
      dbRows = visibleDbRows.map(mapDbRow);

      dbTotal =
        typeof prisma.auditLog?.count === "function"
          ? await prisma.auditLog.count({ where: dbWhere })
          : dbRows.length;

      dbHasMore =
        hasExtraRow || (!cursor && dbRows.length > 0 && page * limit < dbTotal);
      dbNextCursor =
        dbHasMore && dbRows.length > 0
          ? String(dbRows[dbRows.length - 1].id)
          : null;
    }

    if (source === "db") {
      return buildAuditPaginatedResponse(dbRows, {
        page,
        limit,
        total: dbTotal,
        nextCursor: dbNextCursor,
        hasMore: dbHasMore,
        order,
      });
    }

    // ── On-chain ledger (source=contract | all) ────────────────
    const totalCount = await readAuditLogTotalCount();
    if (totalCount === 0) {
      return buildAuditPaginatedResponse(dbRows, {
        page,
        limit,
        total: dbTotal,
        nextCursor: dbNextCursor,
        hasMore: dbHasMore,
        order,
      });
    }

    const descending = order !== "asc";
    const ascendingIds = (count: number) => {
      const ids: number[] = [];
      for (let id = 1; id <= count; id++) ids.push(id);
      return ids;
    };

    // Unfiltered window calculation supporting both cursor and offset pagination
    const computeUnfilteredWindow = (
      count: number
    ): { ids: number[]; hasMore: boolean } => {
      if (cursor !== undefined) {
        const cursorId = Number(cursor);
        if (!Number.isInteger(cursorId) || cursorId < 1 || cursorId > count + 1) {
          return { ids: [], hasMore: false };
        }
        if (descending) {
          const startId = cursorId - 1;
          if (startId < 1) return { ids: [], hasMore: false };
          const endId = Math.max(1, startId - limit + 1);
          const ids: number[] = [];
          for (let id = startId; id >= endId; id--) ids.push(id);
          return { ids, hasMore: endId > 1 };
        } else {
          const startId = cursorId + 1;
          if (startId > count) return { ids: [], hasMore: false };
          const endId = Math.min(count, startId + limit - 1);
          const ids: number[] = [];
          for (let id = startId; id <= endId; id++) ids.push(id);
          return { ids, hasMore: endId < count };
        }
      }

      if (descending) {
        const startId = count - (page - 1) * limit;
        if (startId < 1) return { ids: [], hasMore: false };
        const endId = Math.max(1, startId - limit + 1);
        const ids: number[] = [];
        for (let id = startId; id >= endId; id--) ids.push(id);
        return { ids, hasMore: endId > 1 };
      } else {
        const startId = (page - 1) * limit + 1;
        if (startId > count) return { ids: [], hasMore: false };
        const endId = Math.min(count, startId + limit - 1);
        const ids: number[] = [];
        for (let id = startId; id <= endId; id++) ids.push(id);
        return { ids, hasMore: endId < count };
      }
    };

    let idPool: number[];
    let unfilteredHasMore = false;
    if (hasFilters) {
      idPool = ascendingIds(totalCount);
      if (descending) idPool.reverse();
    } else {
      const win = computeUnfilteredWindow(totalCount);
      idPool = win.ids;
      unfilteredHasMore = win.hasMore;
    }

    const entries: AuditLogEntry[] = [];
    for (let i = 0; i < idPool.length; i += 10) {
      const chunk = idPool.slice(i, i + 10);
      const results = await Promise.all(
        chunk.map((id) => readAuditEntryById(id))
      );
      for (const entry of results) {
        if (entry && (!hasFilters || matchesFilters(entry, filters))) {
          entries.push(entry);
        }
      }
    }

    // Ensure directional timestamp sorting (tie-broken by id)
    entries.sort((a, b) => {
      const diff = a.timestamp - b.timestamp || a.id - b.id;
      return descending ? -diff : diff;
    });

    if (!hasFilters) {
      const nextCursor =
        unfilteredHasMore && entries.length > 0
          ? String(entries[entries.length - 1].id)
          : null;
      return buildAuditPaginatedResponse(entries, {
        page,
        limit,
        total: totalCount,
        nextCursor,
        hasMore: unfilteredHasMore,
        order,
      });
    }

    // Filtered — slice the page from the matching set via cursor or offset
    let start = (page - 1) * limit;
    if (cursor !== undefined) {
      const idx = entries.findIndex((e) => String(e.id) === cursor);
      if (idx !== -1) {
        start = idx + 1;
      } else {
        const cursorNum = Number(cursor);
        if (Number.isInteger(cursorNum)) {
          const fallbackIdx = entries.findIndex((e) =>
            descending ? e.id < cursorNum : e.id > cursorNum
          );
          start = fallbackIdx !== -1 ? fallbackIdx : entries.length;
        } else {
          start = entries.length;
        }
      }
    }

    const pageItems = entries.slice(start, start + limit);
    const hasMore = start + limit < entries.length;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? String(pageItems[pageItems.length - 1].id)
        : null;
    const total = entries.length + (source === "all" ? dbTotal : 0);
    const data = source === "all" ? [...pageItems, ...dbRows] : pageItems;
    return buildAuditPaginatedResponse(data, {
      page,
      limit,
      total,
      nextCursor,
      hasMore,
      order,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));

