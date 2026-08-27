"use client";
// SPDX-License-Identifier: MIT


import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";
import { getStellarExplorerUrl } from "@/lib/stellar";
import { exportToCsv } from "@/lib/csv";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusBadge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useApiQuery, apiFetch, type ApiError } from "@/hooks/useApiQuery";
import type { Payment, PaymentStatus } from "@/types";

// ── Status lifecycle ──────────────────────────────────────────
//
// Only these transitions are offered optimistically. Terminal states
// (COMPLETED / FAILED / CANCELLED) have no outgoing edges. The optimistic
// write is reconciled against the PATCH response; a failed request rolls the
// row back to its previous status and shows an error toast.

const SAFE_TRANSITIONS: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  CREATED: ["SIGNED", "CANCELLED"],
  SIGNED: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["COMPLETED", "FAILED"],
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED"],
};

const PAYMENTS_QUERY_KEY = ["payments", "list"];

// The list API is server-paginated with a max limit of 100 rows per page. The
// page paginates/searchs/exports client-side over the full collection, so the
// query loads every page (using `meta.total`) rather than silently truncating
// history to the first 100 records.

const PAYMENTS_PAGE_LIMIT = 100;

interface PaymentsListPage {
  data: Payment[];
  meta: { page: number; limit: number; total: number };
}

async function fetchPaymentsPage(page: number): Promise<PaymentsListPage> {
  const res = await fetch(
    `/api/payments?page=${page}&limit=${PAYMENTS_PAGE_LIMIT}`
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    const err: ApiError = {
      code: body?.error?.code ?? `HTTP_${res.status}`,
      message:
        body?.error?.message ?? `Request failed with status ${res.status}`,
    };
    throw err;
  }
  return (await res.json()) as PaymentsListPage;
}

async function fetchAllPayments(): Promise<Payment[]> {
  const first = await fetchPaymentsPage(1);
  const total = first.meta?.total ?? first.data.length;
  const pages = Math.max(1, Math.ceil(total / PAYMENTS_PAGE_LIMIT));
  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => fetchPaymentsPage(i + 2))
  );
  return [...first.data, ...remaining.flatMap((p) => p.data)];
}

// ── Page ──────────────────────────────────────────────────────

const ALLOWED_PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

export default function PaymentsPage() {
  // `useSearchParams` requires a Suspense boundary during static prerendering.
  return (
    <Suspense fallback={<PaymentsFallback />}>
      <PaymentsClient />
    </Suspense>
  );
}

function PaymentsFallback() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Payments" }]} />
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}

function PaymentsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const {
    data: rawPayments,
    isLoading: loading,
    error: fetchError,
    refetch: load,
  } = useApiQuery<Payment[]>(PAYMENTS_QUERY_KEY, undefined, {}, fetchAllPayments);

  const payments = useMemo(() => rawPayments ?? [], [rawPayments]);
  const error = fetchError ? fetchError.message : null;

  // ── Optimistic status updates ────────────────────────────────
  //
  // Changing a row's status updates that row in the cache immediately
  // (optimistic), then the PATCH response reconciles it. Each update is
  // tracked per-row so concurrent updates to different rows never interfere:
  // a failed request rolls back only its own row's snapshot and its own row's
  // control stays disabled until that request settles.

  const [pendingStatuses, setPendingStatuses] = useState<
    Record<string, PaymentStatus>
  >({});

  const handleStatusChange = async (payment: Payment, next: PaymentStatus) => {
    if (next === payment.status || pendingStatuses[payment.id]) return;

    const prevRow = payment;
    setPendingStatuses((prev) => ({ ...prev, [payment.id]: next }));
    queryClient.setQueryData<Payment[]>(PAYMENTS_QUERY_KEY, (old) =>
      (old ?? []).map((p) => (p.id === payment.id ? { ...p, status: next } : p))
    );

    try {
      const updated = await apiFetch<Payment>(`/api/payments/${payment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      queryClient.setQueryData<Payment[]>(PAYMENTS_QUERY_KEY, (old) =>
        (old ?? []).map((p) => (p.id === payment.id ? updated : p))
      );
      toast.success(
        "Payment status updated",
        updated.status.replace(/_/g, " ")
      );
    } catch (err) {
      queryClient.setQueryData<Payment[]>(PAYMENTS_QUERY_KEY, (old) =>
        (old ?? []).map((p) => (p.id === payment.id ? prevRow : p))
      );
      const message =
        (err as { message?: string } | null | undefined)?.message ??
        "Request failed";
      toast.error("Failed to update payment status", message);
    } finally {
      setPendingStatuses((prev) => {
        const nextState = { ...prev };
        delete nextState[payment.id];
        return nextState;
      });
    }
  };

  const isStatusPending = (id: string) => pendingStatuses[id] !== undefined;

  // Client-side search/filter
  const filtered = useMemo(() => {
    if (!debouncedSearch) return payments;
    const q = debouncedSearch.toLowerCase();
    return payments.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.memo ?? "").toLowerCase().includes(q) ||
        (p.transactionHash ?? "").toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
    );
  }, [payments, debouncedSearch]);

  // Client-side pagination — page and page size are persisted in the URL
  // search params so filtered/paginated views are shareable.
  const pageParam = parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const pageSizeParam = parseInt(searchParams.get("pageSize") ?? "", 10);
  const pageSize = (ALLOWED_PAGE_SIZES as readonly number[]).includes(
    pageSizeParam
  )
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  const updateQuery = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const goToPage = (target: number) =>
    updateQuery({ page: target <= 1 ? null : String(target) });

  const changePageSize = (size: number) =>
    updateQuery({
      pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
      page: null,
    });

  const handleExport = async () => {
    // Prefer the server-side export (GET /api/payments/export): it applies the
    // CURRENT search filter to the full DB-backed record set, so the CSV is
    // not limited to the rows loaded into the page. It falls back to a
    // client-side export of the loaded rows when there is no server session
    // (e.g. wallet connected but the session cookie expired) so the button
    // never dead-ends in a 401.
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);

    try {
      const res = await fetch(`/api/payments/export?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `ophirpay-payments-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Network failure or missing session — fall through to the client-side
      // export below.
    }

    exportToCsv(filtered, [
      { key: "id", header: "Payment ID" },
      { key: "amount", header: "Amount" },
      { key: "assetCode", header: "Asset" },
      { key: "status", header: "Status" },
      { key: "transactionHash", header: "Tx Hash" },
      { key: "createdAt", header: "Created At" },
    ], { filename: `ophirpay-payments-${new Date().toISOString().split("T")[0]}.csv` });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: "Payments" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Payments
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Your payment records and their lifecycle statuses
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            title="Export CSV"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSV
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
            Refresh
          </button>
          <Link
            href="/send"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors shadow-lg shadow-ophir-500/25 active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Send
          </Link>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID, description, hash, or status..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
        />
      </div>

      {/* Record count */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-xs font-medium text-green-700 dark:text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {payments.length} {payments.length === 1 ? "payment" : "payments"}
        </span>
        {!loading && filtered.length !== payments.length && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            filtered: {filtered.length} of {payments.length}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load payments: {error}
          </p>
          <button onClick={() => load()} className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline">
            Try again
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-busy={loading}>
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                <th className="py-3 px-4 font-medium">Payment</th>
                <th className="py-3 px-4 font-medium">Amount</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                // Skeleton rows pulse in place so the table keeps its height
                // (no layout shift) while the list is in flight.
                Array.from({ length: 5 }).map((_, i) => (
                  <tr
                    key={i}
                    aria-hidden="true"
                    className="border-b border-gray-100 dark:border-gray-800/50"
                  >
                    <td className="py-3 px-4" colSpan={5}>
                      <div className="flex items-center gap-4">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 flex-1" />
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading && filtered.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {search ? "No payments match your search." : "No payments yet — send one from the Send page."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                paginated.map((payment) => {
                  const transitions = SAFE_TRANSITIONS[payment.status] ?? [];
                  const pending = isStatusPending(payment.id);
                  return (
                    <tr
                      key={payment.id}
                      className={`border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors ${
                        pending ? "opacity-60" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-gray-900 dark:text-white">
                          #{shortenAddress(payment.id, 8)}
                        </p>
                        {payment.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">
                            {payment.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300 font-mono">
                        {formatAmount(payment.amount, payment.assetCode)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={payment.status} />
                          {transitions.length > 0 && (
                            <select
                              aria-label={`Change status of payment ${payment.id}`}
                              value=""
                              disabled={pending}
                              onChange={(e) =>
                                handleStatusChange(
                                  payment,
                                  e.target.value as PaymentStatus
                                )
                              }
                              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-ophir-500 disabled:opacity-50"
                            >
                              <option value="" disabled>
                                {pending ? "Updating…" : "Change…"}
                              </option>
                              {transitions.map((s) => (
                                <option key={s} value={s}>
                                  {s.replace(/_/g, " ")}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-xs">
                        {formatDate(payment.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        {payment.transactionHash ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={getStellarExplorerUrl(payment.transactionHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
                            >
                              {shortenAddress(payment.transactionHash)}
                            </a>
                            <CopyButton value={payment.transactionHash} label="Hash" />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!loading && !error && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing{" "}
                <span className="font-medium">
                  {startIndex + 1}–
                  {Math.min(startIndex + pageSize, filtered.length)}
                </span>{" "}
                of <span className="font-medium">{filtered.length}</span>{" "}
                {filtered.length === 1 ? "payment" : "payments"}
              </p>
              <select
                aria-label="Page size"
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-ophir-500"
              >
                {ALLOWED_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
            </div>
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              hasNext={currentPage < totalPages}
              hasPrev={currentPage > 1}
              onNext={() => goToPage(currentPage + 1)}
              onPrev={() => goToPage(currentPage - 1)}
              onPage={goToPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
