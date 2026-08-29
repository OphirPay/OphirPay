"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Payment } from "@/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { CopyButton } from "@/components/ui/CopyButton";
import { PaymentLifecycleTimeline } from "@/components/PaymentLifecycleTimeline";
import {
  formatAmount,
  formatDate,
  getStatusColor,
  shortenAddress,
} from "@/lib/utils";
import { getStellarExplorerUrl } from "@/lib/stellar";

// Payment ids are cuid strings (Prisma `@default(cuid())`). UUIDs are
// accepted too so either id style resolves; anything shorter or containing
// special characters is rejected up front so malformed ids never reach the
// API — they render the 404 page instead of an error state.
const ID_PATTERN = /^[a-zA-Z0-9-]{20,64}$/;

export default function PaymentDetailView({ id }: { id: string }) {
  const idLooksValid = ID_PATTERN.test(id);

  const {
    data: payment,
    isLoading,
    error,
    refetch,
  } = useApiQuery<Payment>(["payments", id], `/api/payments/${id}`, {
    enabled: idLooksValid,
    retry: false,
  });

  // Invalid ids (non-UUID/non-cuid) are handled gracefully — 404, no query.
  if (!idLooksValid) notFound();

  // Unknown ids: the API returns 404 → render the global not-found page,
  // which links back into the app.
  if (error?.code === "NOT_FOUND") notFound();

  if (isLoading) {
    return (
      <div
        className="space-y-6 animate-fade-in"
        role="status"
        aria-label="Loading payment"
      >
        <Breadcrumb
          items={[
            { label: "Payments", href: "/payments" },
            { label: "Payment" },
          ]}
        />
        <LoadingSkeleton variant="card" lines={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-400">
          Failed to load payment: {error.message}
        </p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // Defensive: a loaded query with no payment can't happen (the API 404s),
  // but treat it as not-found rather than rendering a blank page.
  if (!payment) notFound();

  const statusColor = getStatusColor(payment.status);

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb
        items={[
          { label: "Payments", href: "/payments" },
          { label: `Payment ${shortenAddress(payment.id, 8)}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Payment{" "}
            <span className="font-mono text-lg">
              {shortenAddress(payment.id, 8)}
            </span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Details for payment record {payment.id}
          </p>
        </div>
        <Link
          href="/payments"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          ← Back to Payments
        </Link>
      </div>

      {/* Visual Lifecycle Timeline */}
      <PaymentLifecycleTimeline payment={payment} />

      {/* Payment Field Details */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Payment Details
          </h2>
        </div>
        <dl className="divide-y divide-gray-100 dark:divide-gray-800/50 text-sm">
          <DetailRow label="Payment ID">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                {payment.id}
              </span>
              <CopyButton value={payment.id} label="ID" />
            </div>
          </DetailRow>
          <DetailRow label="Amount">
            <span className="font-mono font-medium text-gray-900 dark:text-white">
              {formatAmount(payment.amount, payment.assetCode)}
            </span>
          </DetailRow>
          <DetailRow label="Status">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor.bg} ${statusColor.text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor.dot}`} />
              {payment.status.replace(/_/g, " ")}
            </span>
          </DetailRow>
          {payment.description && (
            <DetailRow label="Description">{payment.description}</DetailRow>
          )}
          {payment.memo && (
            <DetailRow label="Memo">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {payment.memo}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Transaction Hash">
            {payment.transactionHash ? (
              <div className="flex items-center gap-2">
                <a
                  href={getStellarExplorerUrl(payment.transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-ophir-600 dark:text-ophir-400 hover:underline inline-flex items-center gap-1"
                >
                  <span>{shortenAddress(payment.transactionHash)}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-3 h-3 opacity-60"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
                <CopyButton value={payment.transactionHash} label="Hash" />
              </div>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">—</span>
            )}
          </DetailRow>
          {payment.sourceAccountId && (
            <DetailRow label="Source Account">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {shortenAddress(payment.sourceAccountId, 8)}
              </span>
            </DetailRow>
          )}
          {payment.destAccountId && (
            <DetailRow label="Destination Account">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {shortenAddress(payment.destAccountId, 8)}
              </span>
            </DetailRow>
          )}
          {payment.batchId && (
            <DetailRow label="Batch">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {payment.batchId}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Created">{formatDate(payment.createdAt)}</DetailRow>
          <DetailRow label="Updated">{formatDate(payment.updatedAt)}</DetailRow>
          {payment.completedAt && (
            <DetailRow label="Completed">
              {formatDate(payment.completedAt)}
            </DetailRow>
          )}
          {payment.errorMessage && (
            <DetailRow label="Error">
              <span className="text-red-600 dark:text-red-400 font-medium">
                {payment.errorMessage}
              </span>
            </DetailRow>
          )}
        </dl>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4 py-3 px-5">
      <dt className="text-gray-500 dark:text-gray-400 font-medium">
        {label}
      </dt>
      <dd className="sm:col-span-2 text-gray-700 dark:text-gray-300">
        {children}
      </dd>
    </div>
  );
}
