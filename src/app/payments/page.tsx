"use client";
// SPDX-License-Identifier: MIT

import { Suspense, useCallback, useMemo, useState, useOptimistic } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatAmount, shortenAddress, timeAgo } from "@/lib/utils";
import { fetchOnChainPayments, type OnChainPayment } from "@/lib/contracts";
import { useToast } from "@/components/ui/Toast";
import { getStellarExplorerUrl, XLM_STROOPS } from "@/lib/stellar";
import { exportToCsv } from "@/lib/csv";
import { Breadcrumb } from "@/components/Breadcrumb";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";
import { CopyButton } from "@/components/ui/CopyButton";
import { Pagination } from "@/components/ui/Pagination";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { useDebounce } from "@/hooks/useDebounce";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay";
import { useXlmPrice } from "@/hooks/usePrice";
import { convertXlmToUsd, formatFiatAmount } from "@/lib/price";

// ── Page ──────────────────────────────────────────────────────

interface OnChainData {
  payments: OnChainPayment[];
  total: number;
}

const ALLOWED_PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

// Fetch the complete on-chain dataset rather than a recent slice. Sorting and
// pagination run client-side, so operating on a partial slice would silently
// exclude older records — a sorted view could report the wrong minimum amount
// or omit valid payments entirely. `fetchOnChainPayments` fetches ids
// `total - limit + 1 .. total`; an unbounded limit reads every record (and
// stays capped by the contract's own count).
const FETCH_ALL_RECORDS = Number.MAX_SAFE_INTEGER;

export default function PaymentsPage() {
  usePageTitle(PAGE_TITLES.PAYMENTS);
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

  // Pre-populate the search box from `?q=` so filtered views are shareable
  // (Issue #157: the search param lives in the URL).
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebounce(search, 300);

  const {
    data,
    isLoading: loading,
    error: fetchError,
    refetch: load,
  } = useApiQuery<OnChainData>(
    ["payments", "onchain"],
    undefined, // REST not used — reads via Soroban simulation below
    {
      // On-chain reads are N+1 RPC simulations — don't refetch on tab focus
      refetchOnWindowFocus: false,
    },
    () => fetchOnChainPayments(50)
  );

  const payments = useMemo(() => data?.payments ?? [], [data]);
  const total = data?.total ?? 0;
  const error = fetchError ? fetchError.message : null;

  // ── Optimistic status updates ─────────────────────────────────
  const toast = useToast();
  const [optimisticStatuses, setOptimisticStatuses] = useOptimistic(
    {} as Record<number, "RECORDED" | "CANCELLED">,
    (current, update: { id: number; status: "RECORDED" | "CANCELLED" }) => ({
      ...current,
      [update.id]: update.status,
    })
  );

  const getStatus = useCallback(
    (payment: OnChainPayment): "RECORDED" | "CANCELLED" =>
      optimisticStatuses[payment.id] ??
      (payment.metadata === "CANCELLED" ? "CANCELLED" : "RECORDED"),
    [optimisticStatuses]
  );

  const handleCancel = useCallback(
    async (payment: OnChainPayment) => {
      // Optimistically mark as CANCELLED
      setOptimisticStatuses({ id: payment.id, status: "CANCELLED" });

      try {
        const res = await fetch("/api/payments/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: payment.txHash }),
        });
        if (!res.ok) throw new Error("Failed to cancel payment");
        // Reconcile: refetch from server to confirm the state
        await load();
        toast.success("Payment cancelled");
      } catch {
        // Roll back: revert to original status
        setOptimisticStatuses({ id: payment.id, status: "RECORDED" });
        toast.error("Failed to cancel payment", "The payment status has been reverted.");
      }
    },
    [setOptimisticStatuses, load, toast]
  );

  const statusFilter = searchParams.get("status") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const assetFilter = searchParams.get("asset") ?? "";

  // Client-side search/filter
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return payments.filter(
      (p) =>
        (!q || p.payer.toLowerCase().includes(q) || p.payee.toLowerCase().includes(q) || p.txHash.toLowerCase().includes(q) || String(p.id).includes(q)) &&
        (!statusFilter || getStatus(p) === statusFilter) &&
        (!dateFrom || (p.timestamp !== undefined && p.timestamp >= Math.floor(new Date(`${dateFrom}T00:00:00`).getTime() / 1000))) &&
        (!dateTo || (p.timestamp !== undefined && p.timestamp <= Math.floor(new Date(`${dateTo}T23:59:59.999`).getTime() / 1000))) &&
        (!assetFilter || (p.assetCode ?? "XLM") === assetFilter)
    );
  }, [payments, debouncedSearch, statusFilter, dateFrom, dateTo, assetFilter, getStatus]);

  // Client-side pagination — page and page size are persisted in the URL
  // search params so filtered/paginated views are shareable.
  const pageParam = Number.parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const pageSizeParam = Number.parseInt(searchParams.get("pageSize") ?? "", 10);
  const pageSize = (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  // Column sorting — state lives in the URL (`sort` + `dir`) so sorted views
  // are shareable and compose with the search filter and pagination.
  const sort = parsePaymentSort(searchParams);
  const sorted = useMemo(() => applyPaymentSort(filtered, sort), [filtered, sort]);

  const toggleSort = (key: PaymentSortKey) =>
    updateQuery({
      ...getSortParamUpdates(getNextSort(sort, key)),
      // Re-sorting changes the row order — jump back to the first page.
      page: null,
    });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginated = sorted.slice(startIndex, startIndex + pageSize);

  // Roving-tabindex keyboard navigation: the active row is in the tab order
  // and ArrowUp/Down/Home/End move between rows (also from row actions).
  const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation(paginated.length);

  const updateQuery = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const goToPage = (target: number) => updateQuery({ page: target <= 1 ? null : String(target) });

  const changePageSize = (size: number) =>
    updateQuery({
      pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
      page: null,
    });

  const { currency, setCurrency } = useCurrencyDisplay();
  const { price: xlmPrice, isUnavailable: isPriceUnavailable } = useXlmPrice();

  const renderPaymentAmount = (payment: OnChainPayment) => {
    const xlmAmount = payment.amountStroops / XLM_STROOPS;
    if (currency !== "USD") {
      return formatAmount(xlmAmount, "XLM");
    }
    if (xlmPrice !== null) {
      return (
        <div>
          <span className="font-medium text-gray-900 dark:text-white">
            {formatFiatAmount(convertXlmToUsd(xlmAmount, xlmPrice), { showApprox: true })}
          </span>
          <span className="block text-[11px] text-gray-400 dark:text-gray-500">
            {formatAmount(xlmAmount, "XLM")}
          </span>
        </div>
      );
    }
    return (
      <div>
        <span>{formatAmount(xlmAmount, "XLM")}</span>
        <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-sans">
          (USD unavailable)
        </span>
      </div>
    );
  };

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
        link.remove();
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Network failure or missing session — fall through to the client-side
      // export below.
    }
    exportToCsv(filtered, [
      { key: "id", header: "Payment ID" },
      { key: "payer", header: "Payer" },
      { key: "payee", header: "Payee" },
      { key: "amountStroops", header: "Amount (Stroops)" },
      { key: "metadata", header: "Metadata" },
      { key: "txHash", header: "Tx Hash" },
    ], { filename: `ophirpay-payments-${new Date().toISOString().split("T")[0]}.csv` });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: "Payments" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Payment records stored on-chain by the OphirPay Soroban contract
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CurrencyToggle
            value={currency}
            onChange={setCurrency}
            showPrice={currency === "USD"}
            price={xlmPrice}
            isUnavailable={isPriceUnavailable}
          />
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            title="Export CSV"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            CSV
          </button>
          <button
            type="button"
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182"
              />
            </svg>
            Refresh
          </button>
          <Link
            href="/send"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors shadow-lg shadow-ophir-500/25 active:scale-95"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Send
          </Link>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
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
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address, hash, or ID..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
        />
      </div>

      {/* Chain record count */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-xs font-medium text-green-700 dark:text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {total} on-chain {total === 1 ? "record" : "records"}
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
            Failed to load on-chain payments: {error}
          </p>
          <button
            type="button"
            onClick={() => load()}
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state / Table */}
      {!loading && !error && payments.length === 0 && !search ? (
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
              />
            </svg>
          }
          title="No Payments Yet"
          description="Payments recorded on-chain by the OphirPay Soroban contract will appear here. Send your first payment to get started."
          actionLabel="Create First Payment"
          onAction={() => router.push("/send")}
        />
      ) : (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-busy={loading}>
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                <th className="py-3 px-4 font-medium">Payment</th>
                <th className="py-3 px-4 font-medium">
                  Amount {currency === "USD" ? "(USD)" : "(XLM)"}
                </th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium">Tx Hash</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
              {loading &&
                // Skeleton rows pulse in place so the table keeps its height
                // (no layout shift) while the on-chain read is in flight.
                Array.from({ length: 5 }).map((_, i) => (
                  <tr
                    key={i}
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
                      {search
                        ? "No payments match your search."
                        : "No on-chain payments yet — send one from the Send page."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                paginated.map((payment, index) => (
                  <tr
                    key={payment.id}
                    data-row-index={index}
                    {...getRowProps(index)}
                    className={cn(
                      "border-b border-gray-100 dark:border-gray-800/50 transition-colors",
                      index === activeIndex
                        ? "bg-ophir-50/70 dark:bg-ophir-950/40 hover:bg-ophir-100/70 dark:hover:bg-ophir-900/40"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/30"
                    )}
                  >
                    <td className="py-3 px-4">
                      <Link
                        href={`/payments/${payment.id}`}
                        className="block group/link"
                        title={`View payment #${payment.id} details`}
                      >
                        <p className="font-medium text-gray-900 dark:text-white group-hover/link:text-ophir-600 dark:group-hover/link:text-ophir-400 transition-colors">
                          #{payment.id}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5 group-hover/link:text-gray-500 dark:group-hover/link:text-gray-400 transition-colors">
                          {shortenAddress(payment.payer, 6)} → {shortenAddress(payment.payee, 6)}
                        </p>
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-300 font-mono">
                      {renderPaymentAmount(payment)}
                    </td>
                    <td className="py-3 px-4">
                      {(() => {
                        const status = getStatus(payment);
                        const isCancelled = status === "CANCELLED";
                        return (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${isCancelled ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${isCancelled ? "bg-red-500" : "bg-green-500"}`} />
                            {status}
                            {!isCancelled && (
                              <button
                                type="button"
                                onClick={() => handleCancel(payment)}
                                className="ml-1 text-red-500 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                title="Cancel payment"
                                aria-label={`Cancel payment #${payment.id}`}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-xs">
                      {payment.timestamp
                        ? timeAgo(new Date(payment.timestamp * 1000).toISOString())
                        : "—"}
                    </td>
                    <td className="py-3 px-4">
                      {payment.txHash ? (
                        <div className="flex items-center gap-2">
                          <a
                            href={getStellarExplorerUrl(payment.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
                          >
                            {shortenAddress(payment.txHash)}
                          </a>
                          <CopyButton value={payment.txHash} label="Hash" />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!loading && !error && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing{" "}
                <span className="font-medium">
                  {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)}
                </span>{" "}
                of <span className="font-medium">{filtered.length}</span> on-chain records
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
      )}
    </div>
  );
}
