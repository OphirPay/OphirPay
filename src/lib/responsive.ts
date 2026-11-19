// SPDX-License-Identifier: MIT

/**
 * Responsive design constants matching Tailwind breakpoints.
 */

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

/** Common responsive media query strings for useMediaQuery hook. */
export const MEDIA = {
  isMobile: `(max-width: ${BREAKPOINTS.md - 1}px)`,
  isTablet: `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`,
  isDesktop: `(min-width: ${BREAKPOINTS.lg}px)`,
  prefersReducedMotion: "(prefers-reduced-motion: reduce)",
  prefersDarkMode: "(prefers-color-scheme: dark)",
  /**
   * Coarse pointer (touch) detection for gesture affordances. A hybrid
   * laptop with a touchscreen reports `fine` while its trackpad is in use, so
   * swipe handlers keyed on this stay dormant until the user actually touches
   * the screen.
   */
  hasTouch: "(hover: none) and (pointer: coarse)",
} as const;
