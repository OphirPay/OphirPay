"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { notFound } from "next/navigation";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Payment } from "@/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  formatAmount,
  formatDate,
  getStatusColor,
  shortenAddress,
} from "@/lib/utils";
import { getStellarExplorerUrl, isValidStellarAddress } from "@/lib/stellar";
import { downloadReceiptPdf } from "@/lib/receipt-pdf";

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
      <div className="space-y-6 animate-fade-in" role="status" aria-label="Loading payment">
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

  // Resolve sender/recipient Stellar addresses for the receipt PDF. The
  // send flow persists them as sourceAccountId (sender) and inside
  // metadata.destAddress (recipient, since the Payment model has no
  // destination-address column).
  let metadataDestAddress: string | undefined;
  if (payment.metadata) {
    try {
      const parsed = JSON.parse(payment.metadata) as { destAddress?: string };
      metadataDestAddress = parsed.destAddress;
    } catch {
      metadataDestAddress = undefined;
    }
  }
  const receiptSender =
    payment.sourceAccountId && isValidStellarAddress(payment.sourceAccountId)
      ? payment.sourceAccountId
      : undefined;
  const receiptRecipient =
    (metadataDestAddress && isValidStellarAddress(metadataDestAddress)
      ? metadataDestAddress
      : payment.destAccountId && isValidStellarAddress(payment.destAccountId)
        ? payment.destAccountId
        : undefined) ?? undefined;

  // Receipt is only offered for confirmed payments with a tx hash and both
  // addresses — a half-populated receipt is worse than no receipt.
  const canDownloadReceipt = Boolean(
    payment.transactionHash && receiptSender && receiptRecipient
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="no-print">
        <Breadcrumb
          items={[
            { label: "Payments", href: "/payments" },
            { label: `Payment ${shortenAddress(payment.id, 8)}` },
          ]}
        />
      </div>

      {/* Print-only official header */}
      <div className="print-only mb-6 border-b border-gray-300 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">OphirPay Payment Record</h1>
            <p className="text-xs text-gray-500">Stellar Payment Orchestration Network</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <p className="font-semibold text-gray-900">Record #{payment.id}</p>
            <p>Status: {payment.status}</p>
          </div>
        </div>
      </div>

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
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm"
            title="Print payment record"
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
                d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.656h10.5z"
              />
            </svg>
            Print
          </button>
          <Link
            href={`/payments/${encodeURIComponent(payment.id)}/receipt`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm"
            title="View printable receipt"
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
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            Receipt
          </Link>
          {canDownloadReceipt && (
            <button
              onClick={() =>
                downloadReceiptPdf({
                  transactionHash: payment.transactionHash!,
                  amount: String(payment.amount),
                  assetCode: payment.assetCode,
                  date: payment.createdAt,
                  sender: receiptSender!,
                  recipient: receiptRecipient!,
                  memo: payment.memo || undefined,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
              Download Receipt (PDF)
            </button>
          )}
          <Link
            href="/payments"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            ← Back to Payments
          </Link>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden print-avoid-break">
        <dl className="divide-y divide-gray-100 dark:divide-gray-800/50 text-sm">
          <DetailRow label="Payment ID">
            <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
              {payment.id}
            </span>
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
                  className="font-mono text-xs text-ophir-600 dark:text-ophir-400 hover:underline break-all"
                >
                  <span className="no-print">{shortenAddress(payment.transactionHash)}</span>
                  <span className="print-only">{payment.transactionHash}</span>
                </a>
                <CopyButton value={payment.transactionHash} label="Hash" />
              </div>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">—</span>
            )}
          </DetailRow>
          {payment.batchId && (
            <DetailRow label="Batch">
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {payment.batchId}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Created">{formatDate(payment.createdAt)}</DetailRow>
          <DetailRow label="Updated">{formatDate(payment.updatedAt)}</DetailRow>
          {payment.errorMessage && (
            <DetailRow label="Error">
              <span className="text-red-600 dark:text-red-400">
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
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4 py-3 px-4">
      <dt className="text-gray-500 dark:text-gray-400 font-medium">
        {label}
      </dt>
      <dd className="sm:col-span-2 text-gray-700 dark:text-gray-300">
        {children}
      </dd>
    </div>
  );
}
