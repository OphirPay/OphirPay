// SPDX-License-Identifier: MIT

import type { PaymentStatus, Prisma } from "@prisma/client";

/**
 * Filters shared by the payment list route (GET /api/payments) and the
 * server-side CSV export (GET /api/payments/export). Keeping them in one
 * place guarantees "export the current filter results" stays true: if the
 * list route starts filtering differently, the export follows automatically
 * instead of silently diverging.
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
    // Prisma only knows the PaymentStatus enum values, so narrow the raw
    // string here. Invalid values surface as a Prisma validation error, the
    // same behavior the list route had before this helper existed.
    where.status = filters.status as PaymentStatus;
  }
  if (filters.search) {
    // Issue #157 — server-side reconciliation search:
    //  - `memo` and `description` are substring matches, case-insensitive for
    //    `memo` (the Postgres ILIKE equivalent via Prisma `mode`), because memo
    //    text users type rarely matches on-chain casing;
    //  - `transactionHash` is an EXACT match — hashes are emitted by the network
    //    in a canonical case, and a partial match would produce false positives
    //    across near-identical hashes.
    where.OR = [
      { description: { contains: filters.search } },
      { memo: { contains: filters.search, mode: "insensitive" } },
      { transactionHash: { equals: filters.search } },
    ];
  }
  return where;
}

// ── Payment list query param parsing and URL persistence ─────────

export const ALLOWED_PAYMENT_STATUSES = ["RECORDED", "CANCELLED"] as const;
export type PaymentStatusFilter = (typeof ALLOWED_PAYMENT_STATUSES)[number];

export const ALLOWED_ASSET_CODES = ["XLM", "USDC"] as const;
export const ALLOWED_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface InvalidParamWarning {
  param: string;
  value: string;
  reason: string;
}

export interface ParsedPaymentQueryParams {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  cursor: string | null;
  sort: PaymentSort;
  includeDeleted: boolean;
  invalidParams: InvalidParamWarning[];
}

import { decodeCursor } from "@/lib/pagination-utils";
import {
  parsePaymentSort,
  validatePaymentSortParams,
  type PaymentSort,
} from "@/lib/payments-sort";

/**
 * Parse and validate payment list URL query parameters.
 * Unknown or malformed values fall back to safe defaults while recording
 * an invalid parameter warning so the UI can clearly indicate fallback behavior
 * instead of returning an empty or broken page.
 */
export function parsePaymentQueryParams(
  params: URLSearchParams
): ParsedPaymentQueryParams {
  const invalidParams: InvalidParamWarning[] = [];

  // Search: accepts ?search= or legacy ?q=
  const rawSearch = params.get("search") ?? params.get("q") ?? "";
  const search = rawSearch.trim();

  // Status
  const rawStatus = params.get("status");
  let status = "";
  if (rawStatus) {
    if ((ALLOWED_PAYMENT_STATUSES as readonly string[]).includes(rawStatus)) {
      status = rawStatus;
    } else {
      invalidParams.push({
        param: "status",
        value: rawStatus,
        reason: `Allowed statuses are: ${ALLOWED_PAYMENT_STATUSES.join(", ")}`,
      });
    }
  }

  // Asset: allow known asset codes or valid 1-12 alphanumeric asset codes
  const rawAsset = params.get("asset");
  let asset = "";
  if (rawAsset) {
    const trimmedAsset = rawAsset.trim().toUpperCase();
    if (/^[A-Z0-9]{1,12}$/.test(trimmedAsset)) {
      asset = trimmedAsset;
    } else {
      invalidParams.push({
        param: "asset",
        value: rawAsset,
        reason: "Asset must be 1-12 alphanumeric characters (e.g., XLM, USDC)",
      });
    }
  }

  // Date from
  const rawDateFrom = params.get("dateFrom");
  let dateFrom = "";
  if (rawDateFrom) {
    const parsedTime = Date.parse(
      rawDateFrom.includes("T") ? rawDateFrom : `${rawDateFrom}T00:00:00`
    );
    if (!Number.isNaN(parsedTime)) {
      dateFrom = rawDateFrom;
    } else {
      invalidParams.push({
        param: "dateFrom",
        value: rawDateFrom,
        reason: "Must be a valid date (YYYY-MM-DD)",
      });
    }
  }

  // Date to
  const rawDateTo = params.get("dateTo");
  let dateTo = "";
  if (rawDateTo) {
    const parsedTime = Date.parse(
      rawDateTo.includes("T") ? rawDateTo : `${rawDateTo}T23:59:59.999`
    );
    if (!Number.isNaN(parsedTime)) {
      dateTo = rawDateTo;
    } else {
      invalidParams.push({
        param: "dateTo",
        value: rawDateTo,
        reason: "Must be a valid date (YYYY-MM-DD)",
      });
    }
  }

  // Page
  const rawPage = params.get("page");
  let page = 1;
  if (rawPage !== null && rawPage !== "") {
    const parsedPage = Number.parseInt(rawPage, 10);
    if (Number.isFinite(parsedPage) && parsedPage >= 1) {
      page = parsedPage;
    } else {
      invalidParams.push({
        param: "page",
        value: rawPage,
        reason: "Page must be a positive integer >= 1",
      });
    }
  }

  // PageSize
  const rawPageSize = params.get("pageSize");
  let pageSize: number = DEFAULT_PAGE_SIZE;
  if (rawPageSize !== null && rawPageSize !== "") {
    const parsedSize = Number.parseInt(rawPageSize, 10);
    if ((ALLOWED_PAGE_SIZES as readonly number[]).includes(parsedSize)) {
      pageSize = parsedSize;
    } else {
      invalidParams.push({
        param: "pageSize",
        value: rawPageSize,
        reason: `Allowed page sizes are: ${ALLOWED_PAGE_SIZES.join(", ")}`,
      });
    }
  }

  // Cursor
  const rawCursor = params.get("cursor");
  let cursor: string | null = null;
  if (rawCursor !== null && rawCursor !== "") {
    if (decodeCursor(rawCursor)) {
      cursor = rawCursor;
    } else {
      invalidParams.push({
        param: "cursor",
        value: rawCursor,
        reason: "Invalid pagination cursor token",
      });
    }
  }

  // Sort
  const sort = parsePaymentSort(params);
  const sortValidation = validatePaymentSortParams(params);
  if (!sortValidation.isValid) {
    invalidParams.push(...sortValidation.invalidParams);
  }

  const includeDeleted = params.get("includeDeleted") === "true";

  return {
    search,
    status,
    asset,
    dateFrom,
    dateTo,
    page,
    pageSize,
    cursor,
    sort,
    includeDeleted,
    invalidParams,
  };
}

/**
 * Build a clean, shareable URL query string.
 * Strips cursor tokens and default pagination entries so shared links
 * open cleanly at the first page of the filtered/sorted dataset.
 */
export function buildShareablePaymentQuery(
  filters: Partial<ParsedPaymentQueryParams>
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.asset) params.set("asset", filters.asset);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.sort?.key) {
    params.set("sort", filters.sort.key);
    if (filters.sort.dir !== "asc") params.set("dir", filters.sort.dir);
  }
  // Keep page and pageSize only if non-default
  if (filters.page && filters.page > 1) {
    params.set("page", String(filters.page));
  }
  if (filters.pageSize && filters.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(filters.pageSize));
  }
  return params;
}
