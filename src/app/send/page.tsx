"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useMultiWallet";
import { getWalletConnector } from "@/lib/wallets";
import {
  isValidStellarAddress,
  buildPaymentTx,
  buildPathPaymentStrictSendTx,
  findStrictSendPath,
  type PathPaymentEstimate,
  submitSignedTx,
  getStellarExplorerUrl,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  XLM_STROOPS,
  accountExists,
  parseSubmissionError,
  SPONSOR_MIN_STARTING_BALANCE,
} from "@/lib/stellar";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { validateMemo } from "@/lib/validation-helpers";
import { recordPaymentOnChain } from "@/lib/contracts";
import { downloadReceiptPdf } from "@/lib/receipt-pdf";
import { estimateTransactionFee } from "@/lib/fee-estimator";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/ui/CopyButton";
import { useApiMutation } from "@/hooks/useApiQuery";
import { AssetSelector } from "@/components/AssetSelector";
import { XLM_ASSET, getAssetInfo, type AssetInfo } from "@/lib/assets";
import { nextRunAt, FREQUENCY_OPTIONS, FREQUENCY_LABELS, frequencyLabel, type Frequency } from "@/lib/recurrence";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────

type TxStep =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "recording"
  | "scheduling"
  | "done";

type TxResult =
  | {
      type: "success";
      txHash: string;
      amount: string;
      sourceAsset: AssetInfo;
      destination: string;
      isCrossAsset: boolean;
      destAsset?: AssetInfo;
      destAmount?: string;
      destMin?: string;
      exchangeRate?: number;
      onChain?: {
        status: "RECORDED" | "FAILED";
        txHash?: string;
        error?: string;
      };
    }
  | {
      type: "scheduled";
      id: string;
      amount: string;
      destination: string;
      scheduledFor: string;
    }
  | { type: "error"; message: string }
  | null;

// ── Page ──────────────────────────────────────────────────────

export default function SendPage() {
  // `useSearchParams` requires a Suspense boundary during static prerendering.
  return (
    <Suspense fallback={null}>
      <SendPageClient />
    </Suspense>
  );
}

function SendPageClient() {
  const { wallet, fetchBalance } = useWallet();
  const toast = useToast();
  const searchParams = useSearchParams();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [feeEstimate, setFeeEstimate] = useState<{ baseFee: string; congestion: string } | null>(null);
  const [memo, setMemo] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo>(XLM_ASSET);
  const [destAsset, setDestAsset] = useState<AssetInfo>(XLM_ASSET);
  const [step, setStep] = useState<TxStep>("idle");
  const [result, setResult] = useState<TxResult>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  // Sponsored-account (new recipient) support
  const [sponsorCreate, setSponsorCreate] = useState(false);
  const [recipientStatus, setRecipientStatus] = useState<
    "unknown" | "checking" | "funded" | "unfunded"
  >("unknown");

  // Recurring-payment mode: instead of a one-time on-chain send, the form
  // records a DB Recurrence schedule (issue #172).
  const [mode, setMode] = useState<"one-time" | "recurring">("one-time");
  const [frequency, setFrequency] = useState<Frequency>("DAILY");

  // Path payment estimate state
  const [pathEstimate, setPathEstimate] = useState<PathPaymentEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const isCrossAsset =
    selectedAsset.code !== destAsset.code || selectedAsset.issuer !== destAsset.issuer;

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

  // Records a DB Recurrence schedule when the user picks the recurring mode.
  const createRecurrenceMutation = useApiMutation<
    {
      name: string;
      frequency: string;
      amount: number;
      assetCode: string;
      destAddress: string;
      description?: string;
      sourceAccountId: string;
    },
    { id: string; nextRunAt: string }
  >("/api/recurring", {
    invalidateKeys: [["recurring"]],
  });

  // Fetch live fee estimate on mount
  useEffect(() => {
    estimateTransactionFee(1)
      .then((fee) => setFeeEstimate({ baseFee: fee.baseFee, congestion: fee.networkCongestion }))
      .catch(() => {});
  }, []);

  // Pre-fill the form from a shareable payment link (?dest=...&amount=...&memo=...&asset=...)
  useEffect(() => {
    const dest = searchParams?.get("dest");
    if (!dest) return;

    if (!isValidStellarAddress(dest)) {
      setValidationError(
        "Invalid Stellar address in payment link. Must start with G and be 56 characters long."
      );
      return;
    }

    setDestination(dest);
    const amountParam = searchParams?.get("amount");
    if (amountParam) setAmount(amountParam);
    const memoParam = searchParams?.get("memo");
    if (memoParam) setMemo(memoParam);
    const assetParam = searchParams?.get("asset");
    if (assetParam) {
      setSelectedAsset(getAssetInfo(assetParam));
    }
  }, [searchParams]);

  // Detect whether the recipient account is funded. A 404 means the account
  // does not exist yet, in which case we can offer to sponsor its creation.
  useEffect(() => {
    const dest = destination.trim();
    if (!isValidStellarAddress(dest) || dest === wallet.publicKey) {
      setRecipientStatus("unknown");
      return;
    }

    let cancelled = false;
    setRecipientStatus("checking");
    const timer = setTimeout(() => {
      accountExists(dest)
        .then((exists) => {
          if (cancelled) return;
          setRecipientStatus(exists ? "funded" : "unfunded");
        })
        .catch(() => {
          if (!cancelled) setRecipientStatus("unknown");
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination, wallet.publicKey]);

  // Fetch strict-send path estimate when cross-asset send is active
  useEffect(() => {
    if (!isCrossAsset) {
      setPathEstimate(null);
      setPathError(null);
      setIsEstimating(false);
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setPathEstimate(null);
      setPathError(null);
      setIsEstimating(false);
      return;
    }

    let active = true;
    setIsEstimating(true);
    setPathError(null);

    const timeoutId = setTimeout(async () => {
      try {
        const estimate = await findStrictSendPath({
          sourceAssetCode: selectedAsset.code,
          sourceAssetIssuer: selectedAsset.issuer,
          sendAmount: amount,
          destAssetCode: destAsset.code,
          destAssetIssuer: destAsset.issuer,
          destinationAddress:
            destination && isValidStellarAddress(destination.trim())
              ? destination.trim()
              : undefined,
        });

        if (!active) return;

        if (estimate) {
          setPathEstimate(estimate);
          setPathError(null);
        } else {
          setPathEstimate(null);
          setPathError(
            `No path found with sufficient liquidity on the Stellar network between ${selectedAsset.code} and ${destAsset.code}.`
          );
        }
      } catch {
        if (active) {
          setPathEstimate(null);
          setPathError(
            `Failed to discover conversion path between ${selectedAsset.code} and ${destAsset.code}.`
          );
        }
      } finally {
        if (active) {
          setIsEstimating(false);
        }
      }
    }, 100);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [isCrossAsset, amount, selectedAsset, destAsset, destination]);

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
    const memoError = validateMemo(memo);
    if (memoError) {
      setValidationError(memoError);
      return false;
    }
    if (recipientStatus === "unfunded" &&
      !sponsorCreate &&
      selectedAsset.type === "native" &&
      mode === "one-time"
    ) {
      setValidationError(
        "This recipient account does not exist yet. Enable “Fund new account (sponsor)” to create it in the same transaction, or use an existing address."
      );
      return false;
    }
    if (isCrossAsset && mode === "one-time") {
      if (isEstimating) {
        setValidationError("Calculating exchange rate path... Please wait.");
        return false;
      }
      if (!pathEstimate || pathError) {
        setValidationError(
          pathError || `No conversion path available between ${selectedAsset.code} and ${destAsset.code}.`
        );
        return false;
      }
    }
    return true;
  };

  // ── Send Flow ────────────────────────────────────────────

  const handleSend = async () => {
    if (!wallet.publicKey) return;
    if (!validate()) return;

    setResult(null);

    // ── Scheduled flow: persist via the API, no wallet signing ──
    if (scheduleEnabled) {
      setStep("scheduling");
      try {
        const created = await schedulePaymentMutation.mutateAsync({
          amount: parseFloat(amount),
          assetCode: selectedAsset.code,
          assetIssuer: selectedAsset.issuer,
          memo: memo.trim() || undefined,
          destAddress: destination.trim(),
          scheduledFor: new Date(scheduledFor).toISOString(),
        });
        setStep("done");
        setResult({
          type: "scheduled",
          id: created.id,
          amount,
          destination: destination.trim(),
          scheduledFor: new Date(scheduledFor).toISOString(),
        });
        toast.success(
          "Payment scheduled",
          `${formatAmount(parseFloat(amount), selectedAsset.code)} to ${shortenAddress(destination.trim(), 6)}`
        );
      } catch (err) {
        setStep("done");
        const message =
          err instanceof Error ? err.message : "Failed to schedule the payment.";
        setResult({ type: "error", message });
        toast.error("Failed to schedule payment", message);
      }
      return;
    }

    setStep("building");

    try {
      // Recurring mode — record a DB Recurrence schedule instead of executing
      // a one-time on-chain payment (issue #172).
      if (mode === "recurring") {
        const nextRun = nextRunAt(new Date(), frequency);
        await createRecurrenceMutation.mutateAsync({
          name: memo.trim() || `Recurring ${frequency.toLowerCase()} payment`,
          frequency,
          amount: parseFloat(amount),
          assetCode: selectedAsset.code,
          destAddress: destination.trim(),
          description: memo.trim() || undefined,
          sourceAccountId: wallet.publicKey,
        });

        setStep("done");
        setResult({
          type: "success",
          txHash: "",
          amount,
          sourceAsset: selectedAsset,
          destination: destination.trim(),
          isCrossAsset: false,
        });

        fetchBalance();
        toast.success(
          "Recurring payment scheduled",
          `${formatAmount(parseFloat(amount), selectedAsset.code)} ${frequencyLabel(frequency)} → ${shortenAddress(destination.trim(), 6)} · next run ${nextRun.toLocaleDateString()}`
        );
        return;
      }

      // 1. Build the transaction
      let xdr: string;

      if (isCrossAsset && pathEstimate) {
        // Use PathPaymentStrictSend when source and destination assets differ
        const res = await buildPathPaymentStrictSendTx({
          sourcePublicKey: wallet.publicKey,
          destination: destination.trim(),
          sendAmount: amount,
          destMin: pathEstimate.destMin,
          sourceAssetCode: selectedAsset.code,
          sourceAssetIssuer: selectedAsset.issuer,
          destAssetCode: destAsset.code,
          destAssetIssuer: destAsset.issuer,
          path: pathEstimate.path,
          memo: memo.trim() || undefined,
        });
        xdr = res.xdr;
      } else {
        // Standard Direct Payment
        const res = await buildPaymentTx({
          sourcePublicKey: wallet.publicKey,
          destination: destination.trim(),
          amount,
          memo: memo.trim() || undefined,
          assetCode: selectedAsset.code,
          assetIssuer: selectedAsset.issuer,
          sponsorCreate,
        });
        xdr = res.xdr;
      }

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

      // 4. Record the payment on-chain via Soroban contract
      setStep("recording");
      const onChain = await recordPaymentOnChain({
        payer: wallet.publicKey,
        payee: destination.trim(),
        amountStroops: Math.round(parseFloat(amount) * XLM_STROOPS),
        txHash: response.hash,
        signTransaction: (xdrToSign, opts) => connector.signTransaction(xdrToSign, opts),
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // 5. Create DB payment record
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
        sourceAsset: selectedAsset,
        destination: destination.trim(),
        isCrossAsset,
        destAsset: isCrossAsset ? destAsset : undefined,
        destAmount: pathEstimate?.destinationAmount,
        destMin: pathEstimate?.destMin,
        exchangeRate: pathEstimate?.exchangeRate,
        onChain,
      });

      // Refresh balance after successful transaction
      fetchBalance();

      if (isCrossAsset && pathEstimate) {
        toast.success(
          "Path Payment Sent!",
          `Sent ${formatAmount(parseFloat(amount), selectedAsset.code)} → Recipient receives ~${pathEstimate.destinationAmount} ${destAsset.code}`
        );
      } else {
        toast.success(
          "Payment sent!",
          `${formatAmount(parseFloat(amount), selectedAsset.code)} to ${shortenAddress(destination.trim(), 6)}`
        );
      }
    } catch (err) {
      setStep("done");
      const message = parseSubmissionError(err);
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
    setSponsorCreate(false);
    setRecipientStatus("unknown");
    setPathEstimate(null);
    setPathError(null);
    setValidationError(null);
    setMode("one-time");
    setFrequency("DAILY");
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
            {result.isCrossAsset ? "Path Payment Completed!" : "Payment Sent!"}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Your transaction has been confirmed on the Stellar network.
          </p>

          {/* Transaction details */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-left space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {result.isCrossAsset ? "You Sent" : "Amount"}
              </span>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                {formatAmount(parseFloat(result.amount), result.sourceAsset.code)}
              </span>
            </div>

            {result.isCrossAsset && result.destAsset && (
              <>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Recipient Receives (est.)
                  </span>
                  <span className="text-sm font-mono font-semibold text-green-600 dark:text-green-400">
                    {`~${result.destAmount} ${result.destAsset.code}`}
                  </span>
                </div>

                {result.exchangeRate !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Exchange Rate
                    </span>
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-300">
                      1 {result.sourceAsset.code} ≈ {result.exchangeRate.toFixed(6)} {result.destAsset.code}
                    </span>
                  </div>
                )}
              </>
            )}

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

          <div className="flex flex-col gap-3">
            <button
              onClick={() =>
                downloadReceiptPdf({
                  transactionHash: result.txHash,
                  amount: result.amount,
                  assetCode: selectedAsset.code,
                  date: new Date().toISOString(),
                  sender: wallet.publicKey!,
                  recipient: result.destination,
                  memo: memo.trim() || undefined,
                })
              }
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
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
      </div>
    );
  }

  // ── Scheduled confirmation state ─────────────────────────

  if (result?.type === "scheduled") {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          {/* Clock icon */}
          <div className="h-16 w-16 mx-auto rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-8 h-8 text-blue-600 dark:text-blue-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Payment Scheduled!
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Your payment will be sent automatically at the scheduled time.
          </p>

          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-left space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Amount</span>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                {formatAmount(parseFloat(result.amount), selectedAsset.code)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">To</span>
              <span className="text-sm font-mono text-gray-900 dark:text-white">
                {shortenAddress(result.destination, 6)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Scheduled for</span>
              <span className="text-sm font-mono text-gray-900 dark:text-white">
                {formatDate(result.scheduledFor)}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
            You can cancel the payment any time before it runs from the
            Scheduled Payments list on the send form.
          </p>

          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Schedule Another
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
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Send Payment
          </h1>
          {isCrossAsset && mode === "one-time" && (
            <span
              data-testid="cross-asset-badge"
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-ophir-100 text-ophir-800 dark:bg-ophir-950/50 dark:text-ophir-300 border border-ophir-200 dark:border-ophir-800"
            >
              ⚡ Path Payment
            </span>
          )}
        </div>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {mode === "recurring"
            ? `Schedule a recurring ${selectedAsset.code} payment on Stellar`
            : isCrossAsset
              ? `Cross-asset transfer: Pay in ${selectedAsset.code}, recipient receives ${destAsset.code}`
              : `Send ${selectedAsset.code} on the Stellar Testnet`}
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

      {/* Form */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        {/* Payment type toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl" role="tablist" aria-label="Payment type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "one-time"}
            onClick={() => setMode("one-time")}
            disabled={isSubmitting}
            data-testid="mode-one-time"
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
              mode === "one-time"
                ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            One-time
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "recurring"}
            onClick={() => setMode("recurring")}
            disabled={isSubmitting}
            data-testid="mode-recurring"
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
              mode === "recurring"
                ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            Recurring
          </button>
        </div>

        {/* Destination */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Destination Address
          </label>
          <AddressAutocomplete
            value={destination}
            onChange={setDestination}
            disabled={isSubmitting}
            placeholder="G..."
            data-testid="destination-input"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            Start typing to autocomplete from your{" "}
            <Link
              href="/address-book"
              className="text-ophir-600 dark:text-ophir-400 hover:underline"
            >
              address book
            </Link>
            .
          </p>
        </div>

        {/* Source Asset Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            You Send (Source Asset)
          </label>
          <AssetSelector
            publicKey={wallet.publicKey}
            selectedAsset={selectedAsset}
            onSelect={setSelectedAsset}
            disabled={isSubmitting}
          />
        </div>

        {/* Destination Asset Selector */}
        {mode === "one-time" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Recipient Receives (Destination Asset)
              </label>
              {isCrossAsset && (
                <button
                  type="button"
                  onClick={() => setDestAsset(selectedAsset)}
                  className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  Match Source ({selectedAsset.code})
                </button>
              )}
            </div>
            <AssetSelector
              publicKey={destination && isValidStellarAddress(destination) ? destination : null}
              selectedAsset={destAsset}
              onSelect={setDestAsset}
              disabled={isSubmitting}
            />
          </div>
        )}

        {/* Recurring frequency picker + next-run preview */}
        {mode === "recurring" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              disabled={isSubmitting}
              data-testid="frequency-input"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
            {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
              <div
                data-testid="next-run-preview"
                className="mt-2 p-3 rounded-lg bg-ophir-50 dark:bg-ophir-950/30 border border-ophir-200 dark:border-ophir-800"
              >
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  First run scheduled for{" "}
                  <span className="font-medium text-ophir-700 dark:text-ophir-300">
                    {nextRunAt(new Date(), frequency).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  , then {frequencyLabel(frequency).toLowerCase()}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Amount to Send
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
              data-testid="amount-input"
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

        {/* Cross-Asset Rate Preview Card */}
        {isCrossAsset && mode === "one-time" && (
          <div
            data-testid="rate-preview-card"
            className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
              <span className="flex items-center gap-1.5">
                <span className="text-base">💱</span> Rate & Route Preview
              </span>
              {isEstimating && (
                <span className="text-ophir-600 dark:text-ophir-400 animate-pulse font-normal">
                  Finding best path...
                </span>
              )}
            </div>

            {pathEstimate && !isEstimating && (
              <div className="space-y-2 text-xs pt-1">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Exchange Rate:</span>
                  <span
                    data-testid="exchange-rate-display"
                    className="font-mono font-medium text-gray-900 dark:text-white"
                  >
                    {`1 ${selectedAsset.code} ≈ ${pathEstimate.exchangeRate.toFixed(6)} ${destAsset.code}`}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">Estimated Receipt:</span>
                  <span
                    data-testid="estimated-dest-amount"
                    className="font-mono font-semibold text-green-600 dark:text-green-400 text-sm"
                  >
                    {`~${pathEstimate.destinationAmount} ${destAsset.code}`}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-400">Guaranteed Minimum (1% slippage):</span>
                  <span className="font-mono text-gray-600 dark:text-gray-300">
                    {pathEstimate.destMin} {destAsset.code}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px] pt-1 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-gray-400">Conversion Route:</span>
                  <span className="font-mono text-ophir-600 dark:text-ophir-400">
                    {[selectedAsset.code, ...pathEstimate.pathAssets.map((p) => p.code), destAsset.code].join(" → ")}
                  </span>
                </div>
              </div>
            )}

            {pathError && !isEstimating && (
              <div
                data-testid="path-error-box"
                className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400"
              >
                {pathError}
              </div>
            )}
          </div>
        )}

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
        </div>

        {/* Sponsored account creation */}
        {mode === "one-time" && recipientStatus === "unfunded" && selectedAsset.type === "native" && (
          <div className="p-3 rounded-lg bg-ophir-50 dark:bg-ophir-950/30 border border-ophir-200 dark:border-ophir-800">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sponsorCreate}
                onChange={(e) => setSponsorCreate(e.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-ophir-600 focus:ring-ophir-500 disabled:opacity-50"
              />
              <span className="text-sm">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  Fund new account (sponsor)
                </span>
                <span className="block text-gray-500 dark:text-gray-400 mt-0.5">
                  This address isn’t funded yet. Sponsor its creation by sending a{" "}
                  {SPONSOR_MIN_STARTING_BALANCE} XLM reserve in the same transaction
                  (total debited: {SPONSOR_MIN_STARTING_BALANCE} XLM + your amount + fee).
                </span>
              </span>
            </label>
          </div>
        )}

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
          disabled={isSubmitting || (mode === "one-time" && isCrossAsset && (!pathEstimate || Boolean(pathError)))}
          data-testid="send-btn"
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
              {mode === "recurring"
                ? "Scheduling recurring payment..."
                : step === "building"
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
              {mode === "recurring"
                ? "Schedule Recurring"
                : isCrossAsset
                  ? pathError
                    ? "No Path Available"
                    : `Send ${amount || "0"} ${selectedAsset.code} → ~${pathEstimate?.destinationAmount || "0"} ${destAsset.code}`
                  : `Send ${selectedAsset.code}`}
            </>
          )}
        </button>

        {isSubmitting && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
            {step === "scheduling"
              ? "Saving your scheduled payment..."
              : step === "signing"
                ? "Check your wallet to approve the transaction..."
                : step === "submitting"
                  ? "Sending to the Stellar testnet..."
                  : step === "recording"
                    ? "Confirming the on-chain payment record..."
                    : ""}
          </p>
        )}
      </div>

      {/* Upcoming scheduled payments */}
      <div className="mt-6">
        <ScheduledPaymentsList />
      </div>
    </div>
  );
}
