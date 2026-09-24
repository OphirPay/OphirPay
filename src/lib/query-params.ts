/**
 * Utility functions for parsing and building query parameters used by the
 * payments list page.  These helpers keep the URL in sync with the UI state
 * (search, sort, status filter, cursor) and provide a single source of truth
 * for validation and defaults.
 *
 * The functions are intentionally lightweight and pure so they can be used
 * both on the client (Next.js) and the server (API routes).
 */

export type QueryParams = {
  /** Free‑text search term */
  search?: string;
  /** Sort key, e.g. "createdAt" or "-amount" */
  sort?: string;
  /** Array of status filters, e.g. ["pending", "failed"] */
  status?: string[];
  /** Cursor for pagination (opaque string) */
  cursor?: string;
};

/**
 * Default values used when a query parameter is missing or invalid.
 */
export const DEFAULT_QUERY_PARAMS: QueryParams = {
  search: '',
  sort: 'createdAt',
  status: [],
  cursor: undefined,
};

/**
 * Parse a raw query string (e.g. "?search=foo&sort=-amount") into a
 * {@link QueryParams} object.  Invalid values are replaced with the defaults.
 *
 * @param rawQuery - The raw query string from `window.location.search` or
 *   `URLSearchParams.toString()`.
 */
export function parseQueryParams(rawQuery: string): QueryParams {
  const params = new URLSearchParams(rawQuery);
  const search = params.get('search') ?? DEFAULT_QUERY_PARAMS.search;
  const sort = params.get('sort') ?? DEFAULT_QUERY_PARAMS.sort;
  const statusRaw = params.getAll('status');
  const status = statusRaw.length > 0 ? statusRaw : DEFAULT_QUERY_PARAMS.status;
  const cursor = params.get('cursor') ?? DEFAULT_QUERY_PARAMS.cursor;

  // Basic validation: ensure sort is a non‑empty string
  const validatedSort = typeof sort === 'string' && sort.trim() !== '' ? sort : DEFAULT_QUERY_PARAMS.sort;

  return {
    search,
    sort: validatedSort,
    status,
    cursor: cursor ?? undefined,
  };
}

/**
 * Build a query string from a {@link QueryParams} object.  Empty values are
 * omitted to keep the URL clean.
 *
 * @param params - The query parameters to encode.
 * @returns A string suitable for use in `router.replace` or `URLSearchParams`.
 */
export function buildQueryParams(params: QueryParams): string {
  const qs = new URLSearchParams();

  if (params.search && params.search.trim() !== '') {
    qs.set('search', params.search.trim());
  }

  if (params.sort && params.sort.trim() !== '') {
    qs.set('sort', params.sort.trim());
  }

  if (params.status && params.status.length > 0) {
    params.status.forEach((s) => {
      if (s.trim() !== '') {
        qs.append('status', s.trim());
      }
    });
  }

  if (params.cursor) {
    qs.set('cursor', params.cursor);
  }

  return qs.toString();
}
