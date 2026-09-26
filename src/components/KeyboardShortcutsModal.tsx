"use client";
// SPDX-License-Identifier: MIT

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { Kbd } from "@/components/ui/Kbd";
import {
  SHORTCUT_REGISTRY,
  ALL_SHORTCUTS,
  type ShortcutDefinition,
} from "@/hooks/useKeyboardShortcuts";

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      description="Quick actions and navigation chords across OphirPay."
      size="lg"
    >
      <div
        className="space-y-6 max-h-[60vh] overflow-y-auto pr-1"
        data-testid="keyboard-shortcuts-content"
      >
        {SHORTCUT_REGISTRY.map((group) => (
          <div key={group.id} className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {group.title}
            </h3>
            <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-hidden">
              {group.shortcuts.map((shortcut: ShortcutDefinition) => (
                <div
                  key={shortcut.id}
                  data-shortcut-id={shortcut.id}
                  className="flex items-center justify-between p-3 text-sm"
                >
                  <span className="text-gray-700 dark:text-gray-300">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    {shortcut.keys.map((k, idx) => (
                      <span key={idx} className="flex items-center gap-1">
                        {idx > 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                            +
                          </span>
                        )}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          Press <Kbd>Esc</Kbd> or click outside to close
        </span>
        <span className="font-mono">
          {ALL_SHORTCUTS.length} shortcuts registered
        </span>
      </div>
    </Modal>
  );
}
