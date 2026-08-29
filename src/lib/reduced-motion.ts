"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Check if prefers-reduced-motion is currently enabled.
 * Safe to call on client or SSR (returns false on server / environments without matchMedia).
 */
export function isReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Return 0 or safe fallback duration when reduced motion is preferred,
 * otherwise return the full animation/transition duration.
 */
export function getMotionSafeDuration(duration: number, prefersReduced?: boolean): number {
  const isReduced = prefersReduced !== undefined ? prefersReduced : isReducedMotion();
  return isReduced ? 0 : duration;
}

/**
 * Hook to detect whether the user has requested reduced motion in their OS/browser settings.
 * Updates reactively if the media query preference changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
    setPrefersReducedMotion(mediaQueryList.matches);

    const listener = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(event.matches);
    };

    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener("change", listener);
      return () => {
        mediaQueryList.removeEventListener("change", listener);
      };
    } else if (mediaQueryList.addListener) {
      // Legacy API support
      mediaQueryList.addListener(listener);
      return () => {
        mediaQueryList.removeListener(listener);
      };
    }
  }, []);

  return prefersReducedMotion;
}
