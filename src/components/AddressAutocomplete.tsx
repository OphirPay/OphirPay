"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";
import { searchAddressBook, saveAddress } from "@/lib/address-book";
import { isValidStellarAddress } from "@/lib/stellar";
import {
  validateStellarAddress,
  type StellarAddressValidationResult,
} from "@/lib/validation-helpers";
import { shortenAddress, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onValidationChange?: (result: StellarAddressValidationResult) => void;
  showValidationFeedback?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

type Option =
  | { kind: "entry"; publicKey: string; label: string; memo?: string }
  | { kind: "save"; publicKey: string };

/**
 * Stellar recipient input with address-book autocomplete and inline StrKey validation.
 *
 * - Types into the field, matching entries (label or address) appear below.
 * - Arrow keys + Enter select; Escape closes; click or outside-click closes.
 * - Validates destination public keys on change/blur using Stellar SDK's
 *   `StrKey.isValidEd25519PublicKey()`, showing an inline warning when prefix,
 *   length, or CRC checksum fails, and a green checkmark when valid.
 * - When the typed value is a valid Stellar address not yet in the address
 *   book, a "Save to address book" action is offered (label defaults to the
 *   shortened address — rename it later on the Address Book page).
 * - Selecting an entry bumps its `lastUsed` so "recent" ordering stays fresh.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onValidationChange,
  showValidationFeedback = true,
  id,
  name,
  placeholder = "G...",
  disabled = false,
  className,
  "data-testid": dataTestId,
}: AddressAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [justSaved, setJustSaved] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const query = value.trim();

  const validation = useMemo(() => validateStellarAddress(query), [query]);

  useEffect(() => {
    onValidationChange?.(validation);
  }, [validation, onValidationChange]);

  const matches = useMemo(() => {
    if (!query) return [];
    return searchAddressBook(query);
  }, [query]);

  const canSave = useMemo(() => {
    if (justSaved) return false;
    return (
      isValidStellarAddress(query) &&
      !matches.some((m) => m.publicKey === query)
    );
  }, [query, matches, justSaved]);

  const options: Option[] = useMemo(() => {
    const opts: Option[] = matches.map((m) => ({
      kind: "entry",
      publicKey: m.publicKey,
      label: m.label,
      memo: m.memo,
    }));
    if (canSave) opts.push({ kind: "save", publicKey: query });
    return opts;
  }, [matches, canSave, query]);

  const showDropdown = open && options.length > 0 && !disabled;
  const showValidIndicator =
    showValidationFeedback && query.length > 0 && validation.valid;
  const showWarning =
    showValidationFeedback &&
    !validation.valid &&
    (query.length > 0 || blurred);

  // Close on outside click / Escape
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!showDropdown) setHighlighted(-1);
  }, [showDropdown]);

  const selectEntry = (publicKey: string) => {
    onChange(publicKey);
    // Bump lastUsed for the recent-addresses ordering
    const entry = matches.find((m) => m.publicKey === publicKey);
    if (entry) saveAddress(entry);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleSave = () => {
    saveAddress({
      publicKey: query,
      label: shortenAddress(query),
    });
    setJustSaved(true);
    setOpen(false);
    toast.success("Saved to address book", shortenAddress(query));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (showDropdown && highlighted >= 0) {
        e.preventDefault();
        const option = options[highlighted];
        if (option?.kind === "entry") selectEntry(option.publicKey);
        else if (option?.kind === "save") handleSave();
      }
      return;
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setJustSaved(false);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setBlurred(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          data-testid={dataTestId}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-autocomplete="list"
          aria-invalid={showWarning ? true : undefined}
          aria-label="Recipient address with address book autocomplete"
          className={cn(
            "w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed",
            showValidIndicator
              ? "pr-10 border-green-500 dark:border-green-500 focus:ring-green-500"
              : showWarning
                ? "border-amber-500 dark:border-amber-500 focus:ring-amber-500"
                : "border-gray-200 dark:border-gray-700 focus:ring-ophir-500"
          )}
        />
        {showValidIndicator && (
          <span
            data-testid="strkey-valid-indicator"
            aria-label="Valid Stellar public key"
            title="Valid Stellar public key"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-green-600 dark:text-green-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}
      </div>

      {showWarning && validation.error && (
        <p
          data-testid="strkey-validation-warning"
          role="alert"
          className="mt-1.5 text-xs text-amber-600 dark:text-amber-400"
        >
          {validation.error}
        </p>
      )}

      {showDropdown && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
        >
          {options.map((option, index) => {
            const active = index === highlighted;
            if (option.kind === "entry") {
              return (
                <li
                  key={option.publicKey}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the input
                    selectEntry(option.publicKey);
                  }}
                  className={cn(
                    "px-4 py-2.5 cursor-pointer",
                    active
                      ? "bg-ophir-50 dark:bg-ophir-950/40"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  )}
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {option.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                    {shortenAddress(option.publicKey, 6)}
                    {option.memo ? ` · memo: ${option.memo}` : ""}
                  </p>
                </li>
              );
            }
            return (
              <li
                key="__save__"
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSave();
                }}
                className={cn(
                  "px-4 py-2.5 cursor-pointer border-t border-gray-100 dark:border-gray-800",
                  active
                    ? "bg-ophir-50 dark:bg-ophir-950/40"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                )}
              >
                <p className="text-sm font-medium text-ophir-700 dark:text-ophir-400">
                  + Save to address book
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                  {shortenAddress(option.publicKey, 6)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
