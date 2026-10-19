/**
 * Cursor-based Pagination & Sorting Helper for /api/audit-log (Issue #1361)
 * Author: @lienhoatienphung-svg
 */

export type AuditLogSortField = "createdAt" | "action" | "actorId" | "resourceType";
export type SortOrder = "asc" | "desc";

export interface AuditLogPaginationParams {
  cursor?: string | null;
  limit?: number;
  sortBy?: AuditLogSortField;
  sortOrder?: SortOrder;
}

export interface DecodedAuditCursor {
  id: string;
  sortValue: string | number;
}

const ALLOWED_SORT_FIELDS: ReadonlySet<AuditLogSortField> = new Set([
  "createdAt",
  "action",
  "actorId",
  "resourceType",
]);

export function parseAuditLogQueryParams(searchParams: URLSearchParams): Required<AuditLogPaginationParams> {
  const rawLimit = Number(searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 100) : 25;

  const rawSortBy = (searchParams.get("sortBy") ?? "createdAt") as AuditLogSortField;
  const sortBy: AuditLogSortField = ALLOWED_SORT_FIELDS.has(rawSortBy) ? rawSortBy : "createdAt";

  const rawOrder = (searchParams.get("sortOrder") ?? "desc").toLowerCase();
  const sortOrder: SortOrder = rawOrder === "asc" ? "asc" : "desc";

  const cursor = searchParams.get("cursor") || null;
  return { cursor, limit, sortBy, sortOrder };
}

export function encodeAuditCursor(record: { id: string; [key: string]: unknown }, sortBy: AuditLogSortField): string {
  const rawVal = record[sortBy];
  const sortValue = rawVal instanceof Date ? rawVal.toISOString() : String(rawVal ?? "");
  return Buffer.from(JSON.stringify({ id: record.id, sortValue }), "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string | null | undefined): DecodedAuditCursor | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.id === "string" && parsed.sortValue !== undefined) {
      return { id: parsed.id, sortValue: parsed.sortValue };
    }
    return null;
  } catch {
    return null;
  }
}

export function paginateAndSortAuditLogs<T extends { id: string; createdAt: string | Date; [key: string]: unknown }>(
  items: T[],
  params: AuditLogPaginationParams,
): {
  data: T[];
  pageInfo: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
    sortBy: AuditLogSortField;
    sortOrder: SortOrder;
  };
} {
  const limit = Math.min(Math.max(1, params.limit ?? 25), 100);
  const sortBy: AuditLogSortField = params.sortBy && ALLOWED_SORT_FIELDS.has(params.sortBy) ? params.sortBy : "createdAt";
  const sortOrder: SortOrder = params.sortOrder === "asc" ? "asc" : "desc";
  const dir = sortOrder === "asc" ? 1 : -1;

  const sorted = [...items].sort((a, b) => {
    const va = a[sortBy] instanceof Date ? (a[sortBy] as Date).toISOString() : String(a[sortBy] ?? "");
    const vb = b[sortBy] instanceof Date ? (b[sortBy] as Date).toISOString() : String(b[sortBy] ?? "");
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return a.id.localeCompare(b.id) * dir;
  });

  const decoded = decodeAuditCursor(params.cursor);
  let startIndex = 0;
  if (decoded) {
    const idx = sorted.findIndex((item) => item.id === decoded.id);
    if (idx !== -1) startIndex = idx + 1;
  }

  const slice = sorted.slice(startIndex, startIndex + limit + 1);
  const hasNextPage = slice.length > limit;
  const data = hasNextPage ? slice.slice(0, limit) : slice;
  const nextCursor = hasNextPage && data.length > 0 ? encodeAuditCursor(data[data.length - 1], sortBy) : null;

  return {
    data,
    pageInfo: {
      nextCursor,
      hasNextPage,
      limit,
      sortBy,
      sortOrder,
    },
  };
}
