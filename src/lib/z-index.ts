// SPDX-License-Identifier: MIT

/**
 * Z-index management constants for consistent layering.
 * Prevents z-index wars by defining all layers in one place.
 */

export const Z_INDEX = {
  /** Base content layer */
  CONTENT: 0,
  /** Dropdowns, popovers, tooltips */
  DROPDOWN: 10,
  /** Sticky headers */
  STICKY: 20,
  /** Sidebar and navigation overlays on mobile */
  SIDEBAR: 30,
  /** Mobile hamburger menu button */
  MOBILE_MENU: 40,
  /** Modal backdrops */
  MODAL_BACKDROP: 50,
  /** Modal dialogs */
  MODAL: 51,
  /** Toast notifications */
  TOAST: 60,
  /** Skip-to-content link */
  SKIP_LINK: 100,
} as const;
