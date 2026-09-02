"use client";
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react";
import { getAddressBook } from "@/lib/address-book";
import type { AddressEntry } from "@/lib/address-book";
import { shortenAddress } from "@/lib/utils";

interface AddressBookMultiSelectProps {
  /** Called with the selected entries and the default amount to apply to each. */
  onAdd: (entries: AddressEntry[], defaultAmount: string) => void;
  /** Addresses already present in the batch; shown as already added and not selectable. */
  existingAddresses?: string[];
  disabled?: boolean;
}

/**
 * Multi-select picker over the saved address book. Lets users tick several
 * contacts, optionally set a default amount that applies to every selected
 * row, and append them to the batch recipient list in one action.
 */
export function AddressBookMultiSelect({
  onAdd,
  existingAddresses = [],
  disabled = false,
}: AddressBookMultiSelectProps) {
  const [entries] = useState<AddressEntry[]>(() => getAddressBook());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [defaultAmount, setDefaultAmount] = useState("");

  const existing = useMemo(
    () => new Set(existingAddresses.map((a) => a.trim())),
    [existingAddresses]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.publicKey.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const selectable = filtered.filter((e) => !existing.has(e.publicKey));
  const selectableSelected = selectable.filter((e) => selected.has(e.publicKey));

  const toggle = (publicKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(publicKey)) next.delete(publicKey);
      else next.add(publicKey);
      return next;
    });
  };

  const handleAdd = () => {
    if (selectableSelected.length === 0 || disabled) return;
    onAdd(selectableSelected, defaultAmount);
    setSelected(new Set());
  };

  if (entries.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No saved contacts yet. Save addresses to your address book to add
          them to a batch quickly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder="Search contacts by name or address..."
          aria-label="Search address book"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Contact list */}
      <div
        className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800"
        role="group"
        aria-label="Address book contacts"
      >
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
            No contacts match “{query.trim()}”.
          </p>
        )}
        {filtered.map((entry) => {
          const alreadyAdded = existing.has(entry.publicKey);
          const checked = selected.has(entry.publicKey);
          return (
            <label
              key={entry.publicKey}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                alreadyAdded
                  ? "opacity-60 cursor-not-allowed"
                  : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || alreadyAdded}
                onChange={() => toggle(entry.publicKey)}
                aria-label={`Add ${entry.label}`}
                className="h-4 w-4 rounded border-gray-300 text-ophir-600 focus:ring-ophir-500 disabled:opacity-50"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">
                  {entry.label}
                </span>
                <span className="block text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                  {shortenAddress(entry.publicKey, 6)}
                </span>
              </span>
              {alreadyAdded && (
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500 flex-shrink-0">
                  In batch
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* Default amount + Add button */}
      <div className="flex items-end gap-3">
        <div className="relative flex-1">
          <input
            type="number"
            value={defaultAmount}
            onChange={(e) => setDefaultAmount(e.target.value)}
            disabled={disabled}
            placeholder="0.00"
            step="0.0000001"
            min="0.0000001"
            aria-label="Default amount per recipient"
            className="w-full px-3 py-2 pr-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
            XLM
          </span>
        </div>
        <button
          onClick={handleAdd}
          disabled={disabled || selectableSelected.length === 0}
          className="px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add Selected ({selectableSelected.length})
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Contacts already in the batch are skipped when adding.
      </p>
    </div>
  );
}
