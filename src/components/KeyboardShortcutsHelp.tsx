"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Kbd } from "@/components/ui/Kbd";

function ShortcutRow({
  keys,
  children,
}: {
  keys: string[];
  children: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{children}</span>
      <span className="flex items-center gap-1" aria-label={keys.join(" plus ")}>
        {keys.map((key, index) => (
          <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 && <span aria-hidden="true">+</span>}
            <Kbd>{key}</Kbd>
          </span>
        ))}
      </span>
    </div>
  );
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Keyboard shortcuts"
        className="rounded-lg px-2 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        Keyboard shortcuts
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Keyboard shortcuts"
        description="Available keyboard navigation in OphirPay."
        size="sm"
      >
        <div className="space-y-5">
          <section aria-labelledby="navigation-shortcuts">
            <h3 id="navigation-shortcuts" className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Navigation
            </h3>
            <ShortcutRow keys={["Ctrl", "1–9"]}>
              Open one of the first nine sidebar sections
            </ShortcutRow>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              On Mac, Command works in place of Ctrl.
            </p>
          </section>
          <section aria-labelledby="table-shortcuts">
            <h3 id="table-shortcuts" className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Payments table
            </h3>
            <ShortcutRow keys={["↑", "↓"]}>Move between payment rows</ShortcutRow>
            <div className="mt-2">
              <ShortcutRow keys={["Home"]}>Move to the first row</ShortcutRow>
            </div>
            <div className="mt-2">
              <ShortcutRow keys={["End"]}>Move to the last row</ShortcutRow>
            </div>
          </section>
          <section aria-labelledby="dialog-shortcuts">
            <h3 id="dialog-shortcuts" className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Dialogs and menus
            </h3>
            <ShortcutRow keys={["Esc"]}>Close an open dialog or menu</ShortcutRow>
          </section>
        </div>
      </Modal>
    </>
  );
}
