"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable elements inside `root`, in DOM order, skipping anything not rendered. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Accessible modal dialog — ESC to close, backdrop click to close,
 * body scroll lock, focus trap, and focus restore on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Keep the latest `onClose` in a ref so the popstate listener below always
  // invokes the current handler without re-subscribing on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Close the modal when the user presses the browser back button instead of
  // navigating away from the page. Opening the modal pushes a history entry;
  // pressing back pops it and fires `popstate`, which closes the modal.
  useEffect(() => {
    if (!open) return;

    const handlePopState = () => onCloseRef.current();

    window.addEventListener("popstate", handlePopState);
    history.pushState({ ophirPayModal: true }, "");

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If the modal was closed by a means other than the back button (Esc,
      // backdrop, or close button), remove the history entry we pushed so the
      // page's history stays intact.
      if (history.state?.ophirPayModal) {
        try {
          history.back();
        } catch {
          // jsdom and some environments don't implement history.back().
        }
      }
    };
  }, [open]);

  // ESC to close + focus trap + body scroll lock + focus restore.
  //
  // This effect deliberately depends on `open` alone. Including `onClose` re-ran it
  // on every parent render that passed a new inline handler, and each re-run
  // recaptured `previouslyFocused` from `document.activeElement` - which by then was
  // the dialog itself. Focus was then "restored" into the dialog being unmounted
  // rather than to the control that opened it. `onCloseRef` keeps Escape calling the
  // current handler without that cost.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;

      const dialog = dialogRef.current;
      const focusables = focusableWithin(dialog);
      if (focusables.length === 0) {
        // Nothing to tab to, so keep focus on the dialog rather than letting it
        // escape to the page behind the backdrop.
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      // Focus can end up outside the dialog - a click on the backdrop, a
      // programmatic focus elsewhere - and a trap that only wraps at the edges
      // would never bring it back.
      if (!(active instanceof Node) || !dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Initial focus lands on the first interactive element, falling back to the
    // dialog when it has none.
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const [firstFocusable] = focusableWithin(dialog);
      (firstFocusable ?? dialog).focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the element that opened the dialog.
      previouslyFocused?.focus();
    };
  }, [open]);

  // Guard against SSR — createPortal needs the client-side `document`
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-xl",
          "border border-gray-200 dark:border-gray-800 shadow-2xl",
          "outline-none animate-fade-in-up",
          sizeClasses[size],
          "max-h-[90vh] overflow-y-auto"
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              {title && (
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
