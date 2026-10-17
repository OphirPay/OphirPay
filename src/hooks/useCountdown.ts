"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback } from "react";

/**
 * Countdown timer hook — counts down from initial seconds to 0.
 * Useful for payment request expiration, session timeouts, etc.
 * Returns `remaining`, a formatted MM:SS string, running/expired flags,
 * and `start` / `reset` controls.
 */
export function useCountdown(initialSeconds: number, onExpire?: () => void) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning || remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          onExpire?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, remaining, onExpire]);

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
 * Real-time clock hook for streaming payment vesting progression (Issue #1377).
 */
export function useStreamVestingClock(
  endTimestampSec: number,
  initialNowSec: number = Math.floor(Date.now() / 1000)
) {
  const [nowSec, setNowSec] = useState<number>(initialNowSec);
  const remainingSec = Math.max(0, endTimestampSec - nowSec);
  const countdown = useCountdown(remainingSec);

  useEffect(() => {
    countdown.start();
  }, [countdown]);

  useEffect(() => {
    const id = setInterval(() => {
      setNowSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return {
    nowSec,
    remainingSec,
    formattedRemaining: countdown.formatted,
    isCompleted: remainingSec <= 0,
  };
}
