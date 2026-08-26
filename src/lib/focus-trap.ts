// SPDX-License-Identifier: MIT

/**
 * Focus trap utility for modals, dialogs, and drawers.
 * Ensures keyboard focus stays within a container when active.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Create a focus trap within a container element.
 * Returns a cleanup function.
 */
export function trapFocus(container: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;

  // Focus the first focusable element, or the container itself
  const first = container.querySelector<HTMLElement>(FOCUSABLE);
  if (first) {
    first.focus();
  } else {
    container.setAttribute("tabindex", "-1");
    container.focus();
  }

  const handler = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;

    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  container.addEventListener("keydown", handler);

  return () => {
    container.removeEventListener("keydown", handler);
    previous?.focus();
  };
}
