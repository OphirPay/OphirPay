"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";

/**
 * Reactively tracks a CSS media query.
 * Returns true when the media query matches.
 *
 * @example
 * Conditionally render a compact mobile CTA bar alongside the desktop one:
 *
 * ```tsx
 * function SendActions() {
 *   const isMobile = useMediaQuery("(max-width: 768px)");
 *
 *   if (isMobile) return <MobileSendBar />;
 *   return <DesktopSendButton />;
 * }
 * ```
 *
 * Usage: const isMobile = useMediaQuery("(max-width: 768px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // SSR/`jsdom` environments may not implement `matchMedia` at all. Treat
    // "no media query engine" as "no match" rather than throwing: a component
    // that merely *prefers* a mobile layout must still render on the server.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
