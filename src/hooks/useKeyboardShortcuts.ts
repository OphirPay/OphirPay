"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useCallback, useState } from "react";

type KeyHandler = (e: KeyboardEvent) => void;

export type ShortcutCategory = "global" | "tables" | "dialogs";

export interface ShortcutDefinition {
  id: string;
  category: ShortcutCategory;
  keys: string[];
  description: string;
}

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  handler: KeyHandler;
  description?: string;
  category?: ShortcutCategory;
}

/**
 * Authoritative registry of keyboard shortcuts across the application.
 * Categorized by context: global, tables, dialogs.
 */
export const REGISTERED_SHORTCUTS: ShortcutDefinition[] = [
  // Global context
  {
    id: "help-overlay",
    category: "global",
    keys: ["?", "or", "Ctrl", "/"],
    description: "Open keyboard shortcuts cheat sheet",
  },
  {
    id: "quick-search",
    category: "global",
    keys: ["Ctrl", "K"],
    description: "Open search dialog",
  },
  {
    id: "new-payment",
    category: "global",
    keys: ["Ctrl", "N"],
    description: "Create new payment",
  },
  // Table navigation context
  {
    id: "table-next-row",
    category: "tables",
    keys: ["↓", "or", "j"],
    description: "Navigate to next row",
  },
  {
    id: "table-prev-row",
    category: "tables",
    keys: ["↑", "or", "k"],
    description: "Navigate to previous row",
  },
  {
    id: "table-first-row",
    category: "tables",
    keys: ["Home"],
    description: "Jump to first table row",
  },
  {
    id: "table-last-row",
    category: "tables",
    keys: ["End"],
    description: "Jump to last table row",
  },
  {
    id: "table-activate-row",
    category: "tables",
    keys: ["Enter"],
    description: "Open details for selected row",
  },
  // Dialog / Modal context
  {
    id: "dialog-close",
    category: "dialogs",
    keys: ["Esc"],
    description: "Close active dialog or overlay",
  },
  {
    id: "dialog-cycle-forward",
    category: "dialogs",
    keys: ["Tab"],
    description: "Cycle forward through focusable elements",
  },
  {
    id: "dialog-cycle-backward",
    category: "dialogs",
    keys: ["Shift", "Tab"],
    description: "Cycle backward through focusable elements",
  },
];

/**
 * Returns all currently registered keyboard shortcuts.
 */
export function getRegisteredShortcuts(): ShortcutDefinition[] {
  return REGISTERED_SHORTCUTS;
}

/**
 * Hook to manage the keyboard shortcut cheat sheet overlay.
 * Listens for "?" or "Cmd/Ctrl+/" to toggle the overlay.
 */
export function useKeyboardShortcutOverlay() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is actively typing in a form input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Chord 1: "?" (Shift + / or key === "?")
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }

      // Chord 2: Cmd+/ or Ctrl+/
      if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { isOpen, open, close, toggle, shortcuts: REGISTERED_SHORTCUTS };
}

/**
 * Register global keyboard shortcuts.
 * Each shortcut is only active when no input/textarea/select is focused.
 *
 * @example
 * Wire up dashboard-wide shortcuts that open a search dialog and create a
 * new payment:
 *
 * ```tsx
 * function DashboardShortcuts() {
 *   const { setIsSearchOpen } = useSearch();
 *   useKeyboardShortcuts([
 *     { key: "k", metaKey: true, handler: () => setIsSearchOpen(true) },
 *     { key: "n", ctrlKey: true, handler: () => router.push("/send") },
 *   ]);
 *   return null;
 * }
 * ```
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in form fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      for (const s of shortcuts) {
        // A shortcut is a "modifier chord" when it asks for ctrl and/or meta.
        // Ctrl and Cmd are treated interchangeably (⌘ on macOS, Ctrl
        // elsewhere), so a `{ metaKey: true }` shortcut fires on both. A
        // shortcut that asks for neither must not fire when a modifier is
        // held — otherwise plain keys would hijack browser shortcuts.
        const wantsModifier = Boolean(s.ctrlKey || s.metaKey);
        const modifierMatch = wantsModifier
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const shiftMatch = s.shiftKey ? e.shiftKey : !e.shiftKey;

        if (
          e.key.toLowerCase() === s.key.toLowerCase() &&
          modifierMatch &&
          shiftMatch
        ) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

