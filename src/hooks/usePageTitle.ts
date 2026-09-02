"use client";
// SPDX-License-Identifier: MIT

import { useEffect } from "react";

/**
 * Title suffix mirroring the `"%s | OphirPay"` metadata template declared in
 * `src/app/layout.tsx`. Client components cannot export Next.js `metadata`
 * (route-specific server metadata lives in each route's `layout.tsx`), so
 * this hook keeps the browser tab (document.title) in sync with the template
 * during client-side navigation.
 */
const TITLE_SUFFIX = " | OphirPay";

/**
 * The root layout's default title (`title.default` in `src/app/layout.tsx`).
 * Restored when a route unmounts so error boundaries never display a stale
 * route title.
 */
const DEFAULT_TITLE = "OphirPay — Stellar Payment Orchestration";

/** Format a page title like the layout's `"%s | OphirPay"` template. */
function formatTitle(title: string): string {
  return title.includes("OphirPay") ? title : `${title}${TITLE_SUFFIX}`;
}

/**
 * Set the document title to `${title} | OphirPay` (matching the layout's
 * metadata template). Pass a key from `PAGE_TITLES` in `@/lib/page-titles`
 * or any short page-specific label, e.g. `usePageTitle(PAGE_TITLES.BATCHES)`.
 *
 * When the calling route unmounts — for example when an `error.tsx` or
 * `global-error.tsx` boundary takes over during client navigation — the
 * title is reset to the neutral default above, so the error screen never
 * retains the preceding route's title (or the failed route's own title).
 *
 * Passing `null`/`undefined` leaves the title untouched.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const next = formatTitle(title);
    if (document.title !== next) {
      document.title = next;
    }
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
