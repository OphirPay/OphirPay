"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { formatXlmStroops } from "@/lib/stellar-amount";
import {
  computeClaimable,
  computeVested,
  vestingPercent,
  type VestingState,
} from "@/lib/vesting";

interface VestingProgressChartProps {
  /** Total locked amount, in stroops. */
  totalAmount: bigint;
  /** Already claimed amount, in stroops. */
  claimedAmount: bigint;
  /** Vesting start, in Unix seconds. */
  startTime: number;
  /** Vesting end, in Unix seconds. */
  endTime: number;
  /** Cancelled streams no longer accrue and cannot be claimed. */
  cancelled?: boolean;
  /**
   * Optional cliff, in Unix seconds. The current `Stream` contract vests
   * linearly from `start_time` with no cliff, so the page does not pass this.
   * It exists for streams produced by a future cliff-enabled contract; the
   * chart only draws a cliff marker when a real value is supplied rather than
   * inventing one.
   */
  cliffTime?: number;
  /**
   * Live-counter refresh interval in ms. Defaults to 250 ms so the stroop
   * counter moves smoothly; pass `0` to freeze (tests).
   */
  tickMs?: number;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  className?: string;
}

const VIEW_WIDTH = 400;
const TRACK_X = 12;
const TRACK_WIDTH = VIEW_WIDTH - TRACK_X * 2;
const DEFAULT_TICK_MS = 250;

function xForPercent(percent: number): number {
  return TRACK_X + (TRACK_WIDTH * Math.min(100, Math.max(0, percent))) / 100;
}

function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Interactive vesting timeline for a payment stream (issue #1377).
 *
 * The contract vests linearly, so the authoritative numbers are cheap to
 * compute — but they change every ledger close and users previously had to
 * refresh the list page to see them. This component keeps its own clock,
 * recomputes from `@/lib/vesting` (bit-for-bit the contract formula), and lets
 * the user drag a future date to see what would be claimable then.
 */
export function VestingProgressChart({
  totalAmount,
  claimedAmount,
  startTime,
  endTime,
  cancelled = false,
  cliffTime,
  tickMs = DEFAULT_TICK_MS,
  now = Date.now,
  className,
}: VestingProgressChartProps) {
  const headingId = useId();
  const sliderId = useId();

  const [nowMs, setNowMs] = useState(() => now());
  const [simulatedTime, setSimulatedTime] = useState<number | null>(null);

  useEffect(() => {
    if (tickMs <= 0) return;
    const timer = window.setInterval(() => setNowMs(now()), tickMs);
    return () => window.clearInterval(timer);
  }, [now, tickMs]);

  const nowSeconds = Math.floor(nowMs / 1000);
  const start = Number(startTime);
  const end = Number(endTime);

  const current: VestingState = {
    total: totalAmount,
    claimed: claimedAmount,
    start: BigInt(Math.max(0, Math.floor(start))),
    end: BigInt(Math.max(0, Math.floor(end))),
    now: BigInt(Math.max(0, nowSeconds)),
    cancelled,
  };

  const vested = computeVested(
    current.total,
    current.start,
    current.end,
    current.now
  );
  const claimable = computeClaimable(current);
  const percent = vestingPercent(vested, current.total);

  const simMin = Math.max(nowSeconds, start);
  const simMax = end;
  const canSimulate = !cancelled && simMax > simMin;
  const simulationAt = canSimulate
    ? Math.min(simMax, Math.max(simMin, simulatedTime ?? simMin))
    : nowSeconds;

  const simulationClaimable = canSimulate
    ? computeClaimable({
        ...current,
        now: BigInt(Math.floor(simulationAt)),
        cancelled: false,
      })
    : null;

  const simulationVested = canSimulate
    ? computeVested(
        totalAmount,
        current.start,
        current.end,
        BigInt(Math.floor(simulationAt))
      )
    : BigInt(0);
  const simulationPercent = vestingPercent(simulationVested, totalAmount);

  const cliffPercent =
    cliffTime && cliffTime > start && cliffTime < end
      ? ((cliffTime - start) / (end - start)) * 100
      : null;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-900",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={headingId}
            className="text-sm font-semibold text-gray-900 dark:text-white"
          >
            Vesting timeline
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {cancelled
              ? "This stream was cancelled; vesting stopped."
              : "Linear vesting between the start and end dates."}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            percent >= 100
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-ophir-100 text-ophir-700 dark:bg-ophir-950/50 dark:text-ophir-300"
          )}
        >
          {percent.toFixed(2)}% vested
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} 96`}
        role="img"
        aria-label={`Stream vesting: ${percent.toFixed(2)} percent vested, ${formatXlmStroops(
          claimable
        )} claimable now of ${formatXlmStroops(totalAmount)}`}
        className="mt-4 h-auto w-full text-ophir-500"
      >
        {/* Track and progress */}
        <rect
          x={TRACK_X}
          y={34}
          width={TRACK_WIDTH}
          height={14}
          rx={7}
          className="fill-gray-200 dark:fill-gray-700"
        />
        <rect
          x={TRACK_X}
          y={34}
          width={(TRACK_WIDTH * percent) / 100}
          height={14}
          rx={7}
          fill="currentColor"
          style={{ transition: "width 300ms linear" }}
        />
        {simulatedTime !== null && canSimulate && (
          <rect
            x={TRACK_X}
            y={34}
            width={(TRACK_WIDTH * simulationPercent) / 100}
            height={14}
            rx={7}
            fill="currentColor"
            opacity={0.25}
          />
        )}

        {/* Cliff marker (only when the stream actually has one). */}
        {cliffPercent !== null && (
          <g>
            <line
              x1={xForPercent(cliffPercent)}
              y1={20}
              x2={xForPercent(cliffPercent)}
              y2={62}
              strokeDasharray="3 3"
              className="stroke-amber-500"
              strokeWidth={1.5}
            />
            <text
              x={xForPercent(cliffPercent)}
              y={14}
              textAnchor="middle"
              className="fill-amber-600 text-[9px] dark:fill-amber-400"
            >
              cliff
            </text>
          </g>
        )}

        {/* Start / current / simulated / end markers */}
        <circle cx={xForPercent(0)} cy={41} r={4} className="fill-gray-400" />
        <circle
          cx={xForPercent(percent)}
          cy={41}
          r={5}
          className="fill-white stroke-current"
          strokeWidth={2.5}
        />
        {simulatedTime !== null && canSimulate && (
          <circle
            cx={xForPercent(simulationPercent)}
            cy={41}
            r={6}
            fill="none"
            strokeDasharray="2 2"
            className="stroke-current"
            strokeWidth={1.5}
          />
        )}
        <circle cx={xForPercent(100)} cy={41} r={4} className="fill-gray-400" />

        {/* Labels */}
        <text
          x={xForPercent(0)}
          y={72}
          textAnchor="start"
          className="fill-gray-500 text-[10px] dark:fill-gray-400"
        >
          {shortDate(start)}
        </text>
        <text
          x={xForPercent(percent)}
          y={88}
          textAnchor="middle"
          className="fill-gray-700 text-[10px] font-medium dark:fill-gray-200"
        >
          now · {percent.toFixed(0)}%
        </text>
        <text
          x={xForPercent(100)}
          y={72}
          textAnchor="end"
          className="fill-gray-500 text-[10px] dark:fill-gray-400"
        >
          {shortDate(end)}
        </text>
      </svg>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Unlocked</dt>
          <dd className="font-mono font-medium text-gray-900 dark:text-white">
            {formatXlmStroops(vested)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Claimed</dt>
          <dd className="font-mono font-medium text-gray-900 dark:text-white">
            {formatXlmStroops(claimedAmount)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Claimable now</dt>
          <dd
            data-testid="live-claimable"
            className="font-mono font-semibold text-green-700 dark:text-green-400"
          >
            {formatXlmStroops(claimable)}
          </dd>
        </div>
      </dl>

      {canSimulate && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor={sliderId}
              className="text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              Simulate future date
            </label>
            {simulatedTime !== null && (
              <button
                type="button"
                onClick={() => setSimulatedTime(null)}
                className="text-xs text-ophir-600 hover:underline dark:text-ophir-400"
              >
                Reset to now
              </button>
            )}
          </div>
          <input
            id={sliderId}
            type="range"
            min={simMin}
            max={simMax}
            step={60}
            value={simulationAt}
            onChange={(event) => setSimulatedTime(Number(event.target.value))}
            aria-valuetext={new Date(simulationAt * 1000).toLocaleString()}
            className="mt-2 w-full accent-ophir-600"
          />
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            <span className="font-medium text-gray-900 dark:text-white">
              {new Date(simulationAt * 1000).toLocaleString()}
            </span>{" "}
            ·{" "}
            <span data-testid="simulated-claimable">
              {formatXlmStroops(
                simulationClaimable ?? BigInt(0)
              )}
            </span>{" "}
            claimable
            {simulationPercent > 0
              ? ` (${simulationPercent.toFixed(2)}% vested)`
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}
