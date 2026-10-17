"use client";
// SPDX-License-Identifier: MIT

import { useState, type FormEvent } from "react";
import { useFeeStats, type UseFeeStatsOptions } from "@/hooks/useFeeStats";
import { FeeSelector, type FeeTierOption } from "@/components/ui/FeeSelector";
import { isValidStellarAddress } from "@/lib/stellar";

export interface PaymentFormSubmission {
  destination: string;
  amount: string;
  assetCode: string;
  memo?: string;
  feeStroops: number;
  feeTier: FeeTierOption;
}

export interface PaymentFormProps {
  onSubmit: (payload: PaymentFormSubmission) => void | Promise<void>;
  defaultAssetCode?: string;
  feeStatsOptions?: UseFeeStatsOptions;
}

export function PaymentForm({
  onSubmit,
  defaultAssetCode = "XLM",
  feeStatsOptions,
}: PaymentFormProps) {
  const { stats } = useFeeStats(feeStatsOptions);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [assetCode, setAssetCode] = useState(defaultAssetCode);
  const [memo, setMemo] = useState("");
  const [selectedTier, setSelectedTier] = useState<FeeTierOption>("recommended");
  const [selectedFeeStroops, setSelectedFeeStroops] = useState<number | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const resolvedFeeStroops =
    selectedFeeStroops ?? stats.recommended.stroops;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedDest = destination.trim();
    if (!isValidStellarAddress(trimmedDest)) {
      setError("Please enter a valid 56-character Stellar address starting with G.");
      return;
    }

    const numericAmount = parseFloat(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      setError("Please enter a valid payment amount greater than 0.");
      return;
    }

    await onSubmit({
      destination: trimmedDest,
      amount: amount.trim(),
      assetCode,
      memo: memo.trim() || undefined,
      feeStroops: resolvedFeeStroops,
      feeTier: selectedTier,
    });
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-4"
      data-testid="payment-submission-form"
    >
      <div>
        <label
          htmlFor="payment-destination"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Destination Address
        </label>
        <input
          id="payment-destination"
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="G..."
          data-testid="payment-form-destination"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label
            htmlFor="payment-amount"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Amount
          </label>
          <input
            id="payment-amount"
            type="number"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="payment-form-amount"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="payment-asset"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Asset
          </label>
          <select
            id="payment-asset"
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value)}
            data-testid="payment-form-asset"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="payment-memo"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Memo (optional)
        </label>
        <input
          id="payment-memo"
          type="text"
          maxLength={28}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Optional memo"
          data-testid="payment-form-memo"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        />
      </div>

      <FeeSelector
        stats={stats}
        selectedTier={selectedTier}
        selectedFeeStroops={resolvedFeeStroops}
        onFeeChange={(feeStroops, tier) => {
          setSelectedFeeStroops(feeStroops);
          setSelectedTier(tier);
        }}
      />

      {error && (
        <p
          role="alert"
          data-testid="payment-form-error"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        data-testid="payment-form-submit"
        className="w-full py-2.5 px-4 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700"
      >
        Submit Payment ({resolvedFeeStroops} stroops fee)
      </button>
    </form>
  );
}
