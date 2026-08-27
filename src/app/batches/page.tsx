"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { timeAgo, getStatusColor } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Batch } from "@/types";

interface BatchListMeta {
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number;
}

interface BatchListResult {
  batches: Batch[];
  meta?: BatchListMeta;
}

const PAGE_LIMIT = 50;

export default function BatchesPage() {
  const router = useRouter();
  // Keyset pagination: `cursor` is the boundary of the current page;
  // `cursorStack` remembers prior page boundaries so Previous works.
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const {
    data,
    isLoading: loading,
    isError: hasError,
    refetch: load,
  } = useApiQuery<BatchListResult>(
    ["batches", cursor ?? "start"],
    undefined,
    { retry: false },
    async () => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/batches?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(
          body?.error?.message ?? `Request failed with status ${res.status}`
        ) as Error & { code?: string };
        err.code = body?.error?.code ?? `HTTP_${res.status}`;
        throw err;
      }
      const json = await res.json();
      return { batches: json.data, meta: json.meta };
    }
  );

  const batches = Array.isArray(data?.batches) ? data.batches : [];
  const meta = data?.meta;
  const error = hasError ? "Failed to load batches" : null;
  const handleRetry = () => { load(); };

  const goNext = () => {
    if (!meta?.nextCursor) return;
    setCursorStack((prev) => (cursor ? [...prev, cursor] : prev));
    setCursor(meta.nextCursor);
  };

  const goPrev = () => {
    if (cursorStack.length === 0) return;
    const next = [...cursorStack];
    const prevCursor = next.pop() ?? null;
    setCursorStack(next);
    setCursor(prevCursor);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Batches" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Batch Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Process multiple payments in a single transaction
          </p>
        </div>
        <Link
          href="/batches/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors shadow-lg shadow-ophir-500/25 active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Batch
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button onClick={handleRetry} className="mt-2 text-sm text-red-600 dark:text-red-400 underline">Try again</button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton variant="table" lines={5} />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
          }
          title="No Batch Payments Yet"
          description="Create batch payments for payroll, vendor payments, grant distributions, and more."
          actionLabel="Create Batch"
          onAction={() => router.push("/batches/new")}
        />
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Payments</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const statusColor = getStatusColor(batch.status);
                  const paymentCount = batch.payments?.length ?? 0;
                  return (
                    <tr
                      key={batch.id}
                      className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-gray-900 dark:text-white">{batch.name}</p>
                        {batch.description && (
                          <p className="text-xs text-gray-400 mt-0.5">{batch.description}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700 dark:text-gray-300">
                        {paymentCount} payment{paymentCount !== 1 ? "s" : ""}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor.bg} ${statusColor.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusColor.dot}`} />
                          {batch.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-xs">
                        {timeAgo(batch.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cursor pagination */}
          {batches.length > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {meta?.total !== undefined
                  ? `${batches.length} of ${meta.total} batch${meta.total !== 1 ? "es" : ""}`
                  : `${batches.length} batches`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={cursorStack.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={goNext}
                  disabled={!meta?.hasMore}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
