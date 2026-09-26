"use client";
// SPDX-License-Identifier: MIT

import { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Kbd } from "@/components/ui/Kbd";
import { Button } from "@/components/ui/Button";
import {
  useKeyboardShortcutOverlay,
  getRegisteredShortcuts,
  type ShortcutDefinition,
  type ShortcutCategory,
} from "@/hooks/useKeyboardShortcuts";

const CATEGORY_TITLES: Record<ShortcutCategory, string> = {
  global: "Global",
  tables: "Tables & Lists",
  dialogs: "Dialogs & Overlays",
};

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  shortcuts?: ShortcutDefinition[];
}

/**
 * Modal dialog that displays all registered keyboard shortcuts grouped by context.
 */
export function KeyboardShortcutsModal({
  open,
  onClose,
  shortcuts = getRegisteredShortcuts(),
}: KeyboardShortcutsModalProps) {
  const groupedShortcuts = useMemo(() => {
    const groups: Record<ShortcutCategory, ShortcutDefinition[]> = {
      global: [],
      tables: [],
      dialogs: [],
    };
    for (const shortcut of shortcuts) {
      if (groups[shortcut.category]) {
        groups[shortcut.category].push(shortcut);
      }
    }
    return groups;
  }, [shortcuts]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      description="Quick reference for keyboard navigation and shortcuts"
      size="md"
      footer={
        <div className="flex items-center justify-between w-full text-xs text-gray-500 dark:text-gray-400">
          <span>
            Press <Kbd>Esc</Kbd> or click outside to dismiss
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
        {(["global", "tables", "dialogs"] as ShortcutCategory[]).map((cat) => {
          const items = groupedShortcuts[cat];
          if (!items || items.length === 0) return null;

          return (
            <div key={cat} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {CATEGORY_TITLES[cat]}
              </h3>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, idx) =>
                        k === "or" ? (
                          <span
                            key={idx}
                            className="text-xs text-gray-400 dark:text-gray-500 px-1"
                          >
                            or
                          </span>
                        ) : (
                          <Kbd key={idx}>{k}</Kbd>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Self-contained overlay listener that mounts in the application shell.
 * Automatically listens for '?' or 'Ctrl+/' chords to toggle the modal.
 */
export function KeyboardShortcutsOverlay() {
  const { isOpen, close, shortcuts } = useKeyboardShortcutOverlay();

  return (
    <KeyboardShortcutsModal
      open={isOpen}
      onClose={close}
      shortcuts={shortcuts}
    />
  );
}
