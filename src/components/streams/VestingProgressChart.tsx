"use client";
// SPDX-License-Identifier: MIT

import { useState, useId, useMemo } from "react";
import { formatXlmStroops } from "@/lib/stellar-amount";
import { useVestingTicker, calculateVestedStroops } from "@/hooks/useCountdown";
import { cn } from "@/lib/utils";

export interface VestingProgressChartProps {
  /** Stream identifier */
  streamId?: string | number;
  /** Total stream amount in stroops */
  totalAmount: bigint;
  /** Already claimed stroops */
  claimedAmount?: bigint;
  /** Start timestamp (in seconds) */
  startTime: bigint;
  /** End timestamp (in seconds) */
  endTime: bigint;
  /** Optional cliff timestamp (in seconds) */
  cliffTime?: bigint;
  /** Whether the stream was cancelled */
  cancelled?: boolean;
  className?: string;
}

export function VestingProgressChart({
  streamId,
  totalAmount,
  claimedAmount = BigInt(0),
  startTime,
  endTime,
  cliffTime = BigInt(0),
  cancelled = false,
  className,
}: VestingProgressChartProps) {
  const sliderId = useId();

  // Live real-time ticker
  const { currentTime } = useVestingTicker({
    start: startTime,
    end: endTime,
    total: totalAmount,
    claimed: claimedAmount,
    cliff: cliffTime,
    intervalMs: 1000,
  });

  // Future Date Simulation state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedTime, setSimulatedTime] = useState<bigint>(startTime);

  // Active time used for chart rendering
  const activeTime = isSimulating ? simulatedTime : currentTime;

  const totalDuration = endTime > startTime ? Number(endTime - startTime) : 1;
  const currentOffset = Number(activeTime - startTime);
  const activePercent = Math.min(100, Math.max(0, (currentOffset / totalDuration) * 100));

  const activeVested = cancelled
    ? claimedAmount
    : calculateVestedStroops(totalAmount, startTime, endTime, activeTime, cliffTime);
  const activeClaimable = activeVested > claimedAmount ? activeVested - claimedAmount : BigInt(0);

  const cliffPercent = useMemo(() => {
    if (cliffTime <= startTime || cliffTime >= endTime) return null;
    return ((Number(cliffTime - startTime) / totalDuration) * 100);
  }, [cliffTime, startTime, endTime, totalDuration]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const targetSeconds = startTime + BigInt(Math.floor((val / 100) * totalDuration));
    setSimulatedTime(targetSeconds);
    setIsSimulating(true);
  };

  const handleResetSimulation = () => {
    setIsSimulating(false);
  };

  const startDateStr = new Date(Number(startTime) * 1000).toLocaleDateString();
  const endDateStr = new Date(Number(endTime) * 1000).toLocaleDateString();
  const activeDateStr = new Date(Number(activeTime) * 1000).toLocaleString();

  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-5",
        className
      )}
      data-testid="vesting-progress-chart"
    >
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>Vesting Timeline & Claim Simulator</span>
            {streamId !== undefined && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-ophir-50 dark:bg-ophir-950/40 text-ophir-700 dark:text-ophir-300 border border-ophir-200 dark:border-ophir-800">
                #{streamId}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isSimulating ? "Simulating future maturity" : "Live real-time linear vesting"}
          </p>
        </div>

        {isSimulating && (
          <button
            type="button"
            onClick={handleResetSimulation}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 transition-colors"
          >
            <span>Reset to Live</span>
          </button>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mb-0.5">Total Allocation</span>
          <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
            {formatXlmStroops(totalAmount)}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mb-0.5">
            {isSimulating ? "Simulated Vested" : "Live Unlocked"}
          </span>
          <span
            className={cn(
              "text-sm font-bold font-mono transition-colors",
              isSimulating ? "text-amber-600 dark:text-amber-400" : "text-ophir-600 dark:text-ophir-400"
            )}
            data-testid="unlocked-counter"
          >
            {formatXlmStroops(activeVested)}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mb-0.5">Claimable Balance</span>
          <span
            className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono"
            data-testid="claimable-balance"
          >
            {formatXlmStroops(activeClaimable)}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 block mb-0.5">Progress</span>
          <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
            {activePercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* SVG Interactive Timeline Chart */}
      <div className="relative pt-6 pb-2">
        <svg
          viewBox="0 0 600 120"
          className="w-full h-auto overflow-visible select-none"
          aria-label="Vesting Progress Graph"
        >
          <defs>
            <linearGradient id="vestingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="vestingLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>

          {/* Background Grid & Base Axis */}
          <line x1="30" y1="90" x2="570" y2="90" stroke="currentColor" strokeWidth="2" className="text-gray-200 dark:text-gray-800" />
          <line x1="30" y1="30" x2="570" y2="30" stroke="currentColor" strokeDasharray="3 3" strokeWidth="1" className="text-gray-200 dark:text-gray-800" />

          {/* Linear Slope Area */}
          <polygon
            points={`30,90 30,90 570,30 570,90`}
            fill="url(#vestingFill)"
          />
          {/* Main Slope Line */}
          <line x1="30" y1="90" x2="570" y2="30" stroke="url(#vestingLine)" strokeWidth="3" strokeLinecap="round" />

          {/* Cliff Marker (if present) */}
          {cliffPercent !== null && (
            <g transform={`translate(${30 + (cliffPercent / 100) * 540}, 0)`}>
              <line y1="20" y2="90" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" />
              <circle cy="90" r="4" fill="#f59e0b" />
              <text y="15" textAnchor="middle" className="text-[9px] fill-amber-500 font-semibold">Cliff</text>
            </g>
          )}

          {/* Active Progress Vertical Indicator & Bubble */}
          {(() => {
            const currentX = 30 + (activePercent / 100) * 540;
            const currentY = 90 - (activePercent / 100) * 60;
            const color = isSimulating ? "#f59e0b" : "#0284c7";
            return (
              <g transform={`translate(${currentX}, 0)`}>
                <line y1={currentY} y2="90" stroke={color} strokeWidth="2" />
                <circle cy={currentY} r="6" fill={color} stroke="#ffffff" strokeWidth="2" />
                <rect x="-30" y={currentY - 22} width="60" height="18" rx="4" fill={color} />
                <text x="0" y={currentY - 10} textAnchor="middle" fill="#ffffff" className="text-[10px] font-mono font-bold">
                  {activePercent.toFixed(0)}%
                </text>
              </g>
            );
          })()}

          {/* Start Point Marker */}
          <circle cx="30" cy="90" r="4" className="fill-gray-400 dark:fill-gray-600" />
          <text x="30" y="105" textAnchor="middle" className="text-[10px] fill-gray-400 font-mono">
            {startDateStr}
          </text>

          {/* End Point Marker */}
          <circle cx="570" cy="30" r="4" className="fill-emerald-500" />
          <text x="570" y="105" textAnchor="middle" className="text-[10px] fill-gray-400 font-mono">
            {endDateStr}
          </text>
        </svg>
      </div>

      {/* Simulator Slider Controls */}
      <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
        <div className="flex justify-between items-center text-xs">
          <label htmlFor={sliderId} className="font-medium text-gray-700 dark:text-gray-300">
            Simulate Future Date: <span className="font-mono text-ophir-600 dark:text-ophir-400 ml-1">{activeDateStr}</span>
          </label>
          <span className="text-gray-400 dark:text-gray-500 font-mono">
            {activePercent.toFixed(1)}% of duration
          </span>
        </div>

        <input
          id={sliderId}
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={activePercent}
          onChange={handleSliderChange}
          aria-label="Vesting Simulation Date Slider"
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-ophir-600"
        />

        <div className="flex justify-between text-[11px] text-gray-400 dark:text-gray-500">
          <span>Start ({startDateStr})</span>
          <span>End Maturity ({endDateStr})</span>
        </div>
      </div>
    </div>
  );
}
