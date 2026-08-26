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
