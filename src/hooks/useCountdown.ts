"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback } from "react";

export interface CountdownOptions {
  onExpire?: () => void;
  intervalMs?: number;
  direction?: "down" | "up";
}

/**
 * Countdown timer hook — counts down from initial seconds to 0 or counts up.
 * Supports configurable tick intervals for smooth sub-second updates.
 * Returns `remaining`, a formatted MM:SS string, running/expired flags,
 * and `start` / `reset` controls.
 *
 * @example
 * ```tsx
 * function PaymentRequestTimer({ validForSeconds }: { validForSeconds: number }) {
 *   const { formatted, isRunning, isExpired, start, reset } =
 *     useCountdown(validForSeconds, () => toast.success("Request expired"));
 *
 *   useEffect(() => start(), [start]);
 *
 *   return <div>{formatted}</div>;
 * }
 * ```
 */
export function useCountdown(
  initialSeconds: number,
  onExpireOrOptions?: (() => void) | CountdownOptions
) {
  const options: CountdownOptions =
    typeof onExpireOrOptions === "function"
      ? { onExpire: onExpireOrOptions }
      : onExpireOrOptions ?? {};

  const { onExpire, intervalMs = 1000, direction = "down" } = options;

  const [remaining, setRemaining] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    if (direction === "down" && remaining <= 0) return;

    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (direction === "down") {
          if (prev <= 1) {
            setIsRunning(false);
            onExpire?.();
            return 0;
          }
          return prev - 1;
        } else {
          return prev + 1;
        }
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isRunning, remaining, onExpire, intervalMs, direction]);

  const start = useCallback(() => setIsRunning(true), []);
  const reset = useCallback(
    (seconds?: number) => {
      setIsRunning(false);
      setRemaining(seconds ?? initialSeconds);
    },
    [initialSeconds]
  );

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return {
    remaining,
    minutes,
    seconds,
    formatted: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    isRunning,
    isExpired: remaining === 0,
    start,
    reset,
  };
}

/**
 * Calculate vested stroops based on Soroban payment stream contract formula.
 * Linear unlock: total * (now - start) / (end - start).
 * Respects cliff period where 0 is unlocked before cliff timestamp.
 */
export function calculateVestedStroops(
  total: bigint,
  start: bigint,
  end: bigint,
  now: bigint,
  cliff: bigint = BigInt(0)
): bigint {
  if (now < start || (cliff > start && now < cliff)) return BigInt(0);
  if (now >= end || end <= start) return total;
  return (total * (now - start)) / (end - start);
}

/**
 * Real-time vesting ticker for payment streams.
 * Ticks every second (or configured interval) to calculate live unlocked stroops and claimable balance.
 */
export function useVestingTicker({
  start,
  end,
  total,
  claimed = BigInt(0),
  cliff = BigInt(0),
  intervalMs = 1000,
}: {
  start: bigint;
  end: bigint;
  total: bigint;
  claimed?: bigint;
  cliff?: bigint;
  intervalMs?: number;
}) {
  const [currentTime, setCurrentTime] = useState<bigint>(() =>
    BigInt(Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(BigInt(Math.floor(Date.now() / 1000)));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const vested = calculateVestedStroops(total, start, end, currentTime, cliff);
  const claimable = vested > claimed ? vested - claimed : BigInt(0);
  const percent =
    total > BigInt(0) ? Number((vested * BigInt(10_000)) / total) / 100 : 0;

  return {
    currentTime,
    vested,
    claimable,
    percent,
    isComplete: currentTime >= end,
    hasStarted: currentTime >= start,
  };
}
