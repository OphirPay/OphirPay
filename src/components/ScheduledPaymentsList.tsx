// SPDX-License-Identifier: MIT

"use client";

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
  FAILED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * List of the user's upcoming (and recently processed) scheduled payments,
 * with a cancel action and real-time search/memo filter for those still waiting.
 */
export default function ScheduledPaymentsList() {
  const [search, setSearch] = useState("");
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

  const filtered = payments.filter(p => {
    const query = search.toLowerCase();
    const matchesAddress = p.destAddress.toLowerCase().includes(query);
    const matchesMemo = (p.memo || "").toLowerCase().includes(query);
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
            {payments.length} upcoming
          </span>
        )}
      </div>

      {payments.length > 0 && (
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search addresses or memos..."
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {payments.length === 0 ? (
            <>No scheduled payments yet. Use the schedule toggle above to send at a future date.</>
          ) : (
            <>No payments match your search.</>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.map((payment) => (
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
