"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { useApiMutation,useApiQuery } from "@/hooks/useApiQuery";
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

/**
 * List of the user's upcoming (and recently processed) scheduled payments,
 * with a cancel action for those still waiting to be sent.
 */
export default function ScheduledPaymentsList() {
  const toast = useToast();
  const [explorer, setExplorer] = useState<StellarExplorerId>(() =>
    getPreferredStellarExplorer()
  );

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

  const [searchQuery, setSearchQuery] = useState("");
  const payments = Array.isArray(data) ? data : [];
  
  const filteredPayments = searchQuery.trim() === "" 
    ? payments 
    : payments.filter(p => 
        p.destAddress.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.memo && p.memo.toLowerCase().includes(searchQuery.toLowerCase()))
      );

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
            {payments.length} upcoming
          </span>
        )}
      </div>

      <div className="mb-4 relative">
        <input
          type="text"
          placeholder="Search by recipient or memo..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-3 pr-10 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-medium"
          >
            Clear
          </button>
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
      ) : filteredPayments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No payments match your search.
        </p>
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
