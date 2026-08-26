// SPDX-License-Identifier: MIT

/**
 * Animation constants and helper utilities for consistent motion design.
 */

/** Standard animation durations in milliseconds. */
export const DURATIONS = {
  fast: 150,
  normal: 250,
  slow: 400,
  extraSlow: 600,
} as const;

/** Standard CSS animation delay classes for staggered animations. */
export function getStaggerDelay(index: number, base = 50): string {
  return `${index * base}ms`;
}

/** Easing curves as CSS cubic-bezier values. */
export const EASING = {
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

/**
 * Wait for a CSS animation to complete before executing a callback.
 * Useful for exit animations before unmounting.
 */
export function waitForAnimation(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.addEventListener("animationend", () => resolve(), { once: true });
    element.addEventListener("transitionend", () => resolve(), { once: true });
    // Fallback timeout in case the event doesn't fire
    setTimeout(resolve, DURATIONS.extraSlow + 100);
  });
}
