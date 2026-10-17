"use client";
// SPDX-License-Identifier: MIT

import type { AddressEntry } from "@/lib/address-book";
import { shortenAddress, cn } from "@/lib/utils";

export interface ContactCardProps {
  contact: AddressEntry;
  selected?: boolean;
  onSelect?: (contact: AddressEntry) => void;
  onDelete?: (publicKey: string) => void;
  className?: string;
}

/**
 * Displays a saved address-book contact with its alias, shortened Stellar
 * public key, optional federation address and memo, plus trust/blacklist badges.
 */
export function ContactCard({
  contact,
  selected = false,
  onSelect,
  onDelete,
  className,
}: ContactCardProps) {
  const isFlagged = Boolean(contact.blacklisted || contact.untrusted);

  return (
    <div
      data-testid={`contact-card-${contact.publicKey}`}
      onClick={() => onSelect?.(contact)}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(contact);
        }
      }}
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        onSelect && "cursor-pointer",
        selected
          ? "border-ophir-500 bg-ophir-50/60 dark:border-ophir-400 dark:bg-ophir-950/30"
          : isFlagged
            ? "border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20"
            : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/60",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {contact.label}
            </span>
            {contact.blacklisted ? (
              <span
                data-testid="contact-badge-blacklisted"
                className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
              >
                Blacklisted
              </span>
            ) : contact.untrusted ? (
              <span
                data-testid="contact-badge-untrusted"
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              >
                Untrusted
              </span>
            ) : (
              <span
                data-testid="contact-badge-verified"
                className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300"
              >
                Saved Contact
              </span>
            )}
          </div>

          <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
            {shortenAddress(contact.publicKey, 6)}
          </p>

          {contact.federationAddress && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">
              {contact.federationAddress}
            </p>
          )}

          {contact.memo && (
            <p className="mt-0.5 text-xs text-ophir-600 dark:text-ophir-400 truncate">
              Memo: {contact.memo}
            </p>
          )}
        </div>

        {onDelete && (
          <button
            type="button"
            aria-label={`Remove ${contact.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(contact.publicKey);
            }}
            className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
