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
  buildCursorWhere,
  computeNextCursor,
  cursorFromRow,
  decodeCursor,
  keysetOrderBy,
} from "@/lib/pagination-utils";

/**
 * GET /api/audit-log
 *
 * Returns audit log entries. Requires API-key authentication with the
 * `admin` scope.
 *
 * Pagination (issue #1361):
 *   - `source=db` (the Postgres-backed audit trail) is cursor-paginatable.
 *     Pass an opaque `cursor` — returned as `meta.nextCursor` — to resume
 *     after the last row of the previous page. Keyset paging never deep-skips,
 *     so a page costs the same at any depth, which is what makes the endpoint
 *     viable for enterprise accounts with tens of thousands of rows. In cursor
 *     mode the response is `{ data, nextCursor, hasMore }` (no expensive
 *     COUNT is run). Offset paging via `page` / `limit` remains supported for
 *     legacy consumers and still returns `meta.total`.
 *   - `cursor` cannot be combined with `page`, and is rejected (400) for the
 *     on-chain sources, which have no indexed keyset to page on.
 *   - `order` (`asc` | `desc`) sorts by timestamp in both pagination modes.
 *
 * Combined filters: `actor` (substring, case-insensitive), `action` (exact),
 * a `since` / `until` timestamp range (Unix seconds or ISO 8601).
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue #365),
 *                  queryable by action/target;
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

    const { page, limit, source } = parsed.data;
    const direction = parsed.data.order === "asc" ? "asc" : "desc";
    const hasFilters = Boolean(
      parsed.data.actor ||
        parsed.data.action ||
        parsed.data.resource != null ||
        parsed.data.since != null ||
        parsed.data.until != null
    );

    // ── Cursor (keyset) pagination — issue #1361 ─────────────────
    // Deep offset pages force Postgres to scan and discard every skipped row,
    // which is what degrades plans and latency on large audit tables. Cursor
    // pagination resumes *after* the last row of the previous page instead.
    //
    // Keyset is the default for the Postgres-backed source (an explicit `page`
    // opts back into the legacy offset window, and the on-chain sources, which
    // have no indexed key to page on, always use it).
    const explicitPage = searchParams.get("page");
    const rawCursor = searchParams.get("cursor");
    if (rawCursor && source !== "db") {
      return badRequestError(
        "cursor pagination is only supported with source=db"
      );
    }
    if (rawCursor && explicitPage) {
      return badRequestError("page and cursor cannot both be used");
    }
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return badRequestError("Invalid cursor");
    }
    const keysetMode = source === "db" && (cursor !== null || explicitPage === null);
    // Counting is the expensive half of pagination, so it stays opt-in in
    // keyset mode — same contract as GET /api/payments.
    const includeTotal = searchParams.get("includeTotal") === "true";

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
    // ids (issue #365), served with keyset pagination (issue #1361).
    let dbRows: DbAuditRow[] = [];
    let dbTotal = 0;
    let dbNextCursor: string | null = null;
    let dbHasMore = false;
    if (source === "db" || source === "all") {
      if (keysetMode) {
        // Keyset page: `limit + 1` rows reveal whether another page exists, so
        // the COUNT that makes deep offset pages expensive is opt-in only.
        const rows = await prisma.auditLog.findMany({
          where: buildCursorWhere(dbWhere, cursor, direction),
          orderBy: keysetOrderBy(direction),
          take: limit + 1,
        });
        const { nextCursor, hasMore } = computeNextCursor(rows, limit);
        dbRows = rows.slice(0, limit).map(mapDbRow);
        dbNextCursor = nextCursor;
        dbHasMore = hasMore;
        if (includeTotal) dbTotal = await prisma.auditLog.count({ where: dbWhere });
      } else {
        // Offset page (legacy). The COUNT still drives page navigation for
        // callers that use it, and `order` applies in both directions now.
        const [rows, total] = await Promise.all([
          prisma.auditLog.findMany({
            where: dbWhere,
            orderBy: keysetOrderBy(direction),
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.auditLog.count({ where: dbWhere }),
        ]);
        dbRows = rows.map(mapDbRow);
        dbTotal = total;
        dbHasMore = page * limit < total;
        // Hand out the keyset anchor so offset callers can migrate to cursor
        // paging on the next request.
        dbNextCursor =
          dbHasMore && rows.length > 0
            ? cursorFromRow(rows[rows.length - 1])
            : null;
      }
    }

    if (source === "db") {
      return successResponse(
        dbRows,
        keysetMode
          ? {
              ...(includeTotal ? { page, total: dbTotal } : {}),
              limit,
              nextCursor: dbNextCursor,
              hasMore: dbHasMore,
            }
          : {
              page,
              limit,
              total: dbTotal,
              nextCursor: dbNextCursor,
              hasMore: dbHasMore,
            }
      );
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
