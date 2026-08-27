// SPDX-License-Identifier: MIT

/**
 * Pagination computation utilities shared between client and server.
 */

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

// ── Cursor (keyset) pagination ─────────────────────────────────
//
// Offset pagination (`skip: (page - 1) * limit`) degrades on large tables:
// the database must scan and discard `skip` rows on every page. Keyset
// pagination instead remembers the last row of the previous page and asks
// for rows strictly after it — the query is index-friendly and each page
// costs the same regardless of depth.

/** A page boundary: the last row of the previous page. */
export interface Cursor {
  /** ISO timestamp of the boundary row (ordering column). */
  createdAt: string;
  /** Unique tiebreaker so the boundary is unambiguous on timestamp ties. */
  id: string;
}

function base64UrlEncode(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}

/** Serialize a page boundary into an opaque, URL-safe cursor string. */
export function encodeCursor(cursor: Cursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

/**
 * Parse an opaque cursor string. Returns null for malformed input so callers
 * can reject bad cursors with a 400 instead of crashing the query.
 */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(raw)) as Partial<Cursor>;
    if (
      typeof parsed.createdAt === "string" &&
      parsed.createdAt.length > 0 &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Combine the base filter with the keyset condition for `createdAt desc,
 * id desc` ordering. Uses `AND` so a cursor never collides with the base
 * filter's own `OR` (e.g. search terms).
 */
export function buildCursorWhere(
  baseWhere: Record<string, unknown>,
  cursor: Cursor | null
): Record<string, unknown> {
  if (!cursor) return baseWhere;
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ],
  };
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
  const last = rows[limit - 1];
  return {
    nextCursor: encodeCursor({
      createdAt:
        last.createdAt instanceof Date
          ? last.createdAt.toISOString()
          : last.createdAt,
      id: last.id,
    }),
    hasMore: true,
  };
}
