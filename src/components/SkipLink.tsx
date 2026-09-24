"use client";
// SPDX-License-Identifier: MIT

import { ARIA } from "@/lib/aria-labels";
import { Z_INDEX } from "@/lib/z-index";

/**
 * Accessible skip-to-content link.
 * Stays visually hidden until focused via keyboard Tab navigation,
 * then renders prominently above all content so users can jump directly
 * to the main landmark.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      data-testid="skip-to-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-ophir-600 focus:text-white focus:font-semibold focus:rounded-lg focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-ophir-600"
      style={{ zIndex: Z_INDEX.SKIP_LINK }}
    >
      {ARIA.SKIP_TO_CONTENT}
    </a>
  );
}
