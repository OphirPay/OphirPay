"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatDate, getStatusColor, cn } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { PaymentTimeline } from "@/components/PaymentTimeline";
import { Amount, CopyButton, ExplorerLink } from "@/components/ui";
import { useApiQuery } from "@/hooks/useApiQuery";
import { buildPaymentTimeline } from "@/lib/payment-timeline";
import type { Payment } from "@/types";

/** One label/value row in the details grid. Absent values render as an em dash. */
function Field({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-sm text-gray-900 dark:text-white break-all",
          mono && "font-mono"
        )}
      >
        {children ?? (value || <span className="text-gray-400">—</span>)}
      </dd>
    </div>
  );
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const {
    data: payment,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<Payment>(["payment", id], `/api/payments/${id}`, {
    enabled: Boolean(id),
  });

  const crumbs = [
    { label: "Payments", href: "/payments" },
    { label: payment ? `#${payment.id.slice(0, 8)}` : "Detail" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={crumbs} />
        <LoadingSkeleton variant="card" lines={6} />
      </div>
    );
  }

  if (isError || !payment) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={crumbs} />
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-10 h-10"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
          title="Payment not found"
          description="This payment does not exist, or it belongs to another account."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
        <div className="text-center">
          <Link
            href="/payments"
            className="text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
          >
            Back to payments
          </Link>
        </div>
      </div>
    );
  }

  const status = getStatusColor(payment.status);
  const steps = buildPaymentTimeline({
    status: payment.status,
    transactionHash: payment.transactionHash,
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={crumbs} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          {/* `Amount` accepts number | string. The API serialises Decimal as a
              string to preserve precision, and Number() on the previous
              decimal.js object form produced NaN. */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            <Amount value={payment.amount} asset={payment.assetCode} />
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 font-mono text-xs break-all">
            {payment.id}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full text-xs font-medium",
            status.bg,
            status.text
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {payment.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Details
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <Field label="Asset" value={payment.assetCode} />
            <Field label="Created" value={formatDate(payment.createdAt)} />
            <Field
              label="Completed"
              value={payment.completedAt ? formatDate(payment.completedAt) : null}
            />
            <Field label="Description" value={payment.description} />
            <Field label="Memo" value={payment.memo} mono />
            <Field label="Batch" value={payment.batchId} mono />
            <Field label="Source account" value={payment.sourceAccountId} mono />
            <Field label="Destination account" value={payment.destAccountId} mono />

            <div className="sm:col-span-2">
              <Field label="Transaction hash">
                {payment.transactionHash ? (
                  <span className="inline-flex items-center gap-2">
                    <ExplorerLink value={payment.transactionHash} kind="tx" />
                    <CopyButton value={payment.transactionHash} label="Hash" />
                  </span>
                ) : (
                  <span className="text-gray-400">
                    — not yet broadcast to the network
                  </span>
                )}
              </Field>
            </div>

            {payment.errorMessage && (
              <div className="sm:col-span-2">
                <Field label="Error">
                  <span className="text-red-700 dark:text-red-400">
                    {payment.errorMessage}
                  </span>
                </Field>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Lifecycle
          </h2>
          <PaymentTimeline steps={steps} />
        </section>
      </div>
    </div>
  );
}
