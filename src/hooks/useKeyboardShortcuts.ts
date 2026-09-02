"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useCallback } from "react";

type KeyHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  handler: KeyHandler;
  description?: string;
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
 *
 * Usage:
 *   useKeyboardShortcuts([
 *     { key: "k", metaKey: true, handler: () => openSearch() },
 *     { key: "n", ctrlKey: true, handler: () => createNew() },
 *   ]);
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in form fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      for (const s of shortcuts) {
        const ctrlMatch = s.ctrlKey ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey;
        const metaMatch = s.metaKey ? e.metaKey : true;
        const shiftMatch = s.shiftKey ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === s.key.toLowerCase() && ctrlMatch && metaMatch && shiftMatch) {
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
