"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";
import Link from "next/link";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useRouter } from "next/navigation";
import { timeAgo, getStatusColor } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useQueryClient } from "@tanstack/react-query";
import { connectLiveEvents } from "@/lib/events/event-client";
import type { Batch, BatchStatus } from "@/types";

interface BulkCancelResult {
  batchId: string;
  cancelled: number;
  skipped: number;
  total: number;
}

interface BatchListMeta {
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number;
}

interface BatchListResult {
  batches: Batch[];
  meta?: BatchListMeta;
}

interface BatchSummary {
  counts: { total: number } & Record<BatchStatus, number>;
  progress: { total: number; completed: number; failed: number; pending: number };
  batches: (Batch & {
    paymentCounts: { total: number; completed: number; failed: number; pending: number };
  })[];
}

const PAGE_LIMIT = 50;
// Status cards are rendered in a stable order matching BatchStatus.
const STATUS_ORDER: BatchStatus[] = [
  "CREATED",
  "PROCESSING",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED",
];

export default function BatchesPage() {
  usePageTitle(PAGE_TITLES.BATCHES);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Keyset pagination: `cursor` is the boundary of the current page;
  // `cursorStack` remembers prior page boundaries so Previous works.
  const toast = useToast();
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  // Batch awaiting the bulk-cancel confirmation dialog.
  const [confirmBatch, setConfirmBatch] = useState<Batch | null>(null);
  // Keeps the offending row's button in a loading state while cancelling.
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // ── Summary (status counts + per-batch drill-down) ─────────────
  const {
    data: summary,
    isLoading: summaryLoading,
  } = useApiQuery<BatchSummary>(
    ["batches", "summary"],
    "/api/batches/summary",
    { refetchInterval: 30000 }
  );

  // Keep the summary live: any payment event on the stream refreshes the
  // cached batch list + summary so counts and per-batch progress stay current.
  useEffect(() => {
    return connectLiveEvents({
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ["batches"] });
      },
    });
  }, [queryClient]);

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

  const cancelMutation = useApiMutation<{ id: string }, BulkCancelResult>(
    (body) => `/api/batches/${body.id}`,
    { method: "POST", invalidateKeys: [["batches"]] }
  );

  const handleBulkCancel = async (batch: Batch) => {
    setCancellingId(batch.id);
    try {
      const result = await cancelMutation.mutateAsync({ id: batch.id });
      toast.success(
        "Bulk cancel complete",
        `Cancelled ${result.cancelled} pending; ${result.skipped} already-submitted payment${result.skipped === 1 ? "" : "s"} skipped (${result.total} total).`
      );
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(
        apiErr.message || "Failed to cancel pending payments"
      );
    } finally {
      setCancellingId(null);
    }
  };

  const batches = Array.isArray(data?.batches) ? data.batches : [];
  const meta = data?.meta;
  const error = hasError ? "Failed to load batches" : null;
  const handleRetry = () => { load(); };
  const pendingCount = (batch: Batch) =>
    (batch.payments ?? []).filter((p) => p.status === "PENDING").length;

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

  // ── Summary card config ─────────────────────────────────────────
  const totalBatches = summary?.counts?.total ?? 0;
  const summaryLoadingFull = summaryLoading && totalBatches === 0;

  const summaryCards = STATUS_ORDER.map((status) => ({
    status,
    count: summary?.counts?.[status] ?? 0,
    color: getStatusColor(status),
  }));

  const progress = summary?.progress;
  const totalPayments = progress?.total ?? 0;
  const completedPct = totalPayments > 0 ? ((progress?.completed ?? 0) / totalPayments) * 100 : 0;

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

      {/* ── Summary view ────────────────────────────────────────── */}
      {summaryLoadingFull ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {summaryCards.map((card) => (
            <div
              key={card.status}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${card.color.dot}`} />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {card.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                {card.count}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Global progress across all batches ──────────────────── */}
      <Card title="Batch Progress" subtitle={`${totalPayments} payments across ${totalBatches} batch${totalBatches !== 1 ? "es" : ""}`} padding="md">
        <div className="space-y-3">
          <ProgressBar value={completedPct} max={100} variant="success" showLabel />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span><span className="font-semibold text-green-600 dark:text-green-400">{progress?.completed ?? 0}</span> completed</span>
            <span><span className="font-semibold text-red-600 dark:text-red-400">{progress?.failed ?? 0}</span> failed</span>
            <span><span className="font-semibold text-blue-600 dark:text-blue-400">{progress?.pending ?? 0}</span> pending</span>
          </div>
        </div>
      </Card>

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
                  <th className="py-3 px-4 font-medium">Progress</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Created</th>
                  <th className="py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const statusColor = getStatusColor(batch.status);
                  // Use the per-batch payment progress from the summary when
                  // available (consistent source of truth); fall back to the
                  // raw payments array otherwise.
                  const drillDown = summary?.batches?.find((s) => s.id === batch.id);
                  const paymentCount = batch.payments?.length
                    ?? drillDown?.paymentCounts?.total
                    ?? 0;
                  const completed = drillDown?.paymentCounts?.completed ?? 0;
                  const failed = drillDown?.paymentCounts?.failed ?? 0;
                  const pending = drillDown?.paymentCounts?.pending ?? paymentCount - completed - failed;
                  const pct = paymentCount > 0 ? (completed / paymentCount) * 100 : 0;

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
                      <td className="py-3 px-4 min-w-[160px]">
                        {paymentCount > 0 ? (
                          <>
                            <ProgressBar value={pct} max={100} variant={completed === paymentCount ? "success" : failed > 0 ? "warning" : "default"} />
                            <div className="mt-1 flex gap-x-3 text-xs text-gray-500 dark:text-gray-400">
                              <span className="text-green-600 dark:text-green-400">{completed} ok</span>
                              {failed > 0 && <span className="text-red-600 dark:text-red-400">{failed} failed</span>}
                              {pending > 0 && <span className="text-blue-600 dark:text-blue-400">{pending} pending</span>}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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
                      <td className="py-3 px-4">
                        {pending > 0 ? (
                          <button
                            onClick={() => setConfirmBatch(batch)}
                            disabled={cancellingId !== null}
                            title={`Cancel ${pending} pending payment${pending === 1 ? "" : "s"}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="w-3.5 h-3.5"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel {pending}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                        )}
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

      {/* Bulk-cancel confirmation dialog (Issue #158) */}
      <ConfirmDialog
        open={confirmBatch !== null}
        onClose={() => setConfirmBatch(null)}
        onConfirm={() => {
          if (confirmBatch) handleBulkCancel(confirmBatch);
        }}
        title="Cancel pending payments?"
        description={
          confirmBatch
            ? `This will cancel ${pendingCount(confirmBatch)} pending payment${
                pendingCount(confirmBatch) === 1 ? "" : "s"
              } in "${confirmBatch.name}". Already-submitted payments are skipped and reported.`
            : ""
        }
        confirmLabel="Cancel pending"
        variant="danger"
      />
    </div>
  );
}