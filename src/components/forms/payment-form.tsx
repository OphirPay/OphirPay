"use client";
// SPDX-License-Identifier: MIT

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  searchAddressBook,
  lookupContactByAddress,
  isBlacklistedAddress,
  isUntrustedAddress,
  saveAddressSafe,
  type AddressEntry,
} from "@/lib/address-book";
import { isValidStellarAddress } from "@/lib/stellar";
import { shortenAddress, cn } from "@/lib/utils";

export interface PaymentFormData {
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
  contact?: AddressEntry;
}

export interface PaymentFormProps {
  initialRecipient?: string;
  initialAmount?: string;
  initialAsset?: string;
  initialMemo?: string;
  onSubmit?: (data: PaymentFormData) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function PaymentForm({
  initialRecipient = "",
  initialAmount = "",
  initialAsset = "USDC",
  initialMemo = "",
  onSubmit,
  disabled = false,
  className,
}: PaymentFormProps) {
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  const [asset, setAsset] = useState(initialAsset);
  const [memo, setMemo] = useState(initialMemo);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [saveAliasInput, setSaveAliasInput] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Filter matching contacts as user types
  const matches = useMemo(() => {
    const q = recipient.trim();
    if (!q) return [];
    return searchAddressBook(q);
  }, [recipient]);

  // Check if current recipient matches an existing recognized contact
  const recognizedContact = useMemo(() => {
    return lookupContactByAddress(recipient.trim());
  }, [recipient]);

  // Security checks
  const isBlacklisted = useMemo(() => {
    return isBlacklistedAddress(recipient.trim());
  }, [recipient]);

  const isUntrusted = useMemo(() => {
    return isUntrustedAddress(recipient.trim());
  }, [recipient]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectContact = (contact: AddressEntry) => {
    setRecipient(contact.publicKey);
    if (contact.memo) {
      setMemo(contact.memo);
    }
    setDropdownOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || matches.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      const selected = matches[highlightedIndex];
      if (selected) {
        handleSelectContact(selected);
      }
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  };

  const handleSaveContact = () => {
    setSaveError(null);
    const pubKey = recipient.trim();
    if (!isValidStellarAddress(pubKey)) {
      setSaveError("Invalid Stellar public key.");
      return;
    }

    const res = saveAddressSafe({
      publicKey: pubKey,
      label: saveAliasInput.trim() || shortenAddress(pubKey, 4),
      alias: saveAliasInput.trim() || undefined,
      memo: memo.trim() || undefined,
    });

    if (!res.success) {
      setSaveError(res.message || "Failed to save contact due to conflict.");
      return;
    }

    setShowSaveModal(false);
    setSaveAliasInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient || !amount || disabled || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit?.({
        recipient: recipient.trim(),
        amount: amount.trim(),
        asset,
        memo: memo.trim() || undefined,
        contact: recognizedContact,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      data-testid="payment-form"
      onSubmit={handleSubmit}
      className={cn(
        "p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm space-y-5",
        className
      )}
    >
      {/* Blacklist / Untrusted Security Warning Banner */}
      {isBlacklisted ? (
        <div
          data-testid="address-warning-banner"
          className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5 font-medium"
        >
          <span className="text-lg">⚠️</span>
          <div>
            <p className="font-semibold">Security Alert: Blacklisted Address</p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
              This recipient address matches a flagged malicious or fraudulent account. Sending funds to this address is dangerous.
            </p>
          </div>
        </div>
      ) : isUntrusted ? (
        <div
          data-testid="address-warning-banner"
          className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-2.5 font-medium"
        >
          <span className="text-lg">⚠️</span>
          <div>
            <p className="font-semibold">Notice: Untrusted Address</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              This recipient account is marked as untrusted. Please double-check the recipient details before sending.
            </p>
          </div>
        </div>
      ) : null}

      {/* Recipient Address Field with Autocomplete */}
      <div ref={containerRef} className="space-y-1.5 relative">
        <div className="flex items-center justify-between">
          <label
            htmlFor="recipient-input"
            className="block text-sm font-semibold text-gray-800 dark:text-gray-200"
          >
            Recipient Address
          </label>

          {/* Recognized Contact Badge */}
          {recognizedContact && (
            <span
              data-testid="contact-recognized-badge"
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-ophir-50 text-ophir-700 dark:bg-ophir-950/60 dark:text-ophir-300 border border-ophir-200 dark:border-ophir-800"
            >
              <span>👤</span>
              <span>{recognizedContact.alias ? `@${recognizedContact.alias}` : recognizedContact.label}</span>
            </span>
          )}
        </div>

        <div className="relative">
          <input
            id="recipient-input"
            data-testid="recipient-input"
            type="text"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="G... or search contact by name / alias / federation"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
            autoComplete="off"
          />

          {/* Autocomplete Dropdown */}
          {dropdownOpen && matches.length > 0 && !disabled && (
            <ul
              data-testid="contacts-dropdown"
              className="absolute z-30 mt-1.5 w-full max-h-60 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl divide-y divide-gray-100 dark:divide-gray-800"
            >
              {matches.map((contact, index) => {
                const isSelected = index === highlightedIndex;
                return (
                  <li
                    key={contact.publicKey}
                    data-testid={`contact-suggestion-${contact.publicKey}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectContact(contact);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={cn(
                      "px-4 py-2.5 cursor-pointer transition-colors flex items-center justify-between",
                      isSelected
                        ? "bg-ophir-50 dark:bg-ophir-950/40"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {contact.label}
                        </span>
                        {contact.alias && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            @{contact.alias}
                          </span>
                        )}
                        {contact.isBlacklisted && (
                          <span className="px-1.5 py-0.2 text-[10px] font-bold rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                            Blocked
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {contact.publicKey}
                      </p>
                      {contact.memo && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                          memo: {contact.memo}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Quick action to save unrecorded valid address */}
        {!recognizedContact && isValidStellarAddress(recipient.trim()) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              data-testid="save-contact-action-btn"
              onClick={() => setShowSaveModal(true)}
              className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline font-medium"
            >
              + Save this address to contacts
            </button>
          </div>
        )}
      </div>

      {/* Save Contact Conflict / Alias Inline Modal */}
      {showSaveModal && (
        <div
          data-testid="save-contact-modal"
          className="p-4 rounded-xl border border-ophir-200 dark:border-ophir-900 bg-ophir-50/50 dark:bg-ophir-950/20 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
              Add New Contact
            </h4>
            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <div>
              <label
                htmlFor="save-alias-input"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                Contact Name / Alias
              </label>
              <input
                id="save-alias-input"
                data-testid="save-alias-input"
                type="text"
                value={saveAliasInput}
                onChange={(e) => setSaveAliasInput(e.target.value)}
                placeholder="e.g. Alice or supplier_a"
                className="w-full mt-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            {saveError && (
              <p
                data-testid="contact-conflict-error"
                className="text-xs text-red-600 dark:text-red-400 font-medium"
              >
                {saveError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-save-contact-btn"
                onClick={handleSaveContact}
                className="px-3 py-1 text-xs font-semibold text-white bg-ophir-600 hover:bg-ophir-700 rounded-lg shadow-sm"
              >
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Amount and Asset Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label
            htmlFor="amount-input"
            className="block text-sm font-semibold text-gray-800 dark:text-gray-200"
          >
            Amount
          </label>
          <input
            id="amount-input"
            data-testid="amount-input"
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
            placeholder="0.00"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="asset-select"
            className="block text-sm font-semibold text-gray-800 dark:text-gray-200"
          >
            Asset
          </label>
          <select
            id="asset-select"
            data-testid="asset-select"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
          >
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
            <option value="EURC">EURC</option>
          </select>
        </div>
      </div>

      {/* Memo Field */}
      <div className="space-y-1.5">
        <label
          htmlFor="memo-input"
          className="block text-sm font-semibold text-gray-800 dark:text-gray-200"
        >
          Transaction Memo (Optional)
        </label>
        <input
          id="memo-input"
          data-testid="memo-input"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={disabled}
          placeholder="Max 28 bytes memo"
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
        />
      </div>

      {/* Submit Action */}
      <div className="pt-2">
        <button
          type="submit"
          data-testid="payment-submit-btn"
          disabled={disabled || !recipient || !amount || isSubmitting}
          className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-ophir-600 hover:bg-ophir-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all duration-150"
        >
          {isSubmitting ? "Processing Payment..." : "Send Payment"}
        </button>
      </div>
    </form>
  );
}
