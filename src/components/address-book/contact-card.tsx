"use client";
// SPDX-License-Identifier: MIT

import React from "react";
import type { AddressEntry } from "@/lib/address-book";
import { shortenAddress, cn } from "@/lib/utils";

export interface ContactCardProps {
  contact: AddressEntry;
  onSelect?: (contact: AddressEntry) => void;
  onEdit?: (contact: AddressEntry) => void;
  onDelete?: (publicKey: string) => void;
  className?: string;
  isSelected?: boolean;
}

export function ContactCard({
  contact,
  onSelect,
  onEdit,
  onDelete,
  className,
  isSelected = false,
}: ContactCardProps) {
  const isBlacklisted = Boolean(contact.isBlacklisted);
  const isUntrusted = Boolean(contact.isUntrusted);

  return (
    <div
      data-testid={`contact-card-${contact.publicKey}`}
      className={cn(
        "p-4 rounded-xl border transition-all duration-150 flex flex-col justify-between gap-3",
        isSelected
          ? "border-ophir-500 bg-ophir-50/40 dark:bg-ophir-950/20 shadow-sm"
          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700",
        isBlacklisted && "border-red-300 dark:border-red-900/60 bg-red-50/30 dark:bg-red-950/10",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              data-testid="contact-label"
              className="text-base font-semibold text-gray-900 dark:text-white truncate"
            >
              {contact.label}
            </h3>

            {contact.alias && (
              <span
                data-testid="contact-alias-badge"
                className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
              >
                @{contact.alias}
              </span>
            )}

            {isBlacklisted ? (
              <span
                data-testid="contact-blacklisted-badge"
                className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800"
              >
                Blacklisted
              </span>
            ) : isUntrusted ? (
              <span
                data-testid="contact-untrusted-badge"
                className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
              >
                Untrusted
              </span>
            ) : (
              <span
                data-testid="contact-verified-badge"
                className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 border border-green-200 dark:border-green-800"
              >
                Verified
              </span>
            )}
          </div>

          <p
            data-testid="contact-public-key"
            className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1 truncate"
            title={contact.publicKey}
          >
            {shortenAddress(contact.publicKey, 8)}
          </p>

          {contact.federationAddress && (
            <p
              data-testid="contact-federation-address"
              className="text-xs text-ophir-600 dark:text-ophir-400 font-medium mt-0.5 truncate"
            >
              {contact.federationAddress}
            </p>
          )}

          {contact.memo && (
            <p
              data-testid="contact-memo"
              className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic"
            >
              Default Memo: <span className="font-mono">{contact.memo}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800/80">
        {onEdit && (
          <button
            type="button"
            data-testid="contact-edit-btn"
            onClick={() => onEdit(contact)}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            data-testid="contact-delete-btn"
            onClick={() => onDelete(contact.publicKey)}
            className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 rounded hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            Delete
          </button>
        )}
        {onSelect && (
          <button
            type="button"
            data-testid="contact-select-btn"
            onClick={() => onSelect(contact)}
            className="px-3 py-1 text-xs font-semibold text-white bg-ophir-600 hover:bg-ophir-700 rounded-lg shadow-sm transition-colors"
          >
            Select
          </button>
        )}
      </div>
    </div>
  );
}
