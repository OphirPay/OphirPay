"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback } from "react";

/**
 * Type-safe localStorage hook with SSR safety (returns initial value on server).
 * Returns [value, setValue, removeValue] where setValue accepts either a value
 * or an updater function, and changes are persisted automatically.
 *
 * @example
 * Persist the user's preferred asset filter across reloads:
 *
 * ```tsx
 * function AssetFilter() {
 *   const [assetCode, setAssetCode, removeAssetCode] =
 *     useLocalStorage<string>("ophirpay:asset-filter", "XLM");
 *
 *   return (
 *     <select value={assetCode} onChange={(e) => setAssetCode(e.target.value)}>
 *       <option value="XLM">XLM</option>
 *       <option value="USDC">USDC</option>
 *     </select>
 *   );
 * }
 * ```
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const next = value instanceof Function ? value(prev) : value;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(key, JSON.stringify(next));
        }
        return next;
      });
    },
    [key]
  );

  const removeValue = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(key);
    }
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue] as const;
}
