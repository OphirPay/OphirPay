"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  type StreamRecord,
  computeVested,
  computeClaimable,
  computeUnvested,
  computeRemaining,
  computeVestingProgress,
  getStreamStatus,
  formatStroopAmount,
  stroopsToDecimal,
} from "@/lib/streams";
import { cn } from "@/lib/utils";

interface VestingCurveProps {
  stream: StreamRecord;
  className?: string;
  onTick?: (data: { vested: bigint; claimable: bigint; progress: number }) => void;
}

export function VestingCurve({ stream, className, onTick }: VestingCurveProps) {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    // 1-second interval to tick claimable figure live without drift
    const timer = setInterval(() => {
      const current = Math.floor(Date.now() / 1000);
      setNow(current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const vested = computeVested(stream.totalAmount, stream.startTime, stream.endTime, now);
  const claimable = computeClaimable(
    stream.totalAmount,
    stream.claimedAmount,
    stream.startTime,
    stream.endTime,
    now,
    stream.cancelled
  );
  const unvested = computeUnvested(stream.totalAmount, stream.startTime, stream.endTime, now);
  const remaining = computeRemaining(stream.totalAmount, stream.claimedAmount);
  const progress = computeVestingProgress(stream.startTime, stream.endTime, now);
  const status = getStreamStatus(stream, now);

  useEffect(() => {
    if (onTick) {
      onTick({ vested, claimable, progress });
    }
  }, [vested, claimable, progress, onTick]);

  const startDate = new Date(stream.startTime * 1000);
  const endDate = new Date(stream.endTime * 1000);

  // Time calculations
  const totalDuration = Math.max(1, stream.endTime - stream.startTime);
  const elapsed = Math.max(0, Math.min(totalDuration, now - stream.startTime));
  const remainingSeconds = Math.max(0, stream.endTime - now);

  const formatDuration = (secs: number) => {
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${s}s`;
    return `${minutes}m ${s}s`;
  };

  const variant =
    stream.cancelled
      ? "danger"
      : status === "COMPLETED"
      ? "success"
      : progress > 75
      ? "default"
      : "default";

  return (
    <div className={cn("p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5", className)}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Vesting Progress
          </span>
          <h4 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-baseline gap-2">
            <span>{progress.toFixed(1)}%</span>
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
              ({formatDuration(elapsed)} elapsed)
            </span>
          </h4>
        </div>

        <div className="text-right">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Live Claimable
          </span>
          <p className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {formatStroopAmount(claimable)} XLM
          </p>
        </div>
      </div>

      {/* Vesting Progress Bar */}
      <div className="space-y-1.5">
        <ProgressBar value={progress} max={100} variant={variant} className="h-3" />
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 pt-1">
          <span>Start: {startDate.toLocaleDateString()} {startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span>End: {endDate.toLocaleDateString()} {endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      {/* Financial Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-100 dark:border-gray-700/60">
        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Total Locked</div>
          <div className="text-sm font-semibold font-mono text-gray-900 dark:text-gray-100 mt-0.5">
            {formatStroopAmount(stream.totalAmount)} XLM
          </div>
        </div>

        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Earned (Vested)</div>
          <div className="text-sm font-semibold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">
            {formatStroopAmount(vested)} XLM
          </div>
        </div>

        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Claimed</div>
          <div className="text-sm font-semibold font-mono text-gray-700 dark:text-gray-300 mt-0.5">
            {formatStroopAmount(stream.claimedAmount)} XLM
          </div>
        </div>

        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {stream.cancelled ? "Unvested (Refunded)" : "Remaining Unvested"}
          </div>
          <div className="text-sm font-semibold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
            {formatStroopAmount(unvested)} XLM
          </div>
        </div>
      </div>

      {remainingSeconds > 0 && !stream.cancelled && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/30 px-3 py-2 rounded-md">
          <span>Time remaining to 100% completion:</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{formatDuration(remainingSeconds)}</span>
        </div>
      )}
    </div>
  );
}
