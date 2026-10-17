"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface PaginationProps {
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  onPage?: (page: number) => void;
  className?: string;
}

/**
 * Pagination controls for tables and lists (#1305).
 * Shows prev/next buttons with page indicator, quick-jump, and full keyboard accessibility.
 */
export function Pagination({
  page,
  totalPages,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
  onPage,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  // Build page numbers to show: [1, ..., page-1, page, page+1, ..., totalPages]
  const pages: (number | "ellipsis")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between gap-4", className)}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={!hasPrev}
        aria-label="Previous page"
      >
        ← Previous
      </Button>

      <div className="hidden sm:flex items-center gap-1">
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e-${i}`} className="px-1 text-gray-400" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-label={`Page ${p}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPage?.(p)}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500 focus-visible:ring-offset-1",
                p === page
                  ? "bg-ophir-600 text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              {p}
            </button>
          )
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        aria-label="Next page"
      >
        Next →
      </Button>
    </nav>
  );
}
