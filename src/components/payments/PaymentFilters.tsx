"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";

/**
 * Filter toolbar for the payments table (issue #1382).
 *
 * This is a controlled, presentational component: every value comes from the
 * URL query string (via the page) and every change is bubbled up so the page
 * can push a new, shareable URL. Keeping it dumb means the search input can
 * stay a local, immediate value that the page debounces before it touches the
 * URL — the input never lags behind the keystroke, but navigation does not
 * fire once per character.
 */
export interface PaymentFiltersProps {
  /** Immediate (un-debounced) search value so the input tracks every keystroke. */
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  asset: string;
  onAssetChange: (value: string) => void;
  /** Assets present in the current dataset, used to populate the asset filter. */
  assetOptions: string[];
  /** Clears every filter (search, status, dates, asset) and resets paging. */
  onClear: () => void;
  className?: string;
}

const controlClasses =
  "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500";

export function PaymentFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  asset,
  onAssetChange,
  assetOptions,
  onClear,
  className,
}: PaymentFiltersProps) {
  const isFiltered = Boolean(search || status || dateFrom || dateTo || asset);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Search bar */}
      <div className="relative max-w-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search payments"
          placeholder="Search by address, hash, or ID..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          <span className="block mb-1">Status</span>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            className={controlClasses}
          >
            <option value="">All statuses</option>
            <option value="RECORDED">Recorded</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          <span className="block mb-1">From</span>
          <input
            aria-label="Filter from date"
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            className={controlClasses}
          />
        </label>
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          <span className="block mb-1">To</span>
          <input
            aria-label="Filter to date"
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            className={controlClasses}
          />
        </label>
        <label className="block text-sm text-gray-600 dark:text-gray-300">
          <span className="block mb-1">Asset</span>
          <select
            aria-label="Asset filter"
            value={asset}
            onChange={(event) => onAssetChange(event.target.value)}
            className={controlClasses}
          >
            <option value="">All assets</option>
            {assetOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {isFiltered && (
          <button
            type="button"
            onClick={onClear}
            className="justify-self-start text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
