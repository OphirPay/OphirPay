// SPDX-License-Identifier: MIT

import { withApiAuth } from "@/lib/api-auth";
import {
  successResponse,
  handleApiError,
  validationError,
  badRequestError,
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
import {
  decodeCursor,
  computeNextCursor,
  buildCursorWhere,
  type CursorPayload,
  encodeCursor,
} from "@/lib/pagination-utils";

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
    const explicitPage = searchParams.get("page");

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
      cursor: param("cursor"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, source, order } = parsed.data;
    const rawCursor = parsed.data.cursor;

    if (rawCursor && explicitPage !== null) {
      return badRequestError("cursor and page cannot both be used");
    }

    let cursor: CursorPayload | null = null;
    if (rawCursor) {
      cursor = decodeCursor(rawCursor);
      if (!cursor) {
        // Support direct record ID cursors as well (issue #1361)
        try {
          const anchor = await prisma.auditLog.findUnique({
            where: { id: rawCursor },
            select: { id: true, createdAt: true },
          });
          if (anchor) {
            cursor = {
              createdAt: anchor.createdAt.toISOString(),
              id: anchor.id,
            };
          }
        } catch {
          // Ignore DB lookup error
        }
      }
      if (!cursor) {
        return badRequestError("Invalid cursor");
      }
    }

    const useCursor = cursor !== null || explicitPage === null;
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
    const dbWhere: Record<string, unknown> = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actor ? { actor: { contains: parsed.data.actor } } : {}),
      ...(filters.resource != null
        ? { target: String(filters.resource) }
        : {}),
    };

    // ── Persisted (DB) audit entries (issue #365 / issue #1361) ───
    if (source === "db") {
      const orderBy = [{ createdAt: order }, { id: order }];
      if (useCursor) {
        const where = buildCursorWhere(dbWhere, cursor, order);
        const rows = await prisma.auditLog.findMany({
          where,
          orderBy,
          take: limit + 1,
        });
        const visible = rows.slice(0, limit).map(mapDbRow);
        const { nextCursor, hasMore } = computeNextCursor(rows, limit);
        const meta: Record<string, unknown> = {
          limit,
          nextCursor,
          hasMore,
        };
        if (searchParams.get("includeTotal") === "true") {
          meta.total = await prisma.auditLog.count({ where: dbWhere });
        }
        return successResponse(visible, meta);
      } else {
        const [rows, total] = await Promise.all([
          prisma.auditLog.findMany({
            where: dbWhere,
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.auditLog.count({ where: dbWhere }),
        ]);
        return successResponse(rows.map(mapDbRow), {
          page,
          limit,
          total,
          nextCursor: null,
          hasMore: page * limit < total,
        });
      }
    }

    const dbRows =
      source === "all"
        ? (
            await prisma.auditLog.findMany({
              where: useCursor ? buildCursorWhere(dbWhere, cursor, order) : dbWhere,
              orderBy: [{ createdAt: order }, { id: order }],
              take: useCursor ? limit + 1 : limit,
              ...(useCursor ? {} : { skip: (page - 1) * limit }),
            })
          ).map(mapDbRow)
        : [];
    const dbTotal =
      source === "all"
        ? await prisma.auditLog.count({ where: dbWhere })
        : 0;

    // ── On-chain ledger (source=contract | all) ────────────────
    const totalCount = await readAuditLogTotalCount();
    if (totalCount === 0) {
      return successResponse(dbRows, {
        page: useCursor ? undefined : page,
        limit,
        total: dbTotal,
        nextCursor: null,
        hasMore: false,
      });
    }

    // Which ids to read (ids are 1-indexed, newest = highest id):
    // - Unfiltered: only the page window, so plain reads stay cheap.
    // - Filtered: scan the whole ledger so the filtered `total` (and therefore
    //   pagination) is exact regardless of where matches fall.
    const descending = order !== "asc";
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

    const idPool = hasFilters || cursor !== null
      ? ascendingIds(totalCount)
      : windowIds(totalCount);
    if (!descending && (hasFilters || cursor !== null)) {
      // ascendingIds is naturally 1..count; no reverse needed for asc
    } else if (descending && (hasFilters || cursor !== null)) {
      idPool.reverse();
    } else if (!descending) {
      idPool.reverse();
    }

    // When cursor is supplied on contract source, filter records past cursor
    let filterCursorId: number | null = null;
    if (cursor) {
      const cid = Number(cursor.id);
      if (Number.isInteger(cid) && cid > 0) {
        filterCursorId = cid;
      }
    }

    const entries: AuditLogEntry[] = [];
    for (let i = 0; i < idPool.length; i += 10) {
      const chunk = idPool.slice(i, i + 10);
      const results = await Promise.all(chunk.map((id) => readAuditEntryById(id)));
      for (const entry of results) {
        if (!entry) continue;
        if (filterCursorId != null) {
          if (descending && entry.id >= filterCursorId) continue;
          if (!descending && entry.id <= filterCursorId) continue;
        }
        if (!hasFilters || matchesFilters(entry, filters)) {
          entries.push(entry);
        }
      }
      if (cursor !== null && entries.length >= limit + 1) break;
    }

    if (cursor !== null) {
      const visible = entries.slice(0, limit);
      const hasMore = entries.length > limit;
      const nextCursor =
        hasMore && visible.length > 0
          ? encodeCursor({
              createdAt: new Date(visible[visible.length - 1].timestamp * 1000).toISOString(),
              id: String(visible[visible.length - 1].id),
            })
          : null;
      return successResponse(visible, { limit, nextCursor, hasMore });
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
