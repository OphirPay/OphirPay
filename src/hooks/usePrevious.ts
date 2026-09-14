"use client";
// SPDX-License-Identifier: MIT


import { useRef, useEffect } from "react";

/**
 * Track the previous value of a variable.
 * Useful for detecting changes and diffing.
 *
 * @example
 * React to a wallet balance change by showing a badge:
 *
 * ```tsx
 * function BalanceBadge({ balance }: { balance: string }) {
 *   const prevBalance = usePrevious(balance);
 *   const increased = prevBalance && parseFloat(balance) > parseFloat(prevBalance);
 *   return <span>{increased ? "▲ balance up" : "○ steady"}</span>;
 * }
 * ```
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
