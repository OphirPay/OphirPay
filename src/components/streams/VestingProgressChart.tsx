"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useStreamVestingClock } from "@/hooks/useCountdown";

export interface VestingStreamConfig {
  id: string;
  totalAmount: number;
  claimedAmount: number;
  assetCode?: string;
  /** Unix timestamp in seconds when streaming begins. */
  startTime: number;
  /** Optional cliff timestamp in seconds (defaults to startTime). */
  cliffTime?: number;
  /** Unix timestamp in seconds when 100% of totalAmount is vested. */
  endTime: number;
}

export interface VestingCalculationResult {
  vestedAmount: number;
  claimableAmount: number;
  lockedAmount: number;
  vestedPercent: number;
  beforeCliff: boolean;
  fullyVested: boolean;
}

/**
 * Calculate exact vested, claimable, and locked balances at any arbitrary
 * Unix timestamp (in seconds), respecting the stream's start, cliff, and end times.
 */
export function calculateVestingAtTimestamp(
  stream: VestingStreamConfig,
  timestampSec: number
): VestingCalculationResult {
  const { totalAmount, claimedAmount, startTime, endTime } = stream;
  const cliffTime = stream.cliffTime ?? startTime;
  const duration = Math.max(1, endTime - startTime);

  if (timestampSec <= startTime || timestampSec < cliffTime) {
    return {
      vestedAmount: 0,
      claimableAmount: 0,
      lockedAmount: totalAmount,
      vestedPercent: 0,
      beforeCliff: timestampSec < cliffTime,
      fullyVested: false,
    };
  }

  if (timestampSec >= endTime) {
    const claimable = Math.max(0, Number((totalAmount - claimedAmount).toFixed(7)));
    return {
      vestedAmount: totalAmount,
      claimableAmount: claimable,
      lockedAmount: 0,
      vestedPercent: 100,
      beforeCliff: false,
      fullyVested: true,
    };
  }

  const elapsed = timestampSec - startTime;
  const ratio = Math.min(1, Math.max(0, elapsed / duration));
  const vestedAmount = Number((totalAmount * ratio).toFixed(7));
  const claimableAmount = Math.max(
    0,
    Number((vestedAmount - claimedAmount).toFixed(7))
  );
  const lockedAmount = Math.max(
    0,
    Number((totalAmount - vestedAmount).toFixed(7))
  );

  return {
    vestedAmount,
    claimableAmount,
    lockedAmount,
    vestedPercent: Number((ratio * 100).toFixed(2)),
    beforeCliff: false,
    fullyVested: false,
  };
}

export interface VestingProgressChartProps {
  stream: VestingStreamConfig;
  initialNowSec?: number;
}

export function VestingProgressChart({
  stream,
  initialNowSec = Math.floor(Date.now() / 1000),
}: VestingProgressChartProps) {
  const asset = stream.assetCode ?? "XLM";
  const cliffTime = stream.cliffTime ?? stream.startTime;
  const { nowSec, formattedRemaining } = useStreamVestingClock(
    stream.endTime,
    initialNowSec
  );

  const [simulatedSec, setSimulatedSec] = useState<number>(
    Math.min(
      stream.endTime,
      Math.max(stream.startTime, initialNowSec)
    )
  );

  const liveStats = calculateVestingAtTimestamp(stream, nowSec);
  const simulatedStats = calculateVestingAtTimestamp(stream, simulatedSec);

  const duration = Math.max(1, stream.endTime - stream.startTime);
  const cliffPct = Math.min(
    100,
    Math.max(0, ((cliffTime - stream.startTime) / duration) * 100)
  );
  const currentPct = liveStats.vestedPercent;
  const simulatedPct = simulatedStats.vestedPercent;

  return (
    <div
      className="space-y-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      data-testid="vesting-progress-chart"
    >
      {/* Header & Live Claimable Counter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Vesting Timeline & Claim Simulator
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Stream #{stream.id} · Countdown: {formattedRemaining}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <span className="text-xs text-gray-500 dark:text-gray-400 block">
            Real-Time Claimable Balance
          </span>
          <span
            data-testid="live-claimable-balance"
            className="text-lg font-mono font-bold text-green-600 dark:text-green-400"
          >
            {liveStats.claimableAmount.toFixed(2)} {asset}
          </span>
        </div>
      </div>

      {/* SVG Vesting Curve & Milestone Markers */}
      <div className="space-y-2">
        <svg
          viewBox="0 0 400 100"
          className="w-full h-28 overflow-visible"
          role="img"
          aria-label="Vesting progress timeline"
          data-testid="vesting-progress-svg"
        >
          {/* Background track */}
          <line
            x1="20"
            y1="60"
            x2="380"
            y2="60"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            className="text-gray-200 dark:text-gray-800"
          />
          {/* Vested progress bar */}
          <line
            x1="20"
            y1="60"
            x2={20 + (360 * currentPct) / 100}
            y2="60"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            className="text-ophir-600 dark:text-ophir-400"
          />
          {/* Start marker */}
          <g data-testid="marker-start" transform="translate(20, 60)">
            <circle r="6" className="fill-gray-600 dark:fill-gray-300" />
            <text y="24" textAnchor="middle" className="text-[10px] fill-current">
              Start
            </text>
          </g>
          {/* Cliff marker */}
          <g
            data-testid="marker-cliff"
            transform={`translate(${20 + (360 * cliffPct) / 100}, 60)`}
          >
            <circle r="6" className="fill-amber-500" />
            <text y="-14" textAnchor="middle" className="text-[10px] fill-current">
              Cliff ({Math.round(cliffPct)}%)
            </text>
          </g>
          {/* Current progress marker */}
          <g
            data-testid="marker-current"
            transform={`translate(${20 + (360 * currentPct) / 100}, 60)`}
          >
            <circle r="7" className="fill-green-500" />
            <text y="24" textAnchor="middle" className="text-[10px] fill-current">
              Now ({Math.round(currentPct)}%)
            </text>
          </g>
          {/* End marker */}
          <g data-testid="marker-end" transform="translate(380, 60)">
            <circle r="6" className="fill-blue-600" />
            <text y="24" textAnchor="middle" className="text-[10px] fill-current">
              End
            </text>
          </g>
        </svg>
      </div>

      {/* Simulate Future Date Slider */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-3">
        <div className="flex items-center justify-between">
          <label
            htmlFor="simulate-date-slider"
            className="text-xs font-semibold text-gray-700 dark:text-gray-300"
          >
            Simulate Future Date
          </label>
          <span
            data-testid="simulated-timestamp-label"
            className="text-xs font-mono text-gray-500 dark:text-gray-400"
          >
            {new Date(simulatedSec * 1000).toISOString().slice(0, 10)} (
            {simulatedPct.toFixed(1)}% vested)
          </span>
        </div>

        <input
          id="simulate-date-slider"
          type="range"
          min={stream.startTime}
          max={stream.endTime}
          step={1}
          value={simulatedSec}
          data-testid="simulate-date-slider"
          onChange={(e) => setSimulatedSec(Number(e.target.value))}
          className="w-full accent-ophir-600 cursor-pointer"
        />

        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">
              Simulated Vested
            </span>
            <span
              data-testid="simulated-vested-balance"
              className="text-sm font-mono font-semibold text-gray-900 dark:text-white"
            >
              {simulatedStats.vestedAmount.toFixed(2)} {asset}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-green-50/70 dark:bg-green-950/30">
            <span className="text-[11px] text-green-700 dark:text-green-400 block">
              Simulated Claimable
            </span>
            <span
              data-testid="simulated-claimable-balance"
              className="text-sm font-mono font-bold text-green-700 dark:text-green-400"
            >
              {simulatedStats.claimableAmount.toFixed(2)} {asset}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">
              Remaining Locked
            </span>
            <span
              data-testid="simulated-locked-balance"
              className="text-sm font-mono font-semibold text-gray-900 dark:text-white"
            >
              {simulatedStats.lockedAmount.toFixed(2)} {asset}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
