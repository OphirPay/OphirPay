"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from "react";

import { SearchIcon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { useApiMutation, useApiQuery } from "@/hooks/useApiQuery";
import { useDebounce } from "@/hooks/useDebounce";
import {
  getPreferredStellarExplorer,
  getStellarExplorerUrl,
  type StellarExplorerId,
} from "@/lib/stellar";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";

/** Shape returned by GET /api/scheduled (amount pre-serialized as string). */
export interface ScheduledPaymentRow {
  id: string;
  amount: string;
  assetCode: string;
  destAddress: string;
  memo?: string | null;
  scheduledAt: string;
  status: "SCHEDULED" | "PROCESSING" | "EXECUTED" | "FAILED" | "CANCELLED";
  transactionHash?: string | null;
  errorMessage?: string | null;
}

const STATUS_STYLES: Record<ScheduledPaymentRow["status"], string> = {
  SCHEDULED:
    "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-700",
  PROCESSING:
    "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700",
  EXECUTED:
    "bg-green-100 text-green-900 border border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-700",
  FAILED:
    "bg-red-100 text-red-900 border border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-700",
  CANCELLED:
    "bg-gray-200 text-gray-800 border border-gray-400 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-600",
};

const STATUS_INDICATORS: Record<ScheduledPaymentRow["status"], string> = {
  SCHEDULED: "◷",
  PROCESSING: "⟳",
  EXECUTED: "✓",
  FAILED: "✕",
  CANCELLED: "⊘",
};

export interface ScheduledPaymentsListProps {
  /** Optional debounce delay in ms for the search input (defaults to 300ms; set to 0 in tests for immediate filtering). */
  debounceMs?: number;
}

/**
 * List of the user's upcoming (and recently processed) scheduled payments,
 * with a cancel action for those still waiting to be sent, and a client-side
 * search and memo filter matching payments by recipient address or memo.
 */
export default function ScheduledPaymentsList({
  debounceMs = 300,
}: ScheduledPaymentsListProps = {}) {
  const toast = useToast();
  const [explorer, setExplorer] = useState<StellarExplorerId>(() =>
    getPreferredStellarExplorer()
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, debounceMs);

  useEffect(() => {
    setExplorer(getPreferredStellarExplorer());
    const onExplorerChanged = () => {
      setExplorer(getPreferredStellarExplorer());
    };
    window.addEventListener("ophirpay:explorer-changed", onExplorerChanged);
    window.addEventListener("storage", onExplorerChanged);
    return () => {
      window.removeEventListener("ophirpay:explorer-changed", onExplorerChanged);
      window.removeEventListener("storage", onExplorerChanged);
    };
  }, []);

  const { data, isLoading } = useApiQuery<ScheduledPaymentRow[]>(
    ["scheduled"],
    "/api/scheduled"
  );
  const cancelMutation = useApiMutation<{ id: string }, { id: string; status: string }>(
    (body) => `/api/scheduled?id=${encodeURIComponent(body.id)}`,
    { method: "DELETE", invalidateKeys: [["scheduled"]] }
  );

  const payments = useMemo(
    () => (Array.isArray(data) ? data : []),
    [data]
  );
  const effectiveSearch = debounceMs === 0 ? search : debouncedSearch;

  const filteredPayments = useMemo(() => {
    const query = effectiveSearch.trim().toLowerCase();
    if (!query) return payments;
    return payments.filter((payment) => {
      const destMatch = payment.destAddress.toLowerCase().includes(query);
      const memoMatch =
        typeof payment.memo === "string"
          ? payment.memo.toLowerCase().includes(query)
          : false;
      return destMatch || memoMatch;
    });
  }, [payments, effectiveSearch]);

  const handleCancel = async (id: string) => {
    try {
      await cancelMutation.mutateAsync({ id });
      toast.success("Scheduled payment cancelled");
    } catch {
      toast.error("Failed to cancel scheduled payment");
    }
  };

  const hasPayments = payments.length > 0;
  const isSearching = search.trim().length > 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Scheduled Payments
        </h2>
        {hasPayments && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {isSearching
              ? `${filteredPayments.length} of ${payments.length} upcoming`
              : `${payments.length} upcoming`}
          </span>
        )}
      </div>

      {!isLoading && hasPayments && (
        <div className="relative mb-4">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search scheduled payments"
            placeholder="Search by address or memo..."
            className="w-full pl-9 pr-16 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ophir-600 hover:text-ophir-700 dark:text-ophir-400 dark:hover:text-ophir-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : !hasPayments ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No scheduled payments yet. Use the schedule toggle above to send at
          a future date.
        </p>
      ) : filteredPayments.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No scheduled payments match your search.
          </p>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="mt-2 text-xs text-ophir-600 hover:text-ophir-700 dark:text-ophir-400 dark:hover:text-ophir-300 font-medium underline transition-colors"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {filteredPayments.map((payment) => (
            <li
              key={payment.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                  {formatAmount(parseFloat(payment.amount), payment.assetCode)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  To {shortenAddress(payment.destAddress, 6)} ·{" "}
                  {formatDate(payment.scheduledAt)}
                  {payment.memo ? ` · ${payment.memo}` : ""}
                </p>
                {payment.status === "FAILED" && payment.errorMessage && (
                  <p
                    className="text-xs text-red-700 dark:text-red-300 truncate"
                    title={payment.errorMessage}
                  >
                    {payment.errorMessage}
                  </p>
                )}
                {payment.transactionHash && (
                  <a
                    href={getStellarExplorerUrl(payment.transactionHash, explorer)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`tx-explorer-link-${payment.id}`}
                    className="inline-block mt-0.5 text-xs font-mono text-ophir-600 dark:text-ophir-400 hover:underline"
                  >
                    View tx {shortenAddress(payment.transactionHash, 4)}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[payment.status]}`}
                >
                  <span aria-hidden="true">{STATUS_INDICATORS[payment.status]}</span>
                  <span>{payment.status.replace(/_/g, " ").toLowerCase()}</span>
                </span>
                {payment.status === "SCHEDULED" && (
                  <button
                    onClick={() => handleCancel(payment.id)}
                    disabled={cancelMutation.isPending}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
