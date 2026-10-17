"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import {
  MIN_NETWORK_FEE_STROOPS,
  stroopsToXlm,
  type FeeStatsSnapshot,
} from "@/hooks/useFeeStats";
import { cn } from "@/lib/utils";

export type FeeTierOption = "low" | "recommended" | "fast" | "custom";

export interface FeeSelectorProps {
  stats: FeeStatsSnapshot;
  selectedTier?: FeeTierOption;
  selectedFeeStroops?: number;
  onFeeChange: (feeStroops: number, tier: FeeTierOption) => void;
  disabled?: boolean;
}

export function validateCustomFeeStroops(
  rawInput: string,
  minStroops: number = MIN_NETWORK_FEE_STROOPS
): { valid: boolean; stroops?: number; error?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: "Please enter a custom fee in stroops." };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minStroops) {
    return {
      valid: false,
      error: `Custom fee must be an integer of at least ${minStroops} stroops (network minimum).`,
    };
  }
  return { valid: true, stroops: parsed };
}

export function FeeSelector({
  stats,
  selectedTier: controlledTier,
  selectedFeeStroops: _controlledFee,
  onFeeChange,
  disabled = false,
}: FeeSelectorProps) {
  const [internalTier, setInternalTier] = useState<FeeTierOption>(
    controlledTier ?? "recommended"
  );
  const [customInput, setCustomInput] = useState<string>(
    String(stats.recommended.stroops)
  );
  const [customError, setCustomError] = useState<string | null>(null);

  const activeTier = controlledTier ?? internalTier;

  const tiers: Array<{
    id: Exclude<FeeTierOption, "custom">;
    label: string;
    stroops: number;
    xlm: string;
  }> = [
    {
      id: "low",
      label: "Low",
      stroops: stats.low.stroops,
      xlm: stats.low.xlm,
    },
    {
      id: "recommended",
      label: "Recommended",
      stroops: stats.recommended.stroops,
      xlm: stats.recommended.xlm,
    },
    {
      id: "fast",
      label: "Fast",
      stroops: stats.fast.stroops,
      xlm: stats.fast.xlm,
    },
  ];

  const handleSelectTier = (
    tierId: Exclude<FeeTierOption, "custom">,
    stroops: number
  ) => {
    setInternalTier(tierId);
    setCustomError(null);
    onFeeChange(stroops, tierId);
  };

  const handleEnableCustom = () => {
    setInternalTier("custom");
    const validation = validateCustomFeeStroops(customInput, stats.baseFee);
    if (validation.valid && validation.stroops) {
      setCustomError(null);
      onFeeChange(validation.stroops, "custom");
    } else {
      setCustomError(validation.error ?? null);
    }
  };

  const handleCustomInputChange = (value: string) => {
    setCustomInput(value);
    const minReq = Math.max(MIN_NETWORK_FEE_STROOPS, stats.baseFee);
    const validation = validateCustomFeeStroops(value, minReq);
    if (!validation.valid) {
      setCustomError(validation.error ?? null);
    } else {
      setCustomError(null);
      onFeeChange(validation.stroops!, "custom");
    }
  };

  return (
    <div
      className="space-y-2.5 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 bg-gray-50/60 dark:bg-gray-800/40"
      data-testid="fee-selector-widget"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Network Transaction Fee
        </span>
        <span
          data-testid="fee-congestion-badge"
          className={cn(
            "px-2 py-0.5 rounded-full text-[11px] font-medium",
            stats.congestion === "low"
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : stats.congestion === "medium"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          )}
        >
          {stats.congestion} congestion
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Fee speed tiers">
        {tiers.map((tier) => {
          const isSelected = activeTier === tier.id;
          return (
            <button
              key={tier.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              data-testid={`fee-tier-${tier.id}`}
              onClick={() => handleSelectTier(tier.id, tier.stroops)}
              className={cn(
                "flex flex-col items-start p-2.5 rounded-lg border text-left transition-all disabled:opacity-50",
                isSelected
                  ? "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/40 text-ophir-900 dark:text-white ring-1 ring-ophir-500"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-ophir-400"
              )}
            >
              <span className="text-xs font-semibold">{tier.label}</span>
              <span className="text-[11px] font-mono mt-0.5">
                {tier.stroops} stroops
              </span>
              <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                {tier.xlm} XLM
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom fee override */}
      <div className="pt-1">
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={disabled}
            data-testid="fee-tier-custom-toggle"
            onClick={handleEnableCustom}
            className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline font-medium"
          >
            {activeTier === "custom" ? "Custom fee active" : "Set custom fee override"}
          </button>
          {activeTier === "custom" && !customError && (
            <span
              className="text-[11px] font-mono text-gray-500 dark:text-gray-400"
              data-testid="custom-fee-xlm-preview"
            >
              {stroopsToXlm(Number(customInput))} XLM
            </span>
          )}
        </div>

        {activeTier === "custom" && (
          <div className="mt-2">
            <input
              type="number"
              min={MIN_NETWORK_FEE_STROOPS}
              step={1}
              value={customInput}
              disabled={disabled}
              data-testid="custom-fee-input"
              aria-label="Custom fee in stroops"
              onChange={(e) => handleCustomInputChange(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono text-gray-900 dark:text-white"
              placeholder={`Min ${MIN_NETWORK_FEE_STROOPS} stroops`}
            />
            {customError && (
              <p
                role="alert"
                data-testid="custom-fee-error"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {customError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
