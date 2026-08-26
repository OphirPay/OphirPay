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
