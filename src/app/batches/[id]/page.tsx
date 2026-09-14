"use client";
// SPDX-License-Identifier: MIT

import { useParams } from "next/navigation";
import Link from "next/link";
import { timeAgo, getStatusColor, formatAmount, shortenAddress } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useApiQuery, useApiMutation } from "@/hooks/useApiQuery";
import type { BatchWithProgress } from "@/types";

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: batch,
    isLoading: loading,
    isError: hasError,
    refetch,
  } = useApiQuery<BatchWithProgress>(
    ["batch", id],
    `/api/batches/${id}`
  );

  const retryMutation = useApiMutation<unknown, { retried: number }>(
    () => `/api/batches/${id}`,
    { method: "POST", invalidateKeys: [["batch", id]] }
  );

  const error = hasError ? "Failed to load batch details" : null;

  const handleRetry = () => {
    retryMutation.mutate(undefined, {
      onSuccess: () => {
        refetch();
      },
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb
        items={[
          { label: "Batches", href: "/batches" },
          { label: batch?.name ?? "Batch" },
        ]}
      />

      {loading ? (
        <LoadingSkeleton variant="table" lines={5} />
      ) : error || !batch ? (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">
            {error || "Batch not found"}
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => refetch()}
              className="text-sm text-red-600 dark:text-red-400 underline"
            >
              Try again
            </button>
            <Link
              href="/batches"
              className="text-sm text-gray-500 dark:text-gray-400 underline"
            >
              Back to batches
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {batch.name}
              </h1>
              {batch.description && (
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {batch.description}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Created {timeAgo(batch.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {batch.progress.failed > 0 && (
                <button
                  onClick={handleRetry}
                  disabled={retryMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors active:scale-95 disabled:opacity-50"
                >
                  {retryMutation.isPending ? (
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                  )}
                  Retry Failed ({batch.progress.failed})
                </button>
              )}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${getStatusColor(batch.status).bg} ${getStatusColor(batch.status).text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${getStatusColor(batch.status).dot}`} />
                {batch.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Progress */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Progress
              </h2>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                {batch.progress.percentComplete}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${batch.progress.percentComplete}%`,
                  backgroundColor:
                    batch.progress.failed > 0
                      ? batch.progress.percentComplete === 100
                        ? "#ef4444"
                        : "#f59e0b"
                      : "#10b981",
                }}
              />
            </div>

            {/* Counts */}
            <div className="flex items-center gap-6 mt-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {batch.progress.pending} pending
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {batch.progress.sent} sent
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {batch.progress.failed} failed
                </span>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                {batch.progress.total} total
              </span>
            </div>
          </div>

          {/* Per-item status table */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Items
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                    <th className="py-3 px-5 font-medium">#</th>
                    <th className="py-3 px-5 font-medium">Amount</th>
                    <th className="py-3 px-5 font-medium">Status</th>
                    <th className="py-3 px-5 font-medium">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.items.map((item, i) => {
                    const statusBadge = getItemStatusBadge(item.status);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-gray-100 dark:border-gray-800/50 last:border-0"
                      >
                        <td className="py-3 px-5 text-gray-500 dark:text-gray-400 text-xs font-mono">
                          {i + 1}
                        </td>
                        <td className="py-3 px-5 font-mono font-medium text-gray-900 dark:text-white">
                          {formatAmount(item.amount, item.assetCode)}
                        </td>
                        <td className="py-3 px-5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                            {item.status}
                          </span>
                          {item.errorMessage && (
                            <p className="text-xs text-red-500 dark:text-red-400 mt-1 max-w-xs truncate">
                              {item.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-5 text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {item.memo ? shortenAddress(item.memo, 14) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getItemStatusBadge(status: string) {
  switch (status) {
    case "sent":
      return {
        bg: "bg-green-50 dark:bg-green-950/30",
        text: "text-green-800 dark:text-green-400",
        dot: "bg-green-500",
      };
    case "pending":
      return {
        bg: "bg-blue-50 dark:bg-blue-950/30",
        text: "text-blue-800 dark:text-blue-400",
        dot: "bg-blue-500",
      };
    case "failed":
      return {
        bg: "bg-red-50 dark:bg-red-950/30",
        text: "text-red-800 dark:text-red-400",
        dot: "bg-red-500",
      };
    default:
      return {
        bg: "bg-gray-50 dark:bg-gray-800",
        text: "text-gray-800 dark:text-gray-400",
        dot: "bg-gray-500",
      };
  }
}
