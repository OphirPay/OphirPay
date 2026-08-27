"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { getWalletConnector } from "@/lib/wallets";
import {
  isValidStellarAddress,
  buildBatchPaymentTx,
  submitSignedTx,
  getStellarExplorerUrl,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { estimateBatchFee } from "@/lib/fee-estimator";
import { BatchConfirmDialog } from "@/components/BatchConfirmDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import Link from "next/link";
import type { BatchRecipientInput } from "@/lib/stellar";

// ── Types ─────────────────────────────────────────────────────

interface RecipientRow {
  id: number;
  address: string;
  amount: string;
  memo: string;
}

type TxStep = "idle" | "building" | "signing" | "submitting" | "done";

interface TxResultItem {
  address: string;
  amount: string;
  status: "success" | "error";
  message?: string;
}

interface TxResult {
  type: "success" | "error";
  txHash?: string;
  message?: string;
  items?: TxResultItem[];
}

// ── Page ──────────────────────────────────────────────────────

let nextId = 0;

export default function NewBatchPage() {
  const { wallet } = useWallet();

  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { id: nextId++, address: "", amount: "", memo: "" },
  ]);
  const [step, setStep] = useState<TxStep>("idle");
  const [result, setResult] = useState<TxResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Recipient management ──────────────────────────────────

  const addRecipient = () => {
    if (recipients.length >= 50) return;
    setRecipients([
      ...recipients,
      { id: nextId++, address: "", amount: "", memo: "" },
    ]);
  };

  const removeRecipient = (id: number) => {
    if (recipients.length <= 1) return;
    setRecipients(recipients.filter((r) => r.id !== id));
  };

  const updateRecipient = (
    id: number,
    field: keyof RecipientRow,
    value: string
  ) => {
    setRecipients(
      recipients.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  // ── Validation ───────────────────────────────────────────

  const validate = (): boolean => {
    setValidationError(null);

    let totalAmount = 0;
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (!r.address) {
        setValidationError(`Recipient #${i + 1}: address is required.`);
        return false;
      }
      if (!isValidStellarAddress(r.address)) {
        setValidationError(
          `Recipient #${i + 1}: invalid Stellar address "${shortenAddress(r.address)}".`
        );
        return false;
      }
      if (r.address === wallet.publicKey) {
        setValidationError(
          `Recipient #${i + 1}: cannot send to your own address.`
        );
        return false;
      }
      const amountNum = parseFloat(r.amount);
      if (!r.amount || isNaN(amountNum) || amountNum <= 0) {
        setValidationError(
          `Recipient #${i + 1}: please enter a valid amount greater than 0.`
        );
        return false;
      }
      if (r.memo.length > 28) {
        setValidationError(
          `Recipient #${i + 1}: memo must be 28 characters or fewer.`
        );
        return false;
      }
      totalAmount += amountNum;
    }

    const balanceNum = wallet.balance ? parseFloat(wallet.balance) : 0;
    if (totalAmount > balanceNum) {
      setValidationError(
        `Insufficient balance. Total needed: ${formatAmount(totalAmount, "XLM")}, available: ${formatAmount(balanceNum, "XLM")}.`
      );
      return false;
    }

    // Check for duplicate addresses
    const addresses = recipients.map((r) => r.address.trim());
    const unique = new Set(addresses);
    if (unique.size !== addresses.length) {
      setValidationError("Duplicate recipient addresses detected.");
      return false;
    }

    return true;
  };

  // ── Send Flow ────────────────────────────────────────────

  const handleSend = async () => {
    if (!wallet.publicKey) return;
    if (!validate()) return;
    setShowConfirm(true);
  };

  const handleConfirmSend = async () => {
    if (!wallet.publicKey) return;

    setShowConfirm(false);
    setResult(null);
    setStep("building");

    try {
      const batchRecipients: BatchRecipientInput[] = recipients.map((r) => ({
        address: r.address.trim(),
        amount: r.amount,
        memo: r.memo.trim() || undefined,
      }));

      // 1. Build the batch transaction
      const { xdr } = await buildBatchPaymentTx({
        sourcePublicKey: wallet.publicKey,
        recipients: batchRecipients,
      });

      // 2. Sign with the active wallet connector
      setStep("signing");

      if (!wallet.activeWalletId) {
        throw new Error("No wallet connected. Please connect a wallet first.");
      }

      const connector = getWalletConnector(wallet.activeWalletId);
      const signedXdr = await connector.signTransaction(xdr, {
        network: "TESTNET",
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // 3. Submit to Horizon
      setStep("submitting");
      const response = await submitSignedTx(signedXdr);

      // 4. Success!
      setStep("done");
      setResult({
        type: "success",
        txHash: response.hash,
        items: batchRecipients.map((r) => ({
          address: r.address,
          amount: r.amount,
          status: "success" as const,
        })),
      });
    } catch (err) {
      setStep("done");
      const message =
        err instanceof Error ? err.message : "Batch transaction failed.";
      setResult({ type: "error", message });
    }
  };

  const reset = () => {
    setStep("idle");
    setResult(null);
    setRecipients([{ id: nextId++, address: "", amount: "", memo: "" }]);
    setValidationError(null);
  };

  // ── Total ────────────────────────────────────────────────

  const totalAmount = recipients.reduce((sum, r) => {
    const n = parseFloat(r.amount);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  // ── Not connected ───────────────────────────────────────

  if (!wallet.connected) {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-10 text-center">
          <div className="h-16 w-16 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
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
                d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Connect Your Wallet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Connect your Stellar wallet to create batch payments.
          </p>
          <Link
            href="/"
            className="text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────

  if (result?.type === "success") {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8">
          <div className="text-center mb-6">
            <div className="h-16 w-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-8 h-8 text-green-600 dark:text-green-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Batch Payment Sent!
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {result.items?.length} payments processed in a single transaction
            </p>
          </div>

          {result.txHash && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 mb-6 flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">TX Hash</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-sm font-mono text-gray-900 dark:text-white">
                    {shortenAddress(result.txHash, 10)}
                  </p>
                  <CopyButton value={result.txHash} label="Hash" />
                </div>
              </div>
              <a
                href={getStellarExplorerUrl(result.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
              >
                View on Explorer ↗
              </a>
            </div>
          )}

          <div className="space-y-2 mb-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Recipients
            </h3>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {result.items?.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                        className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                        {shortenAddress(item.address, 6)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white ml-4">
                    {formatAmount(parseFloat(item.amount), "XLM")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Create Another Batch
            </button>
            <Link
              href="/batches"
              className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              View All Batches
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────

  if (result?.type === "error") {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <div className="h-16 w-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-8 h-8 text-red-600 dark:text-red-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Batch Failed
          </h2>
          <p className="text-sm text-red-600 dark:text-red-400 mb-6 max-w-sm mx-auto">
            {result.message}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Try Again
            </button>
            <Link
              href="/batches"
              className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              View All Batches
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────

  const isSubmitting = step !== "idle" && step !== "done";

  return (
    <div className="max-w-2xl mx-auto mt-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/batches"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          ← All Batches
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
          New Batch Payment
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Send XLM to multiple recipients in a single transaction
        </p>
      </div>

      {/* Wallet info */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">From</p>
            <p className="text-sm font-mono font-medium text-gray-900 dark:text-white">
              {shortenAddress(wallet.publicKey!, 6)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500 dark:text-gray-400">Balance</p>
            <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
              {wallet.balance !== null
                ? formatAmount(parseFloat(wallet.balance), "XLM")
                : "Loading..."}
            </p>
          </div>
        </div>
      </div>

      {/* Recipients form */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Recipients
          </h2>
          <button
            onClick={addRecipient}
            disabled={isSubmitting || recipients.length >= 50}
            className="inline-flex items-center gap-1.5 text-sm text-ophir-600 dark:text-ophir-400 hover:text-ophir-700 dark:hover:text-ophir-300 font-medium disabled:opacity-50 transition-colors"
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
            Add Recipient
          </button>
        </div>

        <div className="space-y-3">
          {recipients.map((r, i) => (
            <RecipientRow
              key={r.id}
              index={i}
              recipient={r}
              onChange={updateRecipient}
              onRemove={removeRecipient}
              disabled={isSubmitting}
              canRemove={recipients.length > 1}
            />
          ))}
        </div>

        {/* Total */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Total ({recipients.length} recipient{recipients.length !== 1 ? "s" : ""})
          </span>
          <span className="text-lg font-bold font-mono text-gray-900 dark:text-white">
            {formatAmount(totalAmount, "XLM")}
          </span>
        </div>

        {/* Validation error */}
        {validationError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">
              {validationError}
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSend}
          disabled={isSubmitting}
          className="w-full py-3 rounded-lg bg-gradient-to-r from-ophir-600 to-stellar-dark text-white font-medium text-sm hover:from-ophir-700 hover:to-stellar disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-ophir-500/25 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {step === "building"
                ? "Building batch transaction..."
                : step === "signing"
                  ? "Waiting for signature..."
                  : "Submitting to Stellar..."}
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
                />
              </svg>
              Send Batch Payment
            </>
          )}
        </button>

        {isSubmitting && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
            {step === "signing"
              ? "Check your wallet to approve..."
              : step === "submitting"
                ? `Sending ${recipients.length} payments to Stellar testnet...`
                : ""}
          </p>
        )}
      </div>

      {/* Confirmation dialog */}
      <BatchConfirmDialog
        open={showConfirm}
        recipients={recipients.map((r) => ({
          address: r.address,
          amount: r.amount,
        }))}
        totalAmount={totalAmount}
        estimatedFee={estimateBatchFee(recipients.length)}
        onConfirm={handleConfirmSend}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}

// ── Recipient Row ─────────────────────────────────────────────

function RecipientRow({
  index,
  recipient,
  onChange,
  onRemove,
  disabled,
  canRemove,
}: {
  index: number;
  recipient: RecipientRow;
  onChange: (id: number, field: keyof RecipientRow, value: string) => void;
  onRemove: (id: number) => void;
  disabled: boolean;
  canRemove: boolean;
}) {
  return (
    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Recipient #{index + 1}
        </span>
        {canRemove && (
          <button
            onClick={() => onRemove(recipient.id)}
            disabled={disabled}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Address */}
        <div className="sm:col-span-2">
          <input
            type="text"
            value={recipient.address}
            onChange={(e) =>
              onChange(recipient.id, "address", e.target.value)
            }
            disabled={disabled}
            placeholder="G... destination address"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Amount */}
        <div className="relative">
          <input
            type="number"
            value={recipient.amount}
            onChange={(e) =>
              onChange(recipient.id, "amount", e.target.value)
            }
            disabled={disabled}
            placeholder="0.00"
            step="0.0000001"
            min="0.0000001"
            className="w-full px-3 py-2 pr-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
            XLM
          </span>
        </div>

        {/* Memo */}
        <input
          type="text"
          value={recipient.memo}
          onChange={(e) =>
            onChange(recipient.id, "memo", e.target.value)
          }
          disabled={disabled}
          placeholder="Memo (optional)"
          maxLength={28}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
