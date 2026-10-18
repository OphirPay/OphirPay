"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { useFeeStats, stroopsToXlm, type FeeTierDetails } from "@/hooks/useFeeStats";

export type FeeTier = "low" | "recommended" | "fast" | "custom";

export interface FeeSelectorProps {
  /** Selected fee in stroops. */
  selectedFee: number;
  /** Callback fired when selected fee changes. */
  onChange: (feeInStroops: number, tier: FeeTier) => void;
  /** Whether the fee selector is disabled. */
  disabled?: boolean;
  /** Optional container class name. */
  className?: string;
}

export function FeeSelector({
  selectedFee,
  onChange,
  disabled = false,
  className,
}: FeeSelectorProps) {
  const { feeStats, isLoading, refresh } = useFeeStats();
  const [selectedTier, setSelectedTier] = useState<FeeTier>("recommended");
  const [customFeeInput, setCustomFeeInput] = useState<string>("");
  const [customError, setCustomError] = useState<string | null>(null);

  // Initialize or update recommended fee by default
  useEffect(() => {
    if (selectedTier === "recommended" && feeStats.recommended.stroops) {
      if (selectedFee !== feeStats.recommended.stroops) {
        onChange(feeStats.recommended.stroops, "recommended");
      }
    }
  }, [feeStats.recommended.stroops, selectedTier, selectedFee, onChange]);

  const handleSelectTier = (tier: "low" | "recommended" | "fast") => {
    if (disabled) return;
    setSelectedTier(tier);
    setCustomError(null);
    const stroops = feeStats[tier].stroops;
    onChange(stroops, tier);
  };

  const handleSelectCustom = () => {
    if (disabled) return;
    setSelectedTier("custom");
    const current = customFeeInput ? parseInt(customFeeInput, 10) : selectedFee;
    validateAndApplyCustomFee(current);
  };

  const validateAndApplyCustomFee = (feeVal: number) => {
    if (isNaN(feeVal) || feeVal < feeStats.baseFee) {
      setCustomError(`Minimum network fee is ${feeStats.baseFee} stroops (${stroopsToXlm(feeStats.baseFee)} XLM).`);
      return false;
    }
    setCustomError(null);
    onChange(feeVal, "custom");
    return true;
  };

  const handleCustomInputChange = (val: string) => {
    setCustomFeeInput(val);
    const parsed = parseInt(val, 10);
    validateAndApplyCustomFee(parsed);
  };

  const tiers: Array<{
    key: "low" | "recommended" | "fast";
    data: FeeTierDetails;
  }> = [
    { key: "low", data: feeStats.low },
    { key: "recommended", data: feeStats.recommended },
    { key: "fast", data: feeStats.fast },
  ];

  const congestionColorMap = {
    low: "success",
    medium: "warning",
    high: "danger",
  } as const;

  return (
    <div className={cn("space-y-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-white">
            Network Transaction Fee
          </label>
          <Badge
            variant={congestionColorMap[feeStats.congestion]}
            className="text-[11px]"
          >
            {feeStats.congestion.toUpperCase()} CONGESTION
          </Badge>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={disabled || isLoading}
          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          title="Refresh real-time Horizon fee estimates"
        >
          {isLoading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {tiers.map(({ key, data }) => {
          const isSelected = selectedTier === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectTier(key)}
              data-testid={`fee-tier-${key}`}
              className={cn(
                "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                isSelected
                  ? "border-blue-600 bg-blue-50/70 shadow-sm dark:border-blue-500 dark:bg-blue-950/40"
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-800/80 dark:hover:border-gray-700",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {data.label}
                </span>
                {key === "recommended" && (
                  <Badge variant="info" className="text-[10px] px-1.5 py-0">
                    Recommended
                  </Badge>
                )}
              </div>
              <div className="mt-1 text-sm font-mono font-medium text-gray-800 dark:text-gray-200">
                {data.xlm} XLM
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {data.stroops} stroops
              </div>
              <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {data.estimatedWait}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        <button
          type="button"
          disabled={disabled}
          onClick={handleSelectCustom}
          data-testid="fee-tier-custom-btn"
          className={cn(
            "text-xs font-medium text-blue-600 hover:underline dark:text-blue-400",
            selectedTier === "custom" && "font-semibold underline"
          )}
        >
          {selectedTier === "custom" ? "Custom fee selected" : "+ Enter custom fee"}
        </button>

        {selectedTier === "custom" && (
          <div className="mt-2 space-y-1.5 animate-fade-in">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={feeStats.baseFee}
                step={10}
                value={customFeeInput}
                onChange={(e) => handleCustomInputChange(e.target.value)}
                placeholder={`Min ${feeStats.baseFee} stroops`}
                data-testid="custom-fee-input"
                disabled={disabled}
                className="w-48 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                stroops {customFeeInput ? `(${stroopsToXlm(parseInt(customFeeInput, 10) || 0)} XLM)` : ""}
              </span>
            </div>
            {customError && (
              <p role="alert" data-testid="custom-fee-error" className="text-xs text-red-600 dark:text-red-400 font-medium">
                {customError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FeeSelector;
