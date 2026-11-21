"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useApiQuery, useApiMutation } from "@/hooks/useApiQuery";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

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
  SCHEDULED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  PROCESSING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  EXECUTED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * List of the user's upcoming (and recently processed) scheduled payments,
 * with a cancel action for those still waiting to be sent.
 */
export default function ScheduledPaymentsList() {
  const toast = useToast();
  const { data, isLoading } = useApiQuery<ScheduledPaymentRow[]>(
    ["scheduled"],
    "/api/scheduled"
  );
  const cancelMutation = useApiMutation<{ id: string }, { id: string; status: string }>(
    (body) => `/api/scheduled?id=${encodeURIComponent(body.id)}`,
    { method: "DELETE", invalidateKeys: [["scheduled"]] }
  );

  const payments = Array.isArray(data) ? data : [];
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPayments = payments.filter((payment) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchesAddress = payment.destAddress.toLowerCase().includes(q);
    const matchesMemo = payment.memo ? payment.memo.toLowerCase().includes(q) : false;
    return matchesAddress || matchesMemo;
  });

  const handleCancel = async (id: string) => {
    try {
      await cancelMutation.mutateAsync({ id });
      toast.success("Scheduled payment cancelled");
    } catch {
      toast.error("Failed to cancel scheduled payment");
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Scheduled Payments
        </h2>
        {payments.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {searchQuery
              ? `${filteredPayments.length} of ${payments.length} matching`
              : `${payments.length} upcoming`}
          </span>
        )}
      </div>

      {payments.length > 0 && (
        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by recipient address or memo..."
            aria-label="Search scheduled payments"
            data-testid="scheduled-search-input"
            className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
          />
          <svg
            className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              data-testid="scheduled-search-clear"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
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
      ) : payments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No scheduled payments yet. Use the schedule toggle above to send at
          a future date.
        </p>
      ) : filteredPayments.length === 0 ? (
        <div className="py-6 text-center" data-testid="scheduled-empty-search">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            No scheduled payments match &ldquo;{searchQuery}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
          >
            Clear search filter
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
                    className="text-xs text-red-600 dark:text-red-400 truncate"
                    title={payment.errorMessage}
                  >
                    {payment.errorMessage}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[payment.status]}`}
                >
                  {payment.status.replace(/_/g, " ").toLowerCase()}
                </span>
                {payment.status === "SCHEDULED" && (
                  <button
                    onClick={() => handleCancel(payment.id)}
                    disabled={cancelMutation.isPending}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
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
