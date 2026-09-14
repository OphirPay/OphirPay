"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback, useMemo } from "react";

interface UsePaginationOptions {
  total: number;
  initialPage?: number;
  initialLimit?: number;
}

interface PaginationState {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Client-side pagination hook for tables and lists.
 *
 * @example
 * Paginate a list of payments fetched from the API:
 *
 * ```tsx
 * function PaymentsTable() {
 *   const { page, limit, totalPages, hasNext, hasPrev, next, prev, goTo } =
 *     usePagination({ total: 120, initialPage: 1, initialLimit: 20 });
 *
 *   const { data } = useApiQuery<Payment[]>(
 *     ["payments", page, limit],
 *     `/api/payments?page=${page}&limit=${limit}`,
 *   );
 *
 *   return (
 *     <>
 *       {data?.map((p) => <Row key={p.id} payment={p} />)}
 *       <button onClick={prev} disabled={!hasPrev}>Previous</button>
 *       <button onClick={next} disabled={!hasNext}>Next</button>
 *     </>
 *   );
 * }
 * ```
 */
export function usePagination({ total, initialPage = 1, initialLimit = 20 }: UsePaginationOptions) {
  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  const next = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const prev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  const goTo = useCallback((p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  }, [totalPages]);

  const state: PaginationState = useMemo(
    () => ({ page, limit, totalPages, hasNext, hasPrev }),
    [page, limit, totalPages, hasNext, hasPrev]
  );

  return { ...state, next, prev, goTo, setLimit, setPage };
}
