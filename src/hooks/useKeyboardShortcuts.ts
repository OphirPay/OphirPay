"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useCallback } from "react";

export type KeyHandler = (e: KeyboardEvent) => void;

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  handler: KeyHandler;
  description?: string;
}

export type ShortcutCategory = "global" | "tables" | "dialogs";

export interface ShortcutDefinition {
  id: string;
  category: ShortcutCategory;
  keys: string[];
  description: string;
}

export interface ShortcutCategoryGroup {
  id: ShortcutCategory;
  title: string;
  shortcuts: ShortcutDefinition[];
}

/**
 * Registry of all available keyboard shortcuts across OphirPay.
 * Grouped by context: global navigation, table roving tabindex, and dialog focus traps.
 */
export const SHORTCUT_REGISTRY: ShortcutCategoryGroup[] = [
  {
    id: "global",
    title: "Global Navigation",
    shortcuts: [
      {
        id: "help-cheat-sheet",
        category: "global",
        keys: ["?"],
        description: "Open keyboard shortcuts cheat sheet",
      },
      {
        id: "toggle-cheat-sheet",
        category: "global",
        keys: ["Ctrl", "/"],
        description: "Toggle keyboard shortcuts cheat sheet",
      },
      {
        id: "nav-items",
        category: "global",
        keys: ["Ctrl", "1–9"],
        description: "Jump to sidebar menu items 1–9",
      },
      {
        id: "close-active",
        category: "global",
        keys: ["Esc"],
        description: "Close active drawer, notification, or popover",
      },
    ],
  },
  {
    id: "tables",
    title: "Tables & Lists",
    shortcuts: [
      {
        id: "table-row-down",
        category: "tables",
        keys: ["↓"],
        description: "Move focus to next row",
      },
      {
        id: "table-row-up",
        category: "tables",
        keys: ["↑"],
        description: "Move focus to previous row",
      },
      {
        id: "table-row-first",
        category: "tables",
        keys: ["Home"],
        description: "Jump to first row in table",
      },
      {
        id: "table-row-last",
        category: "tables",
        keys: ["End"],
        description: "Jump to last row in table",
      },
      {
        id: "table-row-select",
        category: "tables",
        keys: ["Enter"],
        description: "Select row or navigate to detail view",
      },
    ],
  },
  {
    id: "dialogs",
    title: "Dialogs & Modals",
    shortcuts: [
      {
        id: "dialog-close",
        category: "dialogs",
        keys: ["Esc"],
        description: "Close active dialog or cancel prompt",
      },
      {
        id: "dialog-next-focus",
        category: "dialogs",
        keys: ["Tab"],
        description: "Focus next interactive element in trap",
      },
      {
        id: "dialog-prev-focus",
        category: "dialogs",
        keys: ["Shift", "Tab"],
        description: "Focus previous interactive element in trap",
      },
    ],
  },
];

/** Flat array of all registered shortcut definitions for assertion testing and lookup. */
export const ALL_SHORTCUTS: ShortcutDefinition[] = SHORTCUT_REGISTRY.flatMap(
  (group) => group.shortcuts
);

/**
 * Dispatch an application event to request opening the shortcuts cheat sheet.
 */
export function openKeyboardShortcuts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ophirpay:open-shortcuts"));
  }
}

/**
 * Register global keyboard shortcuts.
 * Each shortcut is only active when no input/textarea/select is focused.
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

        const isQuestionMark = s.key === "?";
        const shiftMatch = s.shiftKey !== undefined
          ? e.shiftKey === s.shiftKey
          : isQuestionMark
            ? true
            : !e.shiftKey;

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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
