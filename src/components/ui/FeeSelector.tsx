"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { formatXlmAmount } from "@/lib/stellar-amount";
import type { FeeSnapshot, FeeTierKey } from "@/lib/fee-stats";

export type FeeTier = FeeTierKey | "custom";

export interface FeeSelection {
  tier: FeeTier;
  /**
   * Per-operation fee in stroops, or `null` when the custom value is invalid.
   * A `null` selection must block submission rather than silently falling back
   * to a stale fee.
   */
  fee: number | null;
}

interface FeeSelectorProps {
  /** Latest live snapshot; `null` while the first request is in flight. */
  snapshot: FeeSnapshot | null;
  selection: FeeSelection;
  onChange: (selection: FeeSelection) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Number of operations in the transaction (display only). */
  operations?: number;
}

/** Stellar fees are unsigned 32-bit values, in stroops. */
const MAX_FEE_STROOPS = 4_294_967_295;

const TIER_COPY: Record<FeeTierKey, { label: string; hint: string }> = {
  low: { label: "Low", hint: "Cheapest; may wait during congestion" },
  recommended: { label: "Recommended", hint: "Bids with most recent payments" },
  fast: { label: "Fast", hint: "Bids above almost every recent payment" },
};

function parseCustomFee(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_FEE_STROOPS) {
    return null;
  }
  return parsed;
}

/**
 * Network-fee selector for the payment form (issue #1373).
 *
 * Shows Horizon-derived Low / Recommended / Fast tiers in both stroops and XLM,
 * plus a validated custom override. The selector is presentation only: the
 * parent owns `selection` so the value it submits is the value shown here.
 */
export function FeeSelector({
  snapshot,
  selection,
  onChange,
  loading = false,
  disabled = false,
  operations = 1,
}: FeeSelectorProps) {
  const groupName = useId();
  const [customValue, setCustomValue] = useState("");

  // Seed the input when the user switches into custom mode, so the field
  // starts from a plausible value instead of an empty box.
  useEffect(() => {
    if (selection.tier !== "custom" || customValue !== "") return;
    const base = snapshot?.tiers.baseFee;
    if (base) setCustomValue(String(base));
  }, [selection.tier, snapshot, customValue]);

  const baseFee = snapshot?.tiers.baseFee ?? null;
  const customFee = parseCustomFee(customValue);
  const customError =
    selection.tier !== "custom"
      ? null
      : customFee === null
        ? "Enter a whole number of stroops."
        : baseFee !== null && customFee < baseFee
          ? `Fee must be at least the network base fee (${baseFee} stroops).`
          : null;

  const selectTier = (tier: FeeTier) => {
    if (disabled) return;
    if (tier === "custom") {
      // Seed the field from the base fee the first time custom is chosen so
      // the user starts from a valid value rather than an empty, invalid one.
      const candidate =
        customFee ?? (baseFee !== null && baseFee > 0 ? baseFee : null);
      if (customFee === null && candidate !== null) {
        setCustomValue(String(candidate));
      }
      const tooLow = baseFee !== null && candidate !== null && candidate < baseFee;
      onChange({ tier, fee: candidate !== null && !tooLow ? candidate : null });
      return;
    }
    onChange({ tier, fee: snapshot?.tiers[tier] ?? null });
  };

  const changeCustom = (raw: string) => {
    setCustomValue(raw);
    const parsed = parseCustomFee(raw);
    const tooLow = baseFee !== null && parsed !== null && parsed < baseFee;
    onChange({
      tier: "custom",
      fee: parsed !== null && !tooLow ? parsed : null,
    });
  };

  if (!snapshot && loading) {
    return (
      <div
        role="status"
        aria-label="Loading network fee estimates"
        className="rounded-xl border border-gray-200 dark:border-gray-700 p-4"
      >
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <fieldset
      disabled={disabled}
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"
    >
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        Network fee
      </legend>

      <div
        role="radiogroup"
        aria-label="Network fee tier"
        className="mt-2 grid gap-2 sm:grid-cols-3"
      >
        {(Object.keys(TIER_COPY) as FeeTierKey[]).map((tier) => {
          const checked = selection.tier === tier;
          const fee = snapshot?.tiers[tier];
          return (
            <label
              key={tier}
              className={cn(
                "cursor-pointer rounded-lg border p-3 transition-colors",
                checked
                  ? "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/30"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60"
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={groupName}
                  value={tier}
                  checked={checked}
                  onChange={() => selectTier(tier)}
                  className="h-4 w-4 text-ophir-600 focus:ring-ophir-500"
                />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {TIER_COPY[tier].label}
                </span>
              </span>
              <span className="mt-1 block font-mono text-xs text-gray-700 dark:text-gray-300">
                {fee === undefined
                  ? "—"
                  : `${formatXlmAmount(fee)} XLM`}
              </span>
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                {fee === undefined ? "unavailable" : `${fee} stroops`}
                {snapshot ? ` · ${snapshot.tiers.percentiles[tier]}` : ""}
              </span>
              <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">
                {TIER_COPY[tier].hint}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="radio"
            name={groupName}
            value="custom"
            checked={selection.tier === "custom"}
            onChange={() => selectTier("custom")}
            className="h-4 w-4 text-ophir-600 focus:ring-ophir-500"
          />
          Custom fee (stroops)
        </label>
        {selection.tier === "custom" && (
          <div className="mt-2">
            <input
              type="number"
              inputMode="numeric"
              min={baseFee ?? 1}
              max={MAX_FEE_STROOPS}
              step={1}
              value={customValue}
              onChange={(event) => changeCustom(event.target.value)}
              aria-label="Custom fee in stroops"
              aria-invalid={customError !== null}
              aria-describedby={customError ? `${groupName}-error` : undefined}
              className={cn(
                "w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:bg-gray-900 dark:text-white",
                customError
                  ? "border-red-500"
                  : "border-gray-300 dark:border-gray-700"
              )}
            />
            {customError && (
              <p
                id={`${groupName}-error`}
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {customError}
              </p>
            )}
            {customFee !== null && !customError && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                = {formatXlmAmount(customFee)} XLM
                {operations > 1
                  ? ` per operation · ${formatXlmAmount(customFee * operations)} XLM total`
                  : " per operation"}
              </p>
            )}
          </div>
        )}
      </div>

      {snapshot && (
        <p
          className="mt-3 text-xs text-gray-500 dark:text-gray-400"
          data-testid="fee-selector-basis"
        >
          {snapshot.stale ? "⚠ " : ""}
          Based on {snapshot.basis}
          {snapshot.stale ? " (may be stale)" : ""}
        </p>
      )}
    </fieldset>
  );
}
