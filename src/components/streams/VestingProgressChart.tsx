"use client";
// SPDX-License-Identifier: MIT

import React, { useState, useMemo } from "react";
import { formatXlmStroops } from "@/lib/stellar-amount";
import { useLiveTimestamp } from "@/hooks/useCountdown";

export interface VestingProgressChartProps {
  totalAmount: bigint | number | string;
  claimedAmount?: bigint | number | string;
  startTime: number | bigint;
  endTime: number | bigint;
  cliffTime?: number | bigint;
  assetSymbol?: string;
  onClaim?: () => void;
  isClaiming?: boolean;
}

export function computeVestedAmount(
  total: bigint,
  start: bigint,
  end: bigint,
  now: bigint,
  cliff?: bigint
): bigint {
  if (end <= start) return total;
  if (now <= start) return BigInt(0);
  if (cliff && now < cliff) return BigInt(0);
  if (now >= end) return total;
  const duration = end - start;
  return (total * (now - start)) / duration;
}

export function VestingProgressChart({
  totalAmount,
  claimedAmount = BigInt(0),
  startTime,
  endTime,
  cliffTime,
  assetSymbol = "XLM",
  onClaim,
  isClaiming = false,
}: VestingProgressChartProps) {
  const currentTimestamp = useLiveTimestamp(1000);

  const total = useMemo(() => BigInt(totalAmount), [totalAmount]);
  const claimed = useMemo(() => BigInt(claimedAmount), [claimedAmount]);
  const startSec = useMemo(() => BigInt(startTime), [startTime]);
  const endSec = useMemo(() => BigInt(endTime), [endTime]);
  const cliffSec = useMemo(() => (cliffTime ? BigInt(cliffTime) : undefined), [cliffTime]);

  const durationSec = Number(endSec - startSec);

  // Slider for simulation
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedTimestamp, setSimulatedTimestamp] = useState<number>(() =>
    Math.min(Math.max(currentTimestamp, Number(startSec)), Number(endSec))
  );

  const activeTimestamp = BigInt(isSimulating ? simulatedTimestamp : currentTimestamp);

  // Calculations
  const vestedAmount = useMemo(
    () => computeVestedAmount(total, startSec, endSec, activeTimestamp, cliffSec),
    [total, startSec, endSec, activeTimestamp, cliffSec]
  );

  const claimableAmount = useMemo(() => {
    const unspent = vestedAmount - claimed;
    return unspent > BigInt(0) ? unspent : BigInt(0);
  }, [vestedAmount, claimed]);

  const percentUnlocked = useMemo(() => {
    if (total <= BigInt(0)) return 0;
    return Number((vestedAmount * BigInt(10_000)) / total) / 100;
  }, [vestedAmount, total]);

  // SVG Geometry
  const svgWidth = 800;
  const svgHeight = 220;
  const paddingX = 60;
  const paddingY = 40;
  const graphWidth = svgWidth - paddingX * 2;
  const graphHeight = svgHeight - paddingY * 2;

  const getXForTime = (time: bigint): number => {
    if (durationSec <= 0) return paddingX;
    const progress = Math.max(0, Math.min(1, Number(time - startSec) / durationSec));
    return paddingX + progress * graphWidth;
  };

  const currentX = getXForTime(activeTimestamp);
  const startX = paddingX;
  const endX = paddingX + graphWidth;
  const cliffX = cliffSec ? getXForTime(cliffSec) : null;

  // Linear ramp points
  const baseY = paddingY + graphHeight;
  const topY = paddingY;
  const currentY = baseY - (percentUnlocked / 100) * graphHeight;

  const pathD = `M ${startX} ${baseY} L ${endX} ${topY} L ${endX} ${baseY} Z`;
  const unlockedAreaD = `M ${startX} ${baseY} L ${currentX} ${currentY} L ${currentX} ${baseY} Z`;

  const startDateStr = new Date(Number(startSec) * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endDateStr = new Date(Number(endSec) * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="w-full bg-card border border-border rounded-xl p-4 sm:p-6 shadow-sm space-y-6">
      {/* Header Metric Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs uppercase font-medium tracking-wider text-muted-foreground">
            {isSimulating ? "Simulated Claimable" : "Live Claimable Balance"}
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground" data-testid="claimable-amount">
              {formatXlmStroops(claimableAmount)}
            </span>
            <span className="text-sm font-semibold text-primary">
              ({percentUnlocked.toFixed(2)}% Unlocked)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onClaim && (
            <button
              onClick={onClaim}
              disabled={isClaiming || claimableAmount <= BigInt(0)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {isClaiming ? "Claiming..." : `Claim ${assetSymbol}`}
            </button>
          )}
        </div>
      </div>

      {/* SVG Interactive Timeline */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto select-none overflow-visible"
        >
          <defs>
            <linearGradient id="streamGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="activeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.45" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={startX}
            y1={baseY}
            x2={endX}
            y2={baseY}
            stroke="hsl(var(--border))"
            strokeWidth="2"
          />
          <line
            x1={startX}
            y1={topY}
            x2={endX}
            y2={topY}
            stroke="hsl(var(--border))"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Total vesting trajectory envelope */}
          <path d={pathD} fill="url(#streamGradient)" />
          <line
            x1={startX}
            y1={baseY}
            x2={endX}
            y2={topY}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="2"
            strokeDasharray="4 4"
          />

          {/* Unlocked active area */}
          <path d={unlockedAreaD} fill="url(#activeGradient)" />
          <line
            x1={startX}
            y1={baseY}
            x2={currentX}
            y2={currentY}
            stroke="hsl(var(--primary))"
            strokeWidth="3"
          />

          {/* Vertical progress line */}
          <line
            x1={currentX}
            y1={baseY}
            x2={currentX}
            y2={currentY}
            stroke="hsl(var(--primary))"
            strokeWidth="2"
          />

          {/* Cliff Marker */}
          {cliffX && (
            <g>
              <line
                x1={cliffX}
                y1={baseY}
                x2={cliffX}
                y2={topY}
                stroke="#eab308"
                strokeWidth="2"
                strokeDasharray="3 3"
              />
              <text x={cliffX} y={topY - 10} fill="#eab308" fontSize="11" textAnchor="middle">
                Cliff
              </text>
            </g>
          )}

          {/* Start Marker */}
          <circle cx={startX} cy={baseY} r="5" fill="#22c55e" />
          <text x={startX} y={baseY + 20} fill="currentColor" fontSize="11" textAnchor="middle" className="text-muted-foreground">
            {startDateStr}
          </text>

          {/* End Marker */}
          <circle cx={endX} cy={topY} r="5" fill="#a855f7" />
          <text x={endX} y={baseY + 20} fill="currentColor" fontSize="11" textAnchor="middle" className="text-muted-foreground">
            {endDateStr}
          </text>

          {/* Current Progress Pointer */}
          <circle
            cx={currentX}
            cy={currentY}
            r="7"
            className="fill-primary stroke-background"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* Simulator Control Section */}
      <div className="bg-muted/40 border border-border rounded-lg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <span>Simulate Future Date</span>
            {isSimulating && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary font-semibold">
                Active Simulation
              </span>
            )}
          </label>
          <div className="flex items-center gap-2">
            {isSimulating && (
              <button
                onClick={() => {
                  setIsSimulating(false);
                  setSimulatedTimestamp(currentTimestamp);
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Reset to Live
              </button>
            )}
            <span className="text-xs font-mono text-muted-foreground">
              {new Date(simulatedTimestamp * 1000).toLocaleString()}
            </span>
          </div>
        </div>

        <input
          type="range"
          min={Number(startSec)}
          max={Number(endSec)}
          value={simulatedTimestamp}
          onChange={(e) => {
            setIsSimulating(true);
            setSimulatedTimestamp(Number(e.target.value));
          }}
          className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
        />

        <div className="flex flex-wrap gap-2 pt-1">
          {[
            { label: "+1 Day", delta: 86400 },
            { label: "+1 Week", delta: 604800 },
            { label: "+1 Month", delta: 2592000 },
            { label: "100% End", target: Number(endSec) },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setIsSimulating(true);
                const nextTime = preset.target ?? Math.min(Number(endSec), simulatedTimestamp + preset.delta!);
                setSimulatedTimestamp(nextTime);
              }}
              className="text-xs px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
