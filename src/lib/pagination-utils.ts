// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * Pagination computation utilities shared between client and server.
 */

// ── Keyset (cursor) pagination ────────────────────────────────

/**
 * Opaque cursor payload for keyset pagination.
 *
 * The cursor identifies the last row of the previous page so the next page
 * can continue from it with a `createdAt DESC, id DESC` tiebreak — this
 * gives stable ordering under concurrent inserts, unlike offset pagination
 * which can skip/duplicate rows when new records are written mid-paging.
 */
export interface CursorPayload {
  /** ISO-8601 timestamp of the anchor row (createdAt). */
  createdAt: string;
  /** Stable unique id of the anchor row (id) — the tiebreaker. */
  id: string;
}

/** Keyset sort direction. The `orderBy` and the cursor comparison must agree. */
export type SortDirection = "asc" | "desc";

const cursorPayloadSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.string().min(1).max(64),
});

/**
 * Encode a cursor payload into an opaque, URL-safe token.
 *
 * The token is base64url of JSON — opaque to clients (they must not parse or
 * build it) and safe to embed in query strings.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decode and validate an opaque cursor token.
 *
 * Returns `null` for anything that is not a well-formed, schema-valid cursor
 * (non-base64, tampered JSON, wrong shape, invalid date) so callers can
 * reject it with a 400.
 */
export function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    );
    const result = cursorPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ── Offset pagination metadata ────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Compute pagination metadata from raw parameters.
 */
export function computePagination(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Compute skip/take values for Prisma queries.
 */
export function prismaPagination(page: number, limit: number) {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

// ── Keyset query building ─────────────────────────────────────
//
// Offset pagination (`skip: (page - 1) * limit`) degrades on large tables:
// the database must scan and discard `skip` rows on every page. Keyset
// pagination instead remembers the last row of the previous page and asks
// for rows strictly after it — the query is index-friendly and each page
// costs the same regardless of depth.

/**
 * Combine the base filter with the keyset condition for `createdAt <dir>,
 * id <dir>` ordering. Uses `AND` so a cursor never collides with the base
 * filter's own `OR` (e.g. search terms).
 *
 * The cursor is a strict inequality on the composite sort key
 * (`createdAt`, `id`), so the next page resumes exactly after the anchor row:
 * no row is skipped and none is returned twice, even when many rows share the
 * same `createdAt` (the numeric/tiebreak `id` disambiguates them).
 *
 * Defaults to `desc`, matching the newest-first ordering most list endpoints use.
 */
export function buildCursorWhere(
  baseWhere: Record<string, unknown>,
  cursor: CursorPayload | null,
  direction: SortDirection = "desc"
): Record<string, unknown> {
  if (!cursor) return baseWhere;
  const cmp = direction === "asc" ? "gt" : "lt";
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { createdAt: { [cmp]: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { [cmp]: cursor.id } },
        ],
      },
    ],
  };
}

/**
 * `orderBy` for a keyset query. The cursor key (`createdAt`, then the unique
 * `id` tiebreaker) must sort the same way as {@link buildCursorWhere} compares,
 * otherwise pages overlap or skip.
 */
export function keysetOrderBy(
  direction: SortDirection = "desc"
): { createdAt?: SortDirection; id?: SortDirection }[] {
  return [{ createdAt: direction }, { id: direction }];
}

/** Encode a cursor anchored at `row` (conventionally the page's last row). */
export function cursorFromRow(row: {
  createdAt: Date | string;
  id: string;
}): string {
  return encodeCursor({
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    id: row.id,
  });
}

/**
 * Given `limit + 1` fetched rows, derive the next page cursor and whether
 * more rows exist. The extra row is discarded and never returned to callers.
 */
export function computeNextCursor<T extends { createdAt: Date | string; id: string }>(
  rows: T[],
  limit: number
): { nextCursor: string | null; hasMore: boolean } {
  if (rows.length <= limit) {
    return { nextCursor: null, hasMore: false };
  }
  return { nextCursor: cursorFromRow(rows[limit - 1]), hasMore: true };
}
