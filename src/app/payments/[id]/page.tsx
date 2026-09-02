"use client";
// SPDX-License-Identifier: MIT


import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  fetchOnChainPayment,
  type OnChainPayment,
} from "@/lib/contracts";
import {
  derivePaymentLifecycle,
  type LifecycleInput,
} from "@/lib/payment-lifecycle";
import { getStellarExplorerUrl, XLM_STROOPS } from "@/lib/stellar";
import { cn, formatAmount, shortenAddress } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PaymentTimeline } from "@/components/payments/PaymentTimeline";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

interface DbPayment {
  id: string;
  amount?: string | number;
  assetCode?: string;
  assetIssuer?: string | null;
  description?: string | null;
  memo?: string | null;
  status?: string | null;
  transactionHash?: string | null;
  metadata?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
}

/** Derive the display status of an on-chain record (kept local to avoid a
 * cross-feature dependency — see `getPaymentStatus` in src/lib/payments-sort.ts). */
function getOnChainStatus(payment: OnChainPayment): "RECORDED" | "CANCELLED" {
  return payment.metadata === "CANCELLED" ? "CANCELLED" : "RECORDED";
}

function formatDateOrDash(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 shrink-0 sm:w-40">
        {label}
      </dt>
      <dd
        className={cn(
          "text-sm text-gray-800 dark:text-gray-200 text-left sm:text-right break-all",
          mono && "font-mono text-xs"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";
  const numericId = /^\d+$/.test(id) ? Number(id) : NaN;
  // On-chain IDs are u64 — beyond Number.MAX_SAFE_INTEGER the Number
  // conversion loses precision and could look up the wrong record. Reject
  // unsafe values as not-found rather than silently mis-resolving the id.
  const isNumeric = Number.isFinite(numericId) && Number.isSafeInteger(numericId);

  // Primary source: the on-chain Soroban payment record (public read).
  const onChainQuery = useApiQuery<OnChainPayment | null>(
    ["payments", "onchain", id],
    undefined,
    {
      refetchOnWindowFocus: false,
      retry: false,
      enabled: isNumeric,
    },
    () => fetchOnChainPayment(numericId)
  );

  // Best-effort enrichment from the authenticated DB record (memo,
  // description, precise lifecycle timestamps). Fails silently — the page
  // renders from on-chain data alone when no session is present.
  const dbQuery = useApiQuery<DbPayment | undefined>(
    ["payments", "db", id],
    `/api/payments/${encodeURIComponent(id)}`,
    { retry: false }
  );

  const onChain = onChainQuery.data ?? null;
  const db = dbQuery.data;

  const loading = onChainQuery.isLoading || (!isNumeric && dbQuery.isLoading);
  const notFound = !loading && !onChainQuery.isError && onChain === null && !db;
  const error = !loading && onChainQuery.isError;

  const txHash = onChain?.txHash || db?.transactionHash || undefined;
  const explorerUrl = txHash ? getStellarExplorerUrl(txHash) : undefined;
  const displayId = onChain ? String(onChain.id) : db ? db.id : id;
  const status =
    db?.status ?? (onChain ? getOnChainStatus(onChain) : undefined);
  const memo =
    db?.memo ??
    (onChain?.metadata && onChain.metadata !== "CANCELLED"
      ? onChain.metadata
      : undefined);
  const amount =
    onChain !== null
      ? formatAmount(onChain.amountStroops / XLM_STROOPS, "XLM")
      : db
        ? formatAmount(Number(db.amount ?? 0), db.assetCode ?? "XLM")
        : null;

  const lifecycleInput = useMemo<LifecycleInput>(
    () => ({
      status: db?.status ?? undefined,
      metadata: onChain?.metadata,
      txHash: onChain?.txHash || db?.transactionHash || undefined,
      timestamp: onChain?.timestamp,
      createdAt:
        db?.createdAt ?? (onChain?.timestamp ? onChain.timestamp : undefined),
      updatedAt: db?.updatedAt,
      completedAt:
        db?.completedAt ?? (onChain?.timestamp ? onChain.timestamp : undefined),
    }),
    [db, onChain]
  );
  const steps = useMemo(() => derivePaymentLifecycle(lifecycleInput), [lifecycleInput]);

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb
        items={[
          { label: "Payments", href: "/payments" },
          { label: displayId ? `Payment #${displayId}` : "Payment" },
        ]}
      />

      {loading && (
        <div className="space-y-4" role="status" aria-label="Loading payment">
          <p className="sr-only">Loading payment…</p>
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 h-64 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
            <div className="lg:col-span-2 h-64 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {error && (
        <Card className="p-8 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load this payment. The on-chain record could not be read.
          </p>
          <button
            onClick={() => onChainQuery.refetch()}
            className="mt-4 px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
          >
            Try again
          </button>
        </Card>
      )}

      {notFound && (
        <Card className="p-12 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Payment not found
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            No payment record exists for{" "}
            <span className="font-mono">#{id}</span>.
          </p>
          <Link
            href="/payments"
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
          >
            ← Back to Payments
          </Link>
        </Card>
      )}

      {!loading && !error && !notFound && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Payment #{displayId}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
                {onChain
                  ? "On-chain payment record stored by the OphirPay Soroban contract"
                  : "Payment record"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {status && <StatusBadge status={status} />}
              <Link
                href="/payments"
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-ophir-600 dark:hover:text-ophir-400 transition-colors"
              >
                ← All payments
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Details */}
            <Card className="lg:col-span-3 p-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Payment details
              </h2>
              <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                <DetailRow label="Amount" mono>
                  {amount ?? "—"}
                </DetailRow>

                {onChain && (
                  <>
                    <DetailRow label="Payer" mono>
                      <span className="inline-flex items-center gap-2">
                        {shortenAddress(onChain.payer, 8)}
                        <CopyButton value={onChain.payer} label="Payer" />
                      </span>
                    </DetailRow>
                    <DetailRow label="Payee" mono>
                      <span className="inline-flex items-center gap-2">
                        {shortenAddress(onChain.payee, 8)}
                        <CopyButton value={onChain.payee} label="Payee" />
                      </span>
                    </DetailRow>
                  </>
                )}

                <DetailRow label="Tx hash" mono>
                  {txHash ? (
                    <span className="inline-flex items-center gap-2">
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ophir-600 dark:text-ophir-400 hover:underline"
                      >
                        {shortenAddress(txHash, 8)}
                      </a>
                      <CopyButton value={txHash} label="Hash" />
                    </span>
                  ) : (
                    "—"
                  )}
                </DetailRow>

                {memo && (
                  <DetailRow label="Memo">{memo}</DetailRow>
                )}

                {db?.description && (
                  <DetailRow label="Description">{db.description}</DetailRow>
                )}

                <DetailRow label="Created">
                  {formatDateOrDash(
                    db?.createdAt ??
                      (onChain?.timestamp
                        ? new Date(onChain.timestamp * 1000).toISOString()
                        : null)
                  )}
                </DetailRow>

                <DetailRow label="Updated">
                  {formatDateOrDash(db?.updatedAt)}
                </DetailRow>

                <DetailRow label="Completed">
                  {formatDateOrDash(
                    db?.completedAt ??
                      (onChain?.timestamp
                        ? new Date(onChain.timestamp * 1000).toISOString()
                        : null)
                  )}
                </DetailRow>
              </dl>
            </Card>

            {/* Lifecycle */}
            <Card className="lg:col-span-2 p-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                Lifecycle
              </h2>
              <PaymentTimeline steps={steps} explorerUrl={explorerUrl} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
