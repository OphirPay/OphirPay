"use client";
// SPDX-License-Identifier: MIT

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApiQuery } from "@/hooks/useApiQuery";
import { fetchOnChainPayment, type OnChainPayment } from "@/lib/contracts";
import { getStellarExplorerUrl, XLM_STROOPS, STELLAR_NETWORK, isValidStellarAddress } from "@/lib/stellar";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { downloadReceiptPdf } from "@/lib/receipt-pdf";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusBadge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/Breadcrumb";

interface DbPayment {
  id: string;
  amount?: string | number;
  assetCode?: string;
  description?: string | null;
  memo?: string | null;
  status?: string | null;
  transactionHash?: string | null;
  metadata?: string | null;
  createdAt?: string;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
}

export default function PaymentReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";
  const numericId = /^\d+$/.test(id) ? Number(id) : NaN;
  const isNumeric = Number.isFinite(numericId) && Number.isSafeInteger(numericId);

  // 1. On-chain query
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

  // 2. Database query
  const dbQuery = useApiQuery<DbPayment | undefined>(
    ["payments", "db", id],
    `/api/payments/${encodeURIComponent(id)}`,
    { retry: false }
  );

  const onChain = onChainQuery.data ?? null;
  const db = dbQuery.data ?? null;

  const loading = onChainQuery.isLoading || (!isNumeric && dbQuery.isLoading);
  const notFound = !loading && !onChainQuery.isError && onChain === null && !db;

  const displayId = onChain ? String(onChain.id) : db ? db.id : id;
  const txHash = onChain?.txHash || db?.transactionHash || "";
  const explorerUrl = txHash ? getStellarExplorerUrl(txHash) : "";

  // Parse destination address from metadata if present
  let metadataDest: string | undefined;
  if (db?.metadata) {
    try {
      const parsed = JSON.parse(db.metadata) as { destAddress?: string };
      metadataDest = parsed.destAddress;
    } catch {
      metadataDest = undefined;
    }
  }

  const sender =
    onChain?.payer ||
    (db?.sourceAccountId && isValidStellarAddress(db.sourceAccountId) ? db.sourceAccountId : "—");

  const recipient =
    onChain?.payee ||
    (metadataDest && isValidStellarAddress(metadataDest)
      ? metadataDest
      : db?.destAccountId && isValidStellarAddress(db.destAccountId)
        ? db.destAccountId
        : "—");

  const amountStr =
    onChain !== null
      ? formatAmount(onChain.amountStroops / XLM_STROOPS, "XLM")
      : db?.amount
        ? formatAmount(Number(db.amount), db.assetCode ?? "XLM")
        : "—";

  const rawAmount = onChain !== null ? String(onChain.amountStroops / XLM_STROOPS) : String(db?.amount ?? "0");
  const assetCode = onChain !== null ? "XLM" : db?.assetCode ?? "XLM";

  const status =
    db?.status ??
    (onChain?.metadata === "CANCELLED" ? "CANCELLED" : onChain ? "RECORDED" : "PENDING");

  const memo =
    db?.memo ??
    (onChain?.metadata && onChain.metadata !== "CANCELLED" ? onChain.metadata : null);

  const dateValue = db?.createdAt || (onChain?.timestamp ? new Date(onChain.timestamp * 1000).toISOString() : new Date().toISOString());
  const formattedDate = useMemo(() => {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return dateValue;
    return d.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    });
  }, [dateValue]);

  const canDownloadPdf = Boolean(
    txHash &&
    sender !== "—" &&
    recipient !== "—" &&
    isValidStellarAddress(sender) &&
    isValidStellarAddress(recipient)
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-2 px-4 animate-fade-in">
      {/* Breadcrumb - screen only */}
      <div className="no-print">
        <Breadcrumb
          items={[
            { label: "Payments", href: "/payments" },
            { label: `Payment #${displayId}`, href: `/payments/${encodeURIComponent(displayId)}` },
            { label: "Receipt" },
          ]}
        />
      </div>

      {/* Action Toolbar - screen only */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span>📄</span> Official Payment Receipt
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Printable record and proof of on-chain payment execution
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ophir-600 hover:bg-ophir-700 text-white text-sm font-medium transition-colors shadow-sm active:scale-95"
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
            Print Receipt
          </button>
          {canDownloadPdf && (
            <button
              type="button"
              onClick={() =>
                downloadReceiptPdf({
                  transactionHash: txHash,
                  amount: rawAmount,
                  assetCode,
                  date: dateValue,
                  sender,
                  recipient,
                  memo: memo || undefined,
                })
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
              Download PDF
            </button>
          )}
          <Link
            href={`/payments/${encodeURIComponent(displayId)}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            ← Payment Details
          </Link>
        </div>
      </div>

      {loading && (
        <div className="p-12 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse">
          <p className="text-sm text-gray-500">Loading receipt details…</p>
        </div>
      )}

      {notFound && (
        <div className="p-12 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Receipt Not Found</h2>
          <p className="text-sm text-gray-500 mt-1">No payment record found for #{id}.</p>
        </div>
      )}

      {!loading && !notFound && (
        <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-2xl border border-gray-300 dark:border-gray-700 p-8 shadow-md print:shadow-none print:border-gray-400 print:p-6 print:rounded-none">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-gray-200 dark:border-gray-800 pb-6 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight text-ophir-600 dark:text-ophir-400">
                  OPHIRPAY
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  {STELLAR_NETWORK}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Stellar Payment Orchestration Layer
              </p>
            </div>
            <div className="text-left sm:text-right">
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                PAYMENT RECEIPT
              </h2>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1">
                Receipt #{displayId}
              </p>
              <div className="mt-2">
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          {/* Date & Overview Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-b border-gray-200 dark:border-gray-800 text-xs">
            <div>
              <span className="text-gray-500 dark:text-gray-400 uppercase font-medium">Date & Time</span>
              <p className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5">{formattedDate}</p>
            </div>
            <div className="sm:text-right">
              <span className="text-gray-500 dark:text-gray-400 uppercase font-medium">Payment Protocol</span>
              <p className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5">
                Stellar Soroban Contract
              </p>
            </div>
          </div>

          {/* Parties: Sender & Recipient */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-6 border-b border-gray-200 dark:border-gray-800">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                From (Payer)
              </span>
              <p className="font-mono text-xs text-gray-900 dark:text-gray-200 break-all bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                {sender}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                To (Payee)
              </span>
              <p className="font-mono text-xs text-gray-900 dark:text-gray-200 break-all bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                {recipient}
              </p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="py-6 border-b border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  <th className="pb-3">Description</th>
                  <th className="pb-3 text-right">Asset</th>
                  <th className="pb-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                <tr>
                  <td className="py-3 font-medium text-gray-900 dark:text-white">
                    Payment Transfer #{displayId}
                    {memo && (
                      <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                        Memo: {memo}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {assetCode}
                  </td>
                  <td className="py-3 text-right font-mono font-semibold text-gray-900 dark:text-white">
                    {amountStr}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-700 font-bold">
                  <td className="pt-4 text-base text-gray-900 dark:text-white" colSpan={2}>
                    Total Amount Settled
                  </td>
                  <td className="pt-4 text-right text-base font-mono text-ophir-600 dark:text-ophir-400">
                    {amountStr}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Transaction Hash & On-Chain Audit */}
          <div className="py-6 space-y-4">
            <div>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Stellar Transaction Hash
              </span>
              {txHash ? (
                <div className="mt-1 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                  <span className="font-mono text-xs text-gray-900 dark:text-gray-200 break-all select-all">
                    {txHash}
                  </span>
                  <div className="no-print shrink-0 flex items-center gap-1">
                    <CopyButton value={txHash} label="Hash" />
                    {explorerUrl && (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline px-2 py-1"
                      >
                        View Explorer ↗
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <p className="font-mono text-xs text-gray-500 mt-1">—</p>
              )}
            </div>

            {explorerUrl && (
              <p className="print-only text-xs text-gray-500 font-mono break-all">
                Verification URL: {explorerUrl}
              </p>
            )}
          </div>

          {/* Settlement Footer */}
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800 text-center text-xs text-gray-500 dark:text-gray-400">
            <p className="font-medium text-gray-700 dark:text-gray-300">
              ✓ Cryptographically Verified On-Chain
            </p>
            <p className="mt-1 text-[11px]">
              This document serves as proof of payment execution recorded on the Stellar ledger.
              Generated by OphirPay.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
