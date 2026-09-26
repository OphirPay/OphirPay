// SPDX-License-Identifier: MIT

import type { PaymentStatus, Prisma } from "@prisma/client";

import { buildFallbackWhere } from "@/lib/full-text-search";
import { decodeCursor } from "@/lib/pagination-utils";
import {
  type PaymentSort,
  validatePaymentSortParams,
} from "@/lib/payments-sort";
import { isValidDateString } from "@/lib/query-params";

export const PAYMENT_STATUS_OPTIONS = [
  "RECORDED",
  "CANCELLED",
  "CREATED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

export const ALLOWED_PAGE_SIZES = [10, 25, 50] as const;
export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Parsed and sanitized URL query parameter state for the payments list.
 */
export interface ParsedPaymentQueryParams {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
  sort: PaymentSort;
  page: number;
  pageSize: number;
  cursor?: string;
  invalidParams: string[];
}

/**
 * Extract, validate, and sanitize payment query parameters from URLSearchParams.
 * Any malformed or unrecognized values fall back to safe defaults, and their
 * parameter keys are recorded in `invalidParams` so the UI can notify the user.
 */
export function parsePaymentQueryParams(
  searchParams: URLSearchParams
): ParsedPaymentQueryParams {
  const invalidParams: string[] = [];

  // Search: accept ?search= or legacy ?q=
  const rawSearch = searchParams.get("search") ?? searchParams.get("q") ?? "";
  const search = rawSearch.trim();

  // Status filter
  const rawStatus = searchParams.get("status");
  let status = "";
  if (rawStatus !== null && rawStatus !== "") {
    const normalized = rawStatus.toUpperCase();
    if (PAYMENT_STATUS_OPTIONS.includes(normalized as (typeof PAYMENT_STATUS_OPTIONS)[number])) {
      status = normalized;
    } else {
      invalidParams.push("status");
    }
  }

  // Asset filter
  const rawAsset = searchParams.get("asset");
  let asset = "";
  if (rawAsset !== null && rawAsset !== "") {
    const trimmed = rawAsset.trim();
    if (/^[A-Za-z0-9]{1,12}$/.test(trimmed)) {
      asset = trimmed.toUpperCase();
    } else {
      invalidParams.push("asset");
    }
  }

  // Date filters (YYYY-MM-DD)
  const rawDateFrom = searchParams.get("dateFrom");
  let dateFrom = "";
  if (rawDateFrom !== null && rawDateFrom !== "") {
    if (isValidDateString(rawDateFrom)) {
      dateFrom = rawDateFrom;
    } else {
      invalidParams.push("dateFrom");
    }
  }

  const rawDateTo = searchParams.get("dateTo");
  let dateTo = "";
  if (rawDateTo !== null && rawDateTo !== "") {
    if (isValidDateString(rawDateTo)) {
      dateTo = rawDateTo;
    } else {
      invalidParams.push("dateTo");
    }
  }

  // Sorting
  const sortResult = validatePaymentSortParams(searchParams);
  if (sortResult.invalidParams.length > 0) {
    invalidParams.push(...sortResult.invalidParams);
  }
  const sort = sortResult.sort;

  // Pagination: page
  const rawPage = searchParams.get("page");
  let page = 1;
  if (rawPage !== null && rawPage !== "") {
    const num = parseInt(rawPage, 10);
    if (!Number.isNaN(num) && num >= 1 && String(num) === rawPage.trim()) {
      page = num;
    } else {
      invalidParams.push("page");
    }
  }

  // Pagination: pageSize
  const rawPageSize = searchParams.get("pageSize");
  let pageSize = DEFAULT_PAGE_SIZE;
  if (rawPageSize !== null && rawPageSize !== "") {
    const num = parseInt(rawPageSize, 10);
    if (ALLOWED_PAGE_SIZES.includes(num as AllowedPageSize)) {
      pageSize = num;
    } else {
      invalidParams.push("pageSize");
    }
  }

  // Keyset cursor
  const rawCursor = searchParams.get("cursor");
  let cursor: string | undefined = undefined;
  if (rawCursor !== null && rawCursor !== "") {
    const decoded = decodeCursor(rawCursor);
    if (decoded) {
      cursor = rawCursor;
    } else {
      invalidParams.push("cursor");
    }
  }

  return {
    search,
    status,
    asset,
    dateFrom,
    dateTo,
    sort,
    page,
    pageSize,
    cursor,
    invalidParams,
  };
}

/**
 * Build URL search parameters for sharing a filtered, sorted view.
 * Ephemeral pagination state (page, cursor) is stripped so the recipient
 * starts cleanly on page 1 of the filtered results.
 */
export function buildShareablePaymentQuery(params: {
  search?: string;
  status?: string;
  asset?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: PaymentSort;
}): URLSearchParams {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.status?.trim()) q.set("status", params.status.trim());
  if (params.asset?.trim()) q.set("asset", params.asset.trim());
  if (params.dateFrom?.trim()) q.set("dateFrom", params.dateFrom.trim());
  if (params.dateTo?.trim()) q.set("dateTo", params.dateTo.trim());
  if (params.sort?.key) {
    q.set("sort", params.sort.key);
    q.set("dir", params.sort.dir);
  }
  return q;
}

/**
 * Build the full shareable URL with base pathname.
 */
export function buildShareablePaymentUrl(
  pathname: string,
  params: {
    search?: string;
    status?: string;
    asset?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: PaymentSort;
  }
): string {
  const query = buildShareablePaymentQuery(params).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Serialize full active payments state into URLSearchParams for in-app navigation.
 */
export function buildPaymentUrlSearchParams(params: {
  search?: string;
  status?: string;
  asset?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: PaymentSort;
  page?: number;
  pageSize?: number;
  cursor?: string | null;
}): URLSearchParams {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.status?.trim()) q.set("status", params.status.trim());
  if (params.asset?.trim()) q.set("asset", params.asset.trim());
  if (params.dateFrom?.trim()) q.set("dateFrom", params.dateFrom.trim());
  if (params.dateTo?.trim()) q.set("dateTo", params.dateTo.trim());

  if (params.sort?.key) {
    q.set("sort", params.sort.key);
    q.set("dir", params.sort.dir);
  }

  if (params.page && params.page > 1) {
    q.set("page", String(params.page));
  }

  if (params.pageSize && params.pageSize !== DEFAULT_PAGE_SIZE) {
    q.set("pageSize", String(params.pageSize));
  }

  if (params.cursor) {
    q.set("cursor", params.cursor);
  }

  return q;
}

/**
 * Filters shared by the payment list route (GET /api/payments) and the
 * server-side CSV export (GET /api/payments/export).
 */
export interface PaymentFilters {
  status?: string;
  search?: string;
}

export function buildPaymentWhere(
  userId: string,
  filters: PaymentFilters = {}
): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = { userId };
  if (filters.status) {
    where.status = filters.status as PaymentStatus;
  }
  if (filters.search) {
    const or = buildFallbackWhere("Payment", filters.search);
    if (or.length > 0) where.OR = or;
  }
  return where;
}

