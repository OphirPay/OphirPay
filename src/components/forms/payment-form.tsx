"use client";
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react";
import {
  addContactWithConflictCheck,
  checkAddressTrustStatus,
  findContactByAddress,
  searchAddressBook,
  type AddressEntry,
} from "@/lib/address-book";
import { shortenAddress } from "@/lib/utils";
import { ContactCard } from "@/components/address-book/contact-card";

export interface PaymentFormSubmission {
  recipient: string;
  amount: string;
  memo: string;
  recognizedContact: AddressEntry | null;
}

export interface PaymentFormProps {
  initialRecipient?: string;
  initialAmount?: string;
  initialMemo?: string;
  onSubmit?: (data: PaymentFormSubmission) => void;
}

/**
 * Payment form integrated with the client-side Stellar address book:
 * - Searches saved contacts by name/alias, federation address, or public key prefix
 * - Auto-fills verified public key and default memo when a contact is selected
 * - Displays a recognized contact badge next to the recipient input
 * - Warns users when the entered address matches an untrusted or blacklisted account
 * - Prevents saving duplicate public keys or colliding aliases with conflict feedback
 */
export function PaymentForm({
  initialRecipient = "",
  initialAmount = "",
  initialMemo = "",
  onSubmit,
}: PaymentFormProps) {
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  const [memo, setMemo] = useState(initialMemo);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Quick-save contact state
  const [newAlias, setNewAlias] = useState("");
  const [newFederation, setNewFederation] = useState("");
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [bookVersion, setBookVersion] = useState(0);

  const suggestions = useMemo(() => {
    void bookVersion;
    const q = recipient.trim();
    if (!q) return [];
    return searchAddressBook(q);
  }, [recipient, bookVersion]);

  const recognizedContact = useMemo(() => {
    void bookVersion;
    return findContactByAddress(recipient);
  }, [recipient, bookVersion]);

  const trustWarning = useMemo(() => {
    void bookVersion;
    return checkAddressTrustStatus(recipient);
  }, [recipient, bookVersion]);

  const handleSelectContact = (contact: AddressEntry) => {
    setRecipient(contact.publicKey);
    if (contact.memo) {
      setMemo(contact.memo);
    }
    setShowSuggestions(false);
    setConflictError(null);
  };

  const handleSaveContact = () => {
    setConflictError(null);
    setSavedNotice(null);

    const result = addContactWithConflictCheck({
      publicKey: recipient,
      label: newAlias,
      memo: memo.trim() || undefined,
      federationAddress: newFederation.trim() || undefined,
    });

    if (!result.ok) {
      setConflictError(result.error || "Unable to save contact.");
      return;
    }

    setNewAlias("");
    setNewFederation("");
    setSavedNotice(`Saved "${result.entry?.label}" to address book.`);
    setBookVersion((v) => v + 1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.({
      recipient: recipient.trim(),
      amount: amount.trim(),
      memo: memo.trim(),
      recognizedContact,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="address-book-payment-form"
      className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
    >
      <div>
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <label
            htmlFor="payment-recipient-input"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Recipient Address
          </label>
          {recognizedContact && (
            <span
              data-testid="recognized-contact-badge"
              className="inline-flex items-center gap-1 rounded-full bg-ophir-100 dark:bg-ophir-950/60 px-2.5 py-0.5 text-xs font-medium text-ophir-700 dark:text-ophir-300"
            >
              ✓ {recognizedContact.label}
            </span>
          )}
        </div>

        <div className="relative">
          <input
            id="payment-recipient-input"
            data-testid="payment-recipient-input"
            type="text"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setShowSuggestions(true);
              setConflictError(null);
              setSavedNotice(null);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search contact name, federation address, or G..."
            autoComplete="off"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-white"
          />

          {showSuggestions && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Matching contacts"
              data-testid="contact-suggestions"
              className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl divide-y divide-gray-100 dark:divide-gray-800"
            >
              {suggestions.map((contact) => (
                <li
                  key={contact.publicKey}
                  role="option"
                  aria-selected={recipient.trim() === contact.publicKey}
                  data-testid={`suggestion-${contact.publicKey}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectContact(contact);
                  }}
                  onClick={() => handleSelectContact(contact)}
                  className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {contact.label}
                    </span>
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                      {shortenAddress(contact.publicKey, 6)}
                    </span>
                  </div>
                  {(contact.federationAddress || contact.memo) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {contact.federationAddress ? `${contact.federationAddress} ` : ""}
                      {contact.memo ? `· memo: ${contact.memo}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {trustWarning.flagged && (
          <div
            role="alert"
            data-testid="untrusted-address-warning"
            className="mt-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300"
          >
            {trustWarning.reason}
          </div>
        )}

        {recognizedContact && (
          <div className="mt-2">
            <ContactCard contact={recognizedContact} selected />
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="payment-amount-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Amount
        </label>
        <input
          id="payment-amount-input"
          data-testid="payment-amount-input"
          type="number"
          step="0.0000001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="payment-memo-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Memo
        </label>
        <input
          id="payment-memo-input"
          data-testid="payment-memo-input"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Optional memo"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-white"
        />
      </div>

      {/* Save new contact section with conflict detection */}
      <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 p-3 space-y-2">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Save recipient to address book
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            data-testid="new-contact-alias-input"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="Contact alias (e.g. Alice)"
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-900 dark:text-white"
          />
          <input
            type="text"
            data-testid="new-contact-federation-input"
            value={newFederation}
            onChange={(e) => setNewFederation(e.target.value)}
            placeholder="Federation (optional, e.g. alice*ophirpay.com)"
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-900 dark:text-white"
          />
          <button
            type="button"
            data-testid="save-contact-btn"
            onClick={handleSaveContact}
            className="rounded-lg bg-gray-900 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            Add Contact
          </button>
        </div>

        {conflictError && (
          <p
            role="alert"
            data-testid="add-contact-conflict-error"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {conflictError}
          </p>
        )}

        {savedNotice && (
          <p
            data-testid="add-contact-saved-notice"
            className="text-xs text-green-600 dark:text-green-400"
          >
            {savedNotice}
          </p>
        )}
      </div>

      <button
        type="submit"
        data-testid="payment-submit-btn"
        className="w-full rounded-lg bg-ophir-600 py-2.5 text-sm font-medium text-white hover:bg-ophir-700"
      >
        Send Payment
      </button>
    </form>
  );
}
