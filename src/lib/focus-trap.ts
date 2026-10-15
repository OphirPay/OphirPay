// SPDX-License-Identifier: MIT

/**
 * Focus trap utility for modals, dialogs, and drawers.
 * Ensures keyboard focus stays within a container when active.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Create a focus trap within a container element.
 * Focus moves to the initial focus element, first focusable element (or the container itself),
 * Tab/Shift+Tab cycle within the container, and any attempt to focus an
 * element outside the container is redirected back inside.
 *
 * Returns a cleanup function that removes the listeners and restores focus
 * to the element that was focused before the trap was created.
 */
export function trapFocus(
  container: HTMLElement,
  options?: {
    focusContainer?: boolean;
    initialFocus?: HTMLElement | null;
  }
): () => void {
  const previous = document.activeElement as HTMLElement | null;

  const getFocusables = () =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getAttribute("aria-hidden") !== "true"
    );

  // Focus the initial element, first focusable element, or the container itself.
  if (options?.initialFocus && container.contains(options.initialFocus)) {
    options.initialFocus.focus();
  } else {
    const focusables = getFocusables();
    const first = focusables[0];
    if (options?.focusContainer || !first) {
      container.setAttribute("tabindex", "-1");
      container.focus();
    } else {
      first.focus();
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    const focusables = getFocusables();
    if (focusables.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }

    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstEl || document.activeElement === container) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (document.activeElement === container) {
        e.preventDefault();
        firstEl.focus();
      }
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
    if (previous && typeof previous.focus === "function" && document.contains(previous)) {
      try {
        previous.focus();
      } catch {
        // Safe focus restoration
      }
    }
  };
}
