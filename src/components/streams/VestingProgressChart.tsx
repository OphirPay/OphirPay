"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo } from "react";
import { formatXlmStroops } from "@/lib/stellar-amount";

interface VestingProgressChartProps {
  streamId: number;
  totalAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  claimedAmount: bigint;
  cancelled: boolean;
  metadata?: string;
}

interface VestingMetrics {
  vested: bigint;
  claimable: bigint;
  progressPercent: number;
  isFullyVested: boolean;
  isStarted: boolean;
}

function computeVested(
  total: bigint,
  start: bigint,
  end: bigint,
  now: bigint,
): bigint {
  if (now <= start) return BigInt(0);
  if (now >= end) return total;
  return (total * (now - start)) / (end - start);
}

function progressPercent(vested: bigint, total: bigint): number {
  if (total <= BigInt(0)) return 0;
  return Number(vested * BigInt(10_000) / total) / 100;
}

export function VestingProgressChart({
  streamId,
  totalAmount,
  startTime,
  endTime,
  claimedAmount,
  cancelled,
}: VestingProgressChartProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [simulatedDate, setSimulatedDate] = useState<string>("");

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const startSec = Number(startTime);
  const endSec = Number(endTime);

  const metrics: VestingMetrics = useMemo(() => {
    if (cancelled) {
      return {
        vested: claimedAmount,
        claimable: BigInt(0),
        progressPercent: 100,
        isFullyVested: true,
        isStarted: true,
      };
    }
    const vested = computeVested(totalAmount, startTime, endTime, BigInt(now));
    const claimable = vested > claimedAmount ? vested - claimedAmount : BigInt(0);
    const pct = progressPercent(vested, totalAmount);
    return {
      vested,
      claimable,
      progressPercent: pct,
      isFullyVested: pct >= 100,
      isStarted: now > startSec,
    };
  }, [totalAmount, startTime, endTime, claimedAmount, cancelled, now]);

  const simulatedMetrics = useMemo(() => {
    if (!simulatedDate) return null;
    const simTimestamp = Math.floor(new Date(simulatedDate).getTime() / 1000);
    if (!Number.isSafeInteger(simTimestamp)) return null;

    const vested = computeVested(
      totalAmount,
      startTime,
      endTime,
      BigInt(simTimestamp),
    );
    const claimable = vested > claimedAmount ? vested - claimedAmount : BigInt(0);
    const pct = progressPercent(vested, totalAmount);

    return {
      timestamp: simTimestamp,
      vested,
      claimable,
      progressPercent: pct,
      isFuture: simTimestamp > now,
    };
  }, [simulatedDate, totalAmount, startTime, endTime, claimedAmount, now]);

  const chartWidth = 600;
  const chartHeight = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const totalDuration = endSec - startSec;
  const elapsed = Math.max(0, Math.min(now - startSec, totalDuration));
  const progressPos = totalDuration > 0 ? Math.min(elapsed / totalDuration, 1) : 1;

  const vestingLinePoints = useMemo(() => {
    const points: string[] = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalDuration;
      const vestedAtT =
        totalDuration > 0
          ? (totalAmount * BigInt(Math.floor(t))) / BigInt(totalDuration)
          : totalAmount;
      const x = padding.left + (i / steps) * innerWidth;
      const y =
        padding.top +
        innerHeight -
        Number((vestedAtT * BigInt(10_000)) / totalAmount) / 10_000 * innerHeight;
      points.push(x + "," + y);
    }
    return points.join(" ");
  }, [totalAmount, totalDuration, innerWidth, innerHeight]);

  const currentX = padding.left + progressPos * innerWidth;
  const currentVestedY =
    padding.top + innerHeight - (metrics.progressPercent / 100) * innerHeight;

  const formatDate = (sec: number) =>
    new Date(sec * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const minDate = new Date(startSec * 1000);
  minDate.setMinutes(minDate.getMinutes() - minDate.getTimezoneOffset());
  const minDateStr = minDate.toISOString().slice(0, 16);

  const maxDate = new Date(endSec * 1000);
  maxDate.setMinutes(maxDate.getMinutes() - maxDate.getTimezoneOffset());
  const maxDateStr = maxDate.toISOString().slice(0, 16);

  const nowDate = new Date(now * 1000);
  nowDate.setMinutes(nowDate.getMinutes() - nowDate.getTimezoneOffset());
  const nowDateStr = nowDate.toISOString().slice(0, 16);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatXlmStroops(totalAmount)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Vested</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatXlmStroops(metrics.vested)}
          </p>
        </div>
        <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3">
          <p className="text-xs text-green-600 dark:text-green-400">Claimable now</p>
          <p className="text-sm font-semibold text-green-700 dark:text-green-300">
            {formatXlmStroops(metrics.claimable)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Claimed</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatXlmStroops(claimedAmount)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <svg
          viewBox={"0 0 " + chartWidth + " " + chartHeight}
          className="w-full h-auto"
          role="img"
          aria-label={"Vesting progress chart for stream " + streamId}
        >
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = padding.top + innerHeight - (pct / 100) * innerHeight;
            return (
              <g key={pct}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + innerWidth}
                  y2={y}
                  stroke="currentColor"
                  className="text-gray-200 dark:text-gray-700"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="text-xs fill-gray-400"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          <polyline
            points={vestingLinePoints}
            fill="none"
            stroke="currentColor"
            className="text-ophir-500 dark:text-ophir-400"
            strokeWidth={2}
          />

          <polygon
            points={padding.left + "," + (padding.top + innerHeight) + " " + vestingLinePoints + " " + (padding.left + innerWidth) + "," + (padding.top + innerHeight)}
            fill="currentColor"
            className="text-ophir-500/10 dark:text-ophir-400/10"
          />

          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + innerHeight}
            stroke="currentColor"
            className="text-gray-300 dark:text-gray-600"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
          <text
            x={padding.left}
            y={chartHeight - 8}
            textAnchor="middle"
            className="text-xs fill-gray-400"
          >
            Start
          </text>

          <line
            x1={padding.left + innerWidth}
            y1={padding.top}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight}
            stroke="currentColor"
            className="text-gray-300 dark:text-gray-600"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
          <text
            x={padding.left + innerWidth}
            y={chartHeight - 8}
            textAnchor="middle"
            className="text-xs fill-gray-400"
          >
            End
          </text>

          {!cancelled && (
            <>
              <line
                x1={currentX}
                y1={padding.top}
                x2={currentX}
                y2={padding.top + innerHeight}
                stroke="currentColor"
                className="text-green-500 dark:text-green-400"
                strokeWidth={2}
              />
              <circle
                cx={currentX}
                cy={currentVestedY}
                r={5}
                fill="currentColor"
                className="text-green-500 dark:text-green-400"
              >
                <title>Current: {metrics.progressPercent.toFixed(1)}% vested</title>
              </circle>
            </>
          )}

          {cancelled && (
            <g>
              <line
                x1={currentX}
                y1={padding.top}
                x2={currentX}
                y2={padding.top + innerHeight}
                stroke="currentColor"
                className="text-red-500"
                strokeWidth={2}
              />
              <circle
                cx={currentX}
                cy={currentVestedY}
                r={5}
                fill="currentColor"
                className="text-red-500"
              >
                <title>Cancelled stream</title>
              </circle>
            </g>
          )}
        </svg>

        <div className="flex justify-between text-xs text-gray-400 mt-2 px-1">
          <span>{formatDate(startSec)}</span>
          <span className="font-medium text-green-600 dark:text-green-400">
            {cancelled ? "Cancelled" : "Now"}
          </span>
          <span>{formatDate(endSec)}</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">Progress</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {metrics.progressPercent.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={
              "h-full rounded-full transition-all duration-1000 ease-linear " +
              (cancelled
                ? "bg-red-500"
                : metrics.isFullyVested
                  ? "bg-green-500"
                  : "bg-ophir-500 dark:bg-ophir-400")
            }
            style={{ width: Math.min(metrics.progressPercent, 100) + "%" }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Simulate Future Date
        </h3>
        <div className="space-y-2">
          <input
            type="datetime-local"
            value={simulatedDate || nowDateStr}
            min={minDateStr}
            max={maxDateStr}
            onChange={(e) => setSimulatedDate(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            data-testid="simulated-date-input"
          />
          {simulatedMetrics && (
            <div
              className={
                "p-3 rounded-lg text-sm " +
                (simulatedMetrics.isFuture
                  ? "bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300"
                  : "bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300")
              }
            >
              <p className="font-medium">{formatDate(simulatedMetrics.timestamp)}</p>
              <p>
                Vested: {formatXlmStroops(simulatedMetrics.vested)} (
                {simulatedMetrics.progressPercent.toFixed(1)}%)
              </p>
              <p>Claimable: {formatXlmStroops(simulatedMetrics.claimable)}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {cancelled && (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-300">
            Cancelled
          </span>
        )}
        {metrics.isFullyVested && !cancelled && (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-300">
            Fully Vested
          </span>
        )}
        {metrics.isStarted && !metrics.isFullyVested && !cancelled && (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-ophir-100 text-ophir-800 dark:bg-ophir-950/30 dark:text-ophir-300">
            Active
          </span>
        )}
        {!metrics.isStarted && (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Not Started
          </span>
        )}
      </div>
    </div>
  );
}
