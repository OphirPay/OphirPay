"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { getWalletConnector } from "@/lib/wallets";
import {
  isValidStellarAddress,
  buildPaymentTx,
  submitSignedTx,
  getStellarExplorerUrl,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  XLM_STROOPS,
} from "@/lib/stellar";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { recordPaymentOnChain } from "@/lib/contracts";
import { estimateTransactionFee } from "@/lib/fee-estimator";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/ui/CopyButton";
import { useApiMutation } from "@/hooks/useApiQuery";
import { AssetSelector } from "@/components/AssetSelector";
import { XLM_ASSET, type AssetInfo } from "@/lib/assets";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────

type TxStep =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "recording"
  | "done";
type TxResult =
  | {
      type: "success";
      txHash: string;
      amount: string;
      destination: string;
      onChain?: {
        status: "RECORDED" | "FAILED";
        txHash?: string;
        error?: string;
      };
    }
  | { type: "error"; message: string }
  | null;

// ── Page ──────────────────────────────────────────────────────

export default function SendPage() {
  const { wallet, fetchBalance } = useWallet();
  const toast = useToast();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [feeEstimate, setFeeEstimate] = useState<{ baseFee: string; congestion: string } | null>(null);
  const [memo, setMemo] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo>(XLM_ASSET);
  const [step, setStep] = useState<TxStep>("idle");
  const [result, setResult] = useState<TxResult>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Best-effort DB record — invalidates dashboard/payments caches on success
  const recordPaymentMutation = useApiMutation<
    {
      amount: number;
      assetCode: string;
      assetIssuer?: string;
      memo?: string;
      sourceAccountId: string;
      destAddress: string;
    },
    { id: string }
  >("/api/payments", {
    invalidateKeys: [["dashboard", "payments"], ["payments", "onchain"], ["events", "onchain"]],
  });

  // Fetch live fee estimate on mount
  useEffect(() => {
    estimateTransactionFee(1)
      .then((fee) => setFeeEstimate({ baseFee: fee.baseFee, congestion: fee.networkCongestion }))
      .catch(() => {});
  }, []);

  // ── Validation ───────────────────────────────────────────

  const validate = (): boolean => {
    setValidationError(null);

    if (!destination) {
      setValidationError("Please enter a destination address.");
      return false;
    }
    if (!isValidStellarAddress(destination)) {
      setValidationError("Invalid Stellar address. Must start with G and be 56 characters long.");
      return false;
    }
    if (destination === wallet.publicKey) {
      setValidationError("Cannot send to your own address.");
      return false;
    }
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setValidationError("Please enter a valid amount greater than 0.");
      return false;
    }
    if (memo.length > 28) {
      setValidationError("Memo must be 28 characters or fewer.");
      return false;
    }
    return true;
  };

  // ── Send Flow ────────────────────────────────────────────

  const handleSend = async () => {
    if (!wallet.publicKey) return;
    if (!validate()) return;

    setResult(null);
    setStep("building");

    try {
      // 1. Build the transaction
      const { xdr } = await buildPaymentTx({
        sourcePublicKey: wallet.publicKey,
        destination: destination.trim(),
        amount,
        memo: memo.trim() || undefined,
        assetCode: selectedAsset.code,
        assetIssuer: selectedAsset.issuer,
      });

      // 2. Sign with the active wallet connector
      setStep("signing");

      if (!wallet.activeWalletId) {
        throw new Error("No wallet connected. Please connect a wallet first.");
      }

      const connector = getWalletConnector(wallet.activeWalletId);
      const signedXdr = await connector.signTransaction(xdr, {
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // 3. Submit to Horizon
      setStep("submitting");
      const response = await submitSignedTx(signedXdr);

      // 4. Record the payment on-chain via the Soroban contract.
      //    Best-effort: the Horizon payment is already settled, so a failure
      //    here is surfaced as a non-blocking warning on the success screen.
      setStep("recording");
      const onChain = await recordPaymentOnChain({
        payer: wallet.publicKey,
        payee: destination.trim(),
        amountStroops: Math.round(parseFloat(amount) * XLM_STROOPS),
        txHash: response.hash,
        signTransaction: (xdr, opts) => connector.signTransaction(xdr, opts),
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // 5. Create a DB payment record (triggers webhooks automatically)
      try {
        await recordPaymentMutation.mutateAsync({
          amount: parseFloat(amount),
          assetCode: selectedAsset.code,
          assetIssuer: selectedAsset.issuer,
          memo: memo.trim() || undefined,
          sourceAccountId: wallet.publicKey,
          destAddress: destination.trim(),
        });
      } catch {
        // Best-effort: payment already settled on-chain
      }

      // 6. Success!
      setStep("done");
      setResult({
        type: "success",
        txHash: response.hash,
        amount,
        destination: destination.trim(),
        onChain,
      });

      // Refresh balance after successful transaction
      fetchBalance();
      toast.success("Payment sent!", `${formatAmount(parseFloat(amount), "XLM")} to ${shortenAddress(destination.trim(), 6)}`);
    } catch (err) {
      setStep("done");
      const message =
        err instanceof Error ? err.message : "Transaction failed. Please try again.";
      setResult({ type: "error", message });
      toast.error("Transaction failed", message);
    }
  };

  const reset = () => {
    setStep("idle");
    setResult(null);
    setAmount("");
    setDestination("");
    setMemo("");
    setValidationError(null);
  };

  // ── Not connected state ──────────────────────────────────

  if (!wallet.connected) {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in">
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
            You need to connect a Stellar wallet to send payments.
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

  // ── Success state ────────────────────────────────────────

  if (result?.type === "success") {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          {/* Success icon */}
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

          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Payment Sent!
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Your transaction has been submitted to the Stellar network.
          </p>

          {/* Transaction details */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-left space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Amount</span>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                {formatAmount(parseFloat(result.amount), "XLM")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">To</span>
              <span className="text-sm font-mono text-gray-900 dark:text-white">
                {shortenAddress(result.destination, 6)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">TX Hash</span>
              <span className="flex items-center gap-2">
                <a
                  href={getStellarExplorerUrl(result.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  {shortenAddress(result.txHash, 8)}
                </a>
                <CopyButton value={result.txHash} label="Hash" />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">On-chain record</span>
              {result.onChain?.status === "RECORDED" ? (
                <a
                  href={
                    result.onChain.txHash
                      ? getStellarExplorerUrl(result.onChain.txHash)
                      : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono text-green-600 dark:text-green-400 hover:underline"
                >
                  ✓ Recorded
                  {result.onChain.txHash
                    ? ` · ${shortenAddress(result.onChain.txHash, 6)}`
                    : ""}
                </a>
              ) : (
                <span
                  className="text-sm text-amber-600 dark:text-amber-400"
                  title={result.onChain?.error ?? "On-chain record not created"}
                >
                  ⚠ Pending
                </span>
              )}
            </div>
          </div>

          {result.onChain?.status === "FAILED" && (
            <div className="mb-6 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                The payment was sent, but the on-chain record could not be
                created{result.onChain.error ? ` (${result.onChain.error})` : ""}.
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Send Another
            </button>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────

  if (result?.type === "error") {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in">
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
            Transaction Failed
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
              href="/"
              className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Form state ───────────────────────────────────────────

  const isSubmitting = step !== "idle" && step !== "done";

  return (
    <div className="max-w-lg mx-auto mt-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
          Send Payment
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Send {selectedAsset.code} on the Stellar Testnet
        </p>
        {selectedAsset.type !== "native" && selectedAsset.issuer && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Non-native asset — recipient needs a trustline to{" "}
            {selectedAsset.issuer.slice(0, 8)}...
          </p>
        )}
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

      {/* Form */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        {/* Destination */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Destination Address
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={isSubmitting}
            placeholder="G..."
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Asset Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Asset
          </label>
          <AssetSelector
            publicKey={wallet.publicKey}
            selectedAsset={selectedAsset}
            onSelect={setSelectedAsset}
            disabled={isSubmitting}
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Amount
          </label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting}
              placeholder="0.00"
              step="0.0000001"
              min="0.0000001"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
              {selectedAsset.code}
            </span>
          </div>
          {feeEstimate && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                Network fee: ~{feeEstimate.baseFee} stroops
              </span>
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                feeEstimate.congestion === "low" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                feeEstimate.congestion === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}>
                {feeEstimate.congestion}
              </span>
            </div>
          )}
        </div>

        {/* Memo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Memo <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. Payment for services"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            A Stellar memo is an optional note (up to 28 bytes) attached to the
            transaction. Some exchanges and services require a memo or
            destination tag to credit payments — include it if the recipient
            asked for one.
          </p>
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
                ? "Building transaction..."
                : step === "signing"
                  ? "Waiting for signature..."
                  : step === "recording"
                    ? "Recording on-chain (sign to confirm)..."
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
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
              {`Send ${selectedAsset.code}`}
            </>
          )}
        </button>

        {isSubmitting && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
            {step === "signing"
              ? "Check your wallet to approve the transaction..."
              : step === "submitting"
                ? "Sending to the Stellar testnet..."
                : step === "recording"
                  ? "Confirming the on-chain payment record..."
                  : ""}
          </p>
        )}
      </div>
    </div>
  );
}
