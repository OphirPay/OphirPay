"use client";

// SPDX-License-Identifier: MIT
import React, { useState, useEffect } from "react";

export interface VestingProgressChartProps {
  totalAmount: number;
  startTime: number; // Unix timestamp in seconds
  endTime: number;   // Unix timestamp in seconds
  claimedAmount?: number;
  assetCode?: string;
  className?: string;
}

export function calculateVestedAmount(
  totalAmount: number,
  startTime: number,
  endTime: number,
  targetTime: number
): number {
  if (targetTime <= startTime) return 0;
  if (targetTime >= endTime) return totalAmount;
  const duration = endTime - startTime;
  if (duration <= 0) return totalAmount;
  const elapsed = targetTime - startTime;
  return (totalAmount * elapsed) / duration;
}

export function VestingProgressChart({
  totalAmount,
  startTime,
  endTime,
  claimedAmount = 0,
  assetCode = "XLM",
  className = "",
}: VestingProgressChartProps) {
  const [currentNow, setCurrentNow] = useState(() => Math.floor(Date.now() / 1000));
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedTime, setSimulatedTime] = useState(startTime);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeTime = isSimulating ? simulatedTime : currentNow;
  const vested = calculateVestedAmount(totalAmount, startTime, endTime, activeTime);
  const claimable = Math.max(0, vested - claimedAmount);
  const duration = Math.max(1, endTime - startTime);
  const progressPercent = Math.min(100, Math.max(0, ((activeTime - startTime) / duration) * 100));

  return (
    <div className={`w-full bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4 text-slate-100 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono uppercase text-sky-400 font-semibold tracking-wider">Payment Stream</span>
          <h3 className="text-lg font-bold text-white mt-0.5">
            {totalAmount.toLocaleString()} {assetCode}
          </h3>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">Claimable Now</span>
          <div className="text-base font-mono font-bold text-emerald-400">
            {claimable.toFixed(4)} {assetCode}
          </div>
        </div>
      </div>

      {/* SVG Progress Bar */}
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
          <span>{new Date(startTime * 1000).toLocaleDateString()}</span>
          <span>{progressPercent.toFixed(1)}% Vested</span>
          <span>{new Date(endTime * 1000).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Simulation Controls */}
      <div className="pt-2 border-t border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setIsSimulating(!isSimulating);
              if (!isSimulating) setSimulatedTime(currentNow);
            }}
            className="text-sky-400 hover:underline font-medium"
          >
            {isSimulating ? "← Exit Simulation (Live Mode)" : "Simulate Future Date"}
          </button>
          {isSimulating && (
            <span className="text-[11px] text-amber-400 font-mono">
              Simulated: {new Date(simulatedTime * 1000).toLocaleDateString()}
            </span>
          )}
        </div>

        {isSimulating && (
          <input
            type="range"
            min={startTime}
            max={endTime}
            value={simulatedTime}
            onChange={(e) => setSimulatedTime(Number(e.target.value))}
            className="w-full accent-sky-400 cursor-pointer"
          />
        )}
      </div>
    </div>
  );
}
