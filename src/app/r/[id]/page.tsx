// SPDX-License-Identifier: MIT

import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatAmount } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

interface RequestPageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/**
 * Public shareable payment-request page (bounty #364).
 * Anyone with the link can view the invoice and pay it. Requests that are
 * paid, expired, cancelled, or unknown show a friendly state instead of
 * leaking data or crashing.
 */
export default async function RequestPage({ params }: RequestPageProps) {
  const { id } = await params;

  // Invalid ids (wrong format / too short) don't reach the DB safely —
  // catch any lookup error and render the friendly invalid state.
  let req: Awaited<ReturnType<typeof prisma.paymentRequest.findUnique>> | null = null;
  try {
    req = await prisma.paymentRequest.findUnique({ where: { id } });
  } catch {
    req = null;
  }

  if (!req) {
    return <InvalidRequestState />;
  }

  const isExpired =
    req.status === "EXPIRED" ||
    (req.status === "PENDING" && req.dueDate !== null && req.dueDate.getTime() < Date.now());

  const payHref = buildPayHref(req, isExpired);

  return (
    <main className="max-w-lg mx-auto mt-12 px-4 animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Payment Request
          </h1>
          <RequestStatusBadge status={req.status} expiredOverride={isExpired} />
        </div>

        <div className="text-center py-6">
          <p className="text-4xl font-bold text-gray-900 dark:text-white">
            {formatAmount(Number(req.amount), req.assetCode)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {req.description || "No description provided"}
          </p>
          {req.dueDate && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Due {new Date(req.dueDate).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          )}
        </div>

        {req.status === "PAID" ? (
          <PaidState transactionHash={req.transactionHash} />
        ) : isExpired ? (
          <ExpiredState />
        ) : (
          <PayState href={payHref} assetCode={req.assetCode} />
        )}
      </div>
    </main>
  );
}

function InvalidRequestState() {
  return (
    <main className="max-w-lg mx-auto mt-12 px-4 animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center shadow-sm">
        <div className="text-4xl mb-3">❓</div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Request Not Found
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          This payment request doesn&apos;t exist or the link is invalid. Please
          check the link and try again.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
        >
          Go to OphirPay
        </Link>
      </div>
    </main>
  );
}

function RequestStatusBadge({
  status,
  expiredOverride,
}: {
  status: RequestStatus;
  expiredOverride: boolean;
}) {
  const effective: RequestStatus = expiredOverride ? "EXPIRED" : status;
  const cls =
    effective === "PAID"
      ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400"
      : effective === "EXPIRED"
        ? "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400"
        : effective === "CANCELLED"
          ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
          : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400";
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {STATUS_LABELS[effective]}
    </span>
  );
}

function buildPayHref(req: Awaited<ReturnType<typeof prisma.paymentRequest.findUnique>>, isExpired: boolean): string {
  const search = new URLSearchParams();
  if (req?.recipientAddress) search.set("dest", req.recipientAddress);
  if (req?.amount) search.set("amount", String(Number(req.amount)));
  if (req?.description) search.set("memo", req.description.slice(0, 28));
  search.set("asset", req?.assetCode ?? "XLM");
  if (req?.id && !isExpired && req.status === "PENDING") search.set("requestId", req.id);
  return `/send?${search.toString()}`;
}

function PaidState({ transactionHash }: { transactionHash: string | null }) {
  return (
    <div className="mt-6 text-center">
      <div className="text-4xl mb-3">✅</div>
      <p className="font-medium text-gray-900 dark:text-white mb-1">
        This request has been paid
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Thank you! No further action is needed.
      </p>
      {transactionHash && (
        <code className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
          {transactionHash}
        </code>
      )}
    </div>
  );
}

function ExpiredState() {
  return (
    <div className="mt-6 text-center">
      <div className="text-4xl mb-3">⏰</div>
      <p className="font-medium text-gray-900 dark:text-white mb-1">
        This request has expired
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        The payment deadline passed before this request was paid.
      </p>
      <Link
        href="/"
        className="inline-block px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
      >
        Go to OphirPay
      </Link>
    </div>
  );
}

function PayState({ href, assetCode }: { href: string; assetCode: string }) {
  return (
    <div className="mt-6">
      <a
        href={href}
        className="w-full inline-block text-center px-5 py-3 rounded-lg bg-gradient-to-r from-ophir-600 to-stellar-dark text-white text-sm font-medium hover:from-ophir-700 hover:to-stellar transition-all"
      >
        Pay with Stellar
      </a>
      <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-3">
        Powered by {assetCode} on the Stellar network
      </p>
    </div>
  );
}
