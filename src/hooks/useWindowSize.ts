"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";

interface WindowSize {
  width: number;
  height: number;
}

/**
 * Track browser window dimensions reactively.
 * Returns 0,0 during SSR and updates on client mount.
 *
 * @example
 * Show a notice when the send form becomes too narrow:
 *
 * ```tsx
 * function ResponsiveSendLayout() {
 *   const { width } = useWindowSize();
 *
 *   return (
 *     <div className={width < 480 ? "flex-col" : "flex-row"}>
 *       <SendForm />
 *       {width < 480 && <p className="text-xs">Compact mode</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>({ width: 0, height: 0 });

  useEffect(() => {
    const handler = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };

    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return size;
}
