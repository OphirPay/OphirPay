"use client";
// SPDX-License-Identifier: MIT


import { useRef, useEffect } from "react";

/**
 * Track the previous value of a variable.
 * Useful for detecting changes and diffing.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
