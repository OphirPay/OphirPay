// SPDX-License-Identifier: MIT

/**
 * Focus trap utility for modals, dialogs, and drawers.
 * Ensures keyboard focus stays within a container when active.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Create a focus trap within a container element.
 * Focus moves to the first focusable element (or the container itself),
 * Tab/Shift+Tab cycle within the container, and any attempt to focus an
 * element outside the container is redirected back inside.
 *
 * Returns a cleanup function that removes the listeners and restores focus
 * to the element that was focused before the trap was created.
 */
export function trapFocus(container: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;

  const getFocusables = () => container.querySelectorAll<HTMLElement>(FOCUSABLE);

  // Focus the first focusable element, or the container itself
  const first = getFocusables()[0];
  if (first) {
    first.focus();
  } else {
    container.setAttribute("tabindex", "-1");
    container.focus();
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    const focusables = getFocusables();
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

  // If focus lands outside the container (programmatic focus, or Tab when the
  // active element is not a boundary), pull it back inside. Preserve the tab
  // direction by wrapping from the edge the focus left from.
  const onFocusIn = (e: FocusEvent) => {
    if (container.contains(e.target as Node)) return;

    const focusables = getFocusables();
    if (focusables.length === 0) {
      container.focus();
      return;
    }

    const previousEl = e.relatedTarget as Node | null;
    if (previousEl === focusables[focusables.length - 1]) {
      focusables[0].focus();
    } else {
      focusables[focusables.length - 1].focus();
    }
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("focusin", onFocusIn);
    previous?.focus();
  };
}
