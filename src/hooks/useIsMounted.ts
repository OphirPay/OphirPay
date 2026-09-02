"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect, useRef } from "react";

/**
 * Returns true after the component has mounted on the client.
 * Useful for SSR guards to prevent hydration mismatches.
 *
 * @example
 * Guard client-only UI (e.g. a rendered QrCode) from server HTML:
 *
 * ```tsx
 * function ReceiptQr({ url }: { url: string }) {
 *   const mounted = useIsMounted();
 *   if (!mounted) return null;
 *   return <QrCode value={url} />;
 * }
 * ```
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

/**
 * Returns a ref whose current value is true if the component is still mounted.
 * Useful for async operations that should not update state after unmount.
 */
export function useMountedRef(): React.RefObject<boolean> {
  const ref = useRef(true);

  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);

  return ref;
}
