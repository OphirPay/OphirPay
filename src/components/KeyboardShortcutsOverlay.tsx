"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, useCallback } from "react";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

/**
 * Global keyboard shortcuts overlay.
 * Mounts in AppShell to provide system-wide shortcut discovery via '?' or 'Ctrl+/'
 * and restores focus to the active trigger element when dismissed.
 */
export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleOpen = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) || null;
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger that initiated the modal
    if (triggerRef.current && typeof triggerRef.current.focus === "function") {
      setTimeout(() => {
        triggerRef.current?.focus();
      }, 0);
    }
  }, []);

  // Listen for the custom open event triggered by UI buttons
  useEffect(() => {
    const onOpenEvent = () => handleOpen();
    window.addEventListener("ophirpay:open-shortcuts", onOpenEvent);
    return () => window.removeEventListener("ophirpay:open-shortcuts", onOpenEvent);
  }, [handleOpen]);

  // Global keyboard shortcuts: '?' and 'Ctrl+/'
  useKeyboardShortcuts([
    {
      key: "?",
      handler: () => {
        setOpen((prev) => {
          if (!prev) triggerRef.current = (document.activeElement as HTMLElement) || null;
          return !prev;
        });
      },
      description: "Toggle shortcuts cheat sheet",
    },
    {
      key: "/",
      ctrlKey: true,
      handler: () => {
        setOpen((prev) => {
          if (!prev) triggerRef.current = (document.activeElement as HTMLElement) || null;
          return !prev;
        });
      },
      description: "Toggle shortcuts cheat sheet",
    },
  ]);

  return <KeyboardShortcutsModal open={open} onClose={handleClose} />;
}
