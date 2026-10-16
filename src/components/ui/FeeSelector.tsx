"use client";

// SPDX-License-Identifier: MIT
import React, { useState } from "react";
import { useFeeStats, stroopsToXlm } from "@/hooks/useFeeStats";

export interface FeeSelectorProps {
  selectedFee: number;
  onChange: (feeInStroops: number) => void;
  minFee?: number;
}

export function FeeSelector({ selectedFee, onChange, minFee = 100 }: FeeSelectorProps) {
  const { tiers, loading } = useFeeStats();
  const [isCustom, setIsCustom] = useState(false);
  const [customValue, setCustomValue] = useState(String(selectedFee));
  const [customError, setCustomError] = useState<string | null>(null);

  const handleTierSelect = (stroops: number) => {
    setIsCustom(false);
    setCustomError(null);
    onChange(stroops);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomValue(val);
    const num = parseInt(val, 10);
    if (isNaN(num) || num < minFee) {
      setCustomError(`Minimum network fee is ${minFee} stroops`);
    } else {
      setCustomError(null);
      onChange(num);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <label className="font-medium text-slate-300">Transaction Network Fee</label>
        {loading && <span className="text-sky-400 animate-pulse text-[10px]">Updating...</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(["low", "normal", "fast"] as const).map((tierKey) => {
          const tier = tiers[tierKey];
          const active = !isCustom && selectedFee === tier.stroops;
          return (
            <button
              key={tierKey}
              type="button"
              onClick={() => handleTierSelect(tier.stroops)}
              className={`p-2.5 rounded-lg border text-left transition text-xs ${
                active
                  ? "border-sky-500 bg-sky-500/10 text-white"
                  : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
              }`}
            >
              <div className="font-semibold flex items-center justify-between">
                <span>{tier.label}</span>
                {tierKey === "normal" && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-300">Rec</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{tier.stroops} stroops</div>
              <div className="text-[10px] text-slate-500">{tier.xlm} XLM</div>
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setIsCustom(!isCustom)}
          className="text-xs text-sky-400 hover:underline"
        >
          {isCustom ? "← Choose recommended preset" : "Set custom fee"}
        </button>

        {isCustom && (
          <div className="mt-2 space-y-1">
            <div className="relative">
              <input
                type="number"
                min={minFee}
                value={customValue}
                onChange={handleCustomChange}
                placeholder="Stroops"
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
              />
              <span className="absolute right-3 top-2 text-[10px] text-slate-500">stroops</span>
            </div>
            {customError && <p className="text-[10px] text-rose-400">{customError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
