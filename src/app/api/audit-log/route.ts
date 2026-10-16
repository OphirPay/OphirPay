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
  encodeAuditCursor,
  decodeAuditCursor,
  compareAuditEntries,
  auditEntryAfterCursor,
  AUDIT_PAGE_DEFAULT,
  AUDIT_PAGE_MAX,
  type AuditLogEntry,
} from "@/lib/audit-log";

/**
 * GET /api/audit-log
 *
 * Returns audit log entries. Requires API-key authentication with the
 * `admin` scope.
 *
 * Cursor pagination (issue #1361): pass `cursor` (opaque base64url token from
 * `meta.nextCursor` of the previous page) and optionally `sort` (allowlisted:
 * id | timestamp | action | actor) and `order` (asc | desc, default desc).
 * `limit` defaults to 20 and is capped at 100. Ordering is stable: the entry
 * id is an immutable tiebreaker, so pages never repeat or skip rows when sort
 * keys collide. The legacy `page` / `limit` offset mode remains available.
 *
 * Combined filters: `actor` (substring, case-insensitive), `action` (exact),
 * a `since` / `until` timestamp range (Unix seconds or ISO 8601).
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue
 *                  #365), queryable by action/target;
 *   - `contract` → the on-chain immutable audit ledger (default), filtered
 *                  server-side;
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
      cursor: param("cursor"),
      sort: param("sort"),
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const q = parsed.data;
    const { source } = q;

    const filters = {
      actor: q.actor?.toLowerCase(),
      action: q.action,
      resource: q.resource,
      since:
        q.since != null
          ? (parseAuditTimestamp(q.since) ?? undefined)
          : undefined,
      until:
        q.until != null
          ? (parseAuditTimestamp(q.until) ?? undefined)
          : undefined,
    };
    const dbWhere = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actor ? { actor: { contains: q.actor } } : {}),
      ...(filters.resource != null ? { target: String(filters.resource) } : {}),
    };
    const hasFilters = Boolean(
      filters.actor || filters.action || filters.resource != null ||
        filters.since != null || filters.until != null
    );

    // ── Cursor pagination mode (issue #1361) ───────────────────
    // Opt-in: activated by `cursor` or `sort`. A bare `page` request keeps the
    // legacy offset behaviour below.
    const cursorMode = q.cursor != null || param("sort") != null;
    if (cursorMode) {
      const limit = Math.min(
        Math.max(q.limit ?? AUDIT_PAGE_DEFAULT, 1),
        AUDIT_PAGE_MAX
      );
      const sortField = q.sort;
      const direction = q.order;

      let cursor: ReturnType<typeof decodeAuditCursor> = null;
      if (q.cursor != null) {
        cursor = decodeAuditCursor(q.cursor);
        if (!cursor) {
          return badRequestError("Invalid `cursor` parameter");
        }
      }

      if (source === "contract") {
        // Walk the ledger in id order, apply filters + cursor predicate, sort
        // on the allowlisted field with the id tiebreaker, take one page.
        const totalCount = await readAuditLogTotalCount();
        if (totalCount === 0) {
          return successResponse([], {
            limit,
            sort: sortField,
            order: direction,
            total: 0,
            nextCursor: null,
            hasMore: false,
          });
        }

        const pool: AuditLogEntry[] = [];
        const step = direction === "desc" ? -1 : 1;
        const first = direction === "desc" ? totalCount : 1;
        const last = direction === "desc" ? 1 : totalCount;
        // Bound the scan: at most `limit` pages' worth of candidates so a
        // filtered request cannot walk the whole chain unboundedly.
        const maxScan = Math.min(totalCount, limit * 5);

        outer: for (
          let offset = 0;
          offset < maxScan;
          offset += AUDIT_PAGE_MAX
        ) {
          const batch: number[] = [];
          for (let i = 0; i < AUDIT_PAGE_MAX; i++) {
            const id = first + step * (offset + i);
            if (direction === "desc" ? id < last : id > last) break;
            batch.push(id);
          }
          if (batch.length === 0) break;
          const results = await Promise.all(
            batch.map((id) => readAuditEntryById(id))
          );
          for (const entry of results) {
            if (!entry) continue;
            if (hasFilters && !matchesFilters(entry, filters)) continue;
            if (cursor && !auditEntryAfterCursor(entry, cursor, sortField, direction))
              continue;
            pool.push(entry);
            if (pool.length >= limit * 2) break outer;
          }
        }

        pool.sort((a, b) => compareAuditEntries(a, b, sortField, direction));
        const pageItems = pool.slice(0, limit);
        const hasMore = pool.length > limit;
        const lastEntry = pageItems[pageItems.length - 1];
        return successResponse(pageItems, {
          limit,
          sort: sortField,
          order: direction,
          total: totalCount,
          nextCursor: hasMore && lastEntry
            ? encodeAuditCursor(lastEntry, sortField)
            : null,
          hasMore,
        });
      }

      // DB / all: reuse the DB window with cursor + in-memory stable sort.
      const raw =
        source === "db" || source === "all"
          ? await prisma.auditLog.findMany({
              where: dbWhere,
              orderBy: { createdAt: "desc" },
              take: AUDIT_PAGE_MAX,
            })
          : [];
      const dbTotal =
        source === "db" || source === "all"
          ? await prisma.auditLog.count({ where: dbWhere })
          : 0;

      const asEntries: AuditLogEntry[] = raw.map((r) => ({
        id: Number(r.id) || 0,
        timestamp: new Date(r.createdAt).getTime(),
        action: r.action,
        actor: r.actor ?? "",
        target_id: Number(r.target) || 0,
        details:
          typeof r.details === "string"
            ? r.details
            : r.details != null
              ? JSON.stringify(r.details)
              : "",
      }));
      let pool = cursor
        ? asEntries.filter((e) => auditEntryAfterCursor(e, cursor, sortField, direction))
        : asEntries;
      pool = pool
        .sort((a, b) => compareAuditEntries(a, b, sortField, direction))
        .slice(0, limit);

      const hasMore = pool.length === limit;
      const lastEntry = pool[pool.length - 1];
      const data =
        source === "all"
          ? [
              ...pool.map((e) => mapDbRowRaw(e)),
              // On-chain part when source=all
              ...(await readContractPageForAll(
                cursor,
                sortField,
                direction,
                filters,
                limit
              )),
            ]
          : pool.map((e) => mapDbRowRaw(e));

      const contractPart = source === "all" ? data.length - pool.length : 0;
      const effectiveLast =
        source === "all" && contractPart > 0 ? undefined : lastEntry;
      return successResponse(data, {
        limit,
        sort: sortField,
        order: direction,
        total: dbTotal + (source === "all" ? await readAuditLogTotalCount() : 0),
        nextCursor:
          hasMore && effectiveLast
            ? encodeAuditCursor(effectiveLast, sortField)
            : null,
        hasMore,
      });
    }

    // ── Legacy offset pagination (page / limit) ─────────────────
    const { page, limit } = q;

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
    const descending = q.order !== "asc";
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

/** Adapt an entry-shaped DB row back into the DbAuditRow wire shape. */
function mapDbRowRaw(e: {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}): DbAuditRow {
  return {
    id: String(e.id),
    timestamp: e.timestamp,
    action: e.action,
    actor: e.actor,
    target_id: String(e.target_id),
    details: e.details,
  };
}

/** On-chain tail used by the cursor mode when source=all. */
async function readContractPageForAll(
  cursor: ReturnType<typeof decodeAuditCursor>,
  sortField: Parameters<typeof compareAuditEntries>[2],
  direction: "asc" | "desc",
  filters: Parameters<typeof matchesFilters>[1],
  limit: number
): Promise<AuditLogEntry[]> {
  const totalCount = await readAuditLogTotalCount();
  if (totalCount === 0) return [];
  const pool: AuditLogEntry[] = [];
  const step = direction === "desc" ? -1 : 1;
  const first = direction === "desc" ? totalCount : 1;
  const maxScan = Math.min(totalCount, limit * 5);
  outer: for (let offset = 0; offset < maxScan; offset += AUDIT_PAGE_MAX) {
    const batch: number[] = [];
    for (let i = 0; i < AUDIT_PAGE_MAX; i++) {
      const id = first + step * (offset + i);
      if (direction === "desc" ? id < 1 : id > totalCount) break;
      batch.push(id);
    }
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map((id) => readAuditEntryById(id)));
    for (const entry of results) {
      if (!entry) continue;
      if (filters.actor || filters.action || filters.resource != null ||
          filters.since != null || filters.until != null) {
        if (!matchesFilters(entry, filters)) continue;
      }
      if (cursor && !auditEntryAfterCursor(entry, cursor, sortField, direction))
        continue;
      pool.push(entry);
      if (pool.length >= limit) break outer;
    }
  }
  pool.sort((a, b) => compareAuditEntries(a, b, sortField, direction));
  return pool.slice(0, limit);
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));
