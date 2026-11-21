"use client";
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react";
import { useApiQuery, useApiMutation } from "@/hooks/useApiQuery";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/EmptyState";

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
 * with a search/filter input and a cancel action for those still waiting to be sent.
 */
export default function ScheduledPaymentsList() {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useApiQuery<ScheduledPaymentRow[]>(
    ["scheduled"],
    "/api/scheduled"
  );
  const cancelMutation = useApiMutation<{ id: string }, { id: string; status: string }>(
    (body) => `/api/scheduled?id=${encodeURIComponent(body.id)}`,
    { method: "DELETE", invalidateKeys: [["scheduled"]] }
  );

  const payments = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const filteredPayments = useMemo(() => {
    if (!searchQuery.trim()) return payments;
    const q = searchQuery.toLowerCase().trim();
    return payments.filter(
      (p) =>
        p.destAddress.toLowerCase().includes(q) ||
        (p.memo && p.memo.toLowerCase().includes(q))
    );
  }, [payments, searchQuery]);

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
            {searchQuery.trim()
              ? `${filteredPayments.length} of ${payments.length} matching`
              : `${payments.length} upcoming`}
          </span>
        )}
      </div>

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
      ) : (
        <>
          {/* Search filter input */}
          <div className="relative mb-4">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by recipient address or memo..."
              aria-label="Search scheduled payments"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search query"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {filteredPayments.length === 0 ? (
            <EmptyState
              title="No matching payments"
              description={`No scheduled payments found matching "${searchQuery}".`}
              actionLabel="Clear search"
              onAction={() => setSearchQuery("")}
              icon={
                <svg
                  className="w-8 h-8 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                </svg>
              }
            />
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
        </>
      )}
    </div>
  );
}
