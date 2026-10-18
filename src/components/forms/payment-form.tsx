"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FeeSelector, type FeeTier } from "@/components/ui/FeeSelector";
import { isValidStellarAddress } from "@/lib/stellar";
import { validateMemo } from "@/lib/validation-helpers";
import { useToast } from "@/components/ui/Toast";

export interface PaymentSubmissionPayload {
  destination: string;
  amount: string;
  memo?: string;
  fee: number; // in stroops
  feeTier: FeeTier;
}

export interface PaymentFormProps {
  /** Optional pre-filled destination. */
  defaultDestination?: string;
  /** Optional pre-filled amount. */
  defaultAmount?: string;
  /** Callback invoked when the user submits valid payment data with the selected fee. */
  onSubmit?: (payload: PaymentSubmissionPayload) => Promise<void> | void;
  /** Whether form submission is currently loading. */
  isSubmitting?: boolean;
  /** Whether the user wallet is connected. */
  isWalletConnected?: boolean;
}

export function PaymentForm({
  defaultDestination = "",
  defaultAmount = "",
  onSubmit,
  isSubmitting = false,
  isWalletConnected = true,
}: PaymentFormProps) {
  const toast = useToast();
  const [destination, setDestination] = useState(defaultDestination);
  const [amount, setAmount] = useState(defaultAmount);
  const [memo, setMemo] = useState("");
  const [fee, setFee] = useState<number>(150);
  const [feeTier, setFeeTier] = useState<FeeTier>("recommended");
  const [error, setError] = useState<string | null>(null);

  const handleFeeChange = (newFee: number, tier: FeeTier) => {
    setFee(newFee);
    setFeeTier(tier);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!destination.trim()) {
      setError("Please enter a destination address.");
      return;
    }
    if (!isValidStellarAddress(destination.trim())) {
      setError("Invalid Stellar address format (must be 56 characters starting with G).");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount greater than 0.");
      return;
    }

    const memoError = validateMemo(memo);
    if (memoError) {
      setError(memoError);
      return;
    }

    if (!fee || fee < 100) {
      setError("Transaction fee must meet the network minimum (at least 100 stroops).");
      return;
    }

    try {
      if (onSubmit) {
        await onSubmit({
          destination: destination.trim(),
          amount: amount.trim(),
          memo: memo.trim() || undefined,
          fee,
          feeTier,
        });
      } else {
        toast.success(`Payment payload prepared with ${fee} stroops fee`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment submission failed.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          Send Payment
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Transfer native XLM with live dynamic network fee optimization.
        </p>
      </div>

      {error && (
        <div role="alert" data-testid="payment-form-error" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Recipient Stellar Address
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="G..."
            data-testid="payment-destination-input"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Amount (XLM)
          </label>
          <input
            type="number"
            min="0.0000001"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="payment-amount-input"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Transaction Memo <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={28}
            placeholder="Max 28 bytes"
            data-testid="payment-memo-input"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        {/* Live Network Fee Estimator Widget */}
        <FeeSelector
          selectedFee={fee}
          onChange={handleFeeChange}
          disabled={isSubmitting}
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        loading={isSubmitting}
        disabled={!isWalletConnected || isSubmitting}
        data-testid="submit-payment-btn"
      >
        {!isWalletConnected ? "Connect Wallet to Send" : "Sign and Submit Payment"}
      </Button>
    </form>
  );
}

export default PaymentForm;
