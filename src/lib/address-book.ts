// SPDX-License-Identifier: MIT

import { parseCsvText } from "@/lib/csv-import";
import { isValidStellarAddress } from "@/lib/stellar";

/**
 * Client-side address book using localStorage.
 * Stores frequently used Stellar addresses with labels for quick access.
 */

export interface AddressEntry {
  publicKey: string;
  label: string;
  memo?: string;
  lastUsed?: number;
}

export interface AddressBookImportRejection {
  row: number;
  message: string;
}

export interface AddressBookImportResult {
  added: number;
  updated: number;
  rejected: AddressBookImportRejection[];
}

const STORAGE_KEY = "ophirpay-address-book";
const LABEL_MAX_LENGTH = 100;
const CONTACT_MEMO_MAX_LENGTH = 28;

/**
 * Import contacts from a CSV with `label` and `address` (or `publicKey`)
 * headers and an optional `memo` header. A valid matching address updates its
 * label; a non-empty imported memo replaces the saved memo, while an empty
 * memo preserves it. Existing last-used metadata is retained. Repeated
 * addresses in the file are rejected row-by-row rather than overwritten.
 */
export function importAddressBookCsv(csvText: string): AddressBookImportResult {
  const rejected: AddressBookImportRejection[] = [];
  const parsed = parseCsvText(csvText);
  if (parsed.length < 2) {
    return {
      added: 0,
      updated: 0,
      rejected: [{ row: 1, message: "CSV must have a header row and at least one contact." }],
    };
  }

  const headers = parsed[0].map((header) => header.trim().toLowerCase());
  const labelIndex = headers.findIndex((header) => header === "label");
  const addressIndex = headers.findIndex(
    (header) => header === "address" || header === "publickey"
  );
  const memoIndex = headers.indexOf("memo");

  if (labelIndex < 0 || addressIndex < 0) {
    return {
      added: 0,
      updated: 0,
      rejected: [{
        row: 1,
        message: "CSV header must include label and address (or publicKey) columns.",
      }],
    };
  }

  const book = getAddressBook();
  const seenInFile = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const [index, cells] of parsed.slice(1).entries()) {
    const row = index + 2;
    const label = (cells[labelIndex] ?? "").trim();
    const publicKey = (cells[addressIndex] ?? "").trim();
    const memo = memoIndex >= 0 ? (cells[memoIndex] ?? "").trim() : "";
    const errors: string[] = [];

    if (cells.length > headers.length) errors.push("Unexpected extra columns.");
    if (!label) errors.push("Label is required.");
    else if (label.length > LABEL_MAX_LENGTH) {
      errors.push(`Label must be ${LABEL_MAX_LENGTH} characters or fewer.`);
    }
    if (!publicKey) errors.push("Address is required.");
    else if (!isValidStellarAddress(publicKey)) errors.push("Invalid Stellar address.");
    if (memo.length > CONTACT_MEMO_MAX_LENGTH) {
      errors.push(`Memo must be ${CONTACT_MEMO_MAX_LENGTH} characters or fewer.`);
    }
    if (publicKey && seenInFile.has(publicKey)) {
      errors.push("Duplicate address in CSV.");
    }

    if (errors.length) {
      rejected.push({ row, message: errors.join(" ") });
      continue;
    }

    seenInFile.add(publicKey);
    const existingIndex = book.findIndex((entry) => entry.publicKey === publicKey);
    if (existingIndex >= 0) {
      const existing = book[existingIndex];
      book[existingIndex] = {
        ...existing,
        label,
        ...(memo ? { memo } : {}),
      };
      updated += 1;
    } else {
      book.push({ publicKey, label, ...(memo ? { memo } : {}) });
      added += 1;
    }
  }

  if (added || updated) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  }
  return { added, updated, rejected };
}

/** Get all saved addresses from localStorage. */
export function getAddressBook(): AddressEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AddressEntry[]) : [];
  } catch {
    return [];
  }
}

/** Add or update an address in the address book. */
export function saveAddress(entry: AddressEntry): void {
  const book = getAddressBook();
  const idx = book.findIndex((a) => a.publicKey === entry.publicKey);
  if (idx >= 0) {
    book[idx] = { ...book[idx], ...entry, lastUsed: Date.now() };
  } else {
    book.push({ ...entry, lastUsed: Date.now() });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
}

/** Remove an address from the address book. */
export function removeAddress(publicKey: string): void {
  const book = getAddressBook().filter((a) => a.publicKey !== publicKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
}

/** Search address book by label or public key. */
export function searchAddressBook(query: string): AddressEntry[] {
  const q = query.toLowerCase();
  return getAddressBook().filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      a.publicKey.toLowerCase().includes(q)
  );
}

/** Get recently used addresses (last 5 by lastUsed). */
export function getRecentAddresses(limit = 5): AddressEntry[] {
  return getAddressBook()
    .filter((a) => a.lastUsed)
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    .slice(0, limit);
}

/**
 * Return the subset of `entries` whose public key is not already present in
 * `existingAddresses`. Used to merge address-book selections into a batch
 * recipient list without duplicating manually added or CSV-imported rows.
 * Existing addresses are trimmed before comparison so whitespace differences
 * don't produce false duplicates.
 */
export function mergeAddressBookSelections(
  entries: AddressEntry[],
  existingAddresses: string[]
): AddressEntry[] {
  const existing = new Set(existingAddresses.map((a) => a.trim()));
  return entries.filter((e) => !existing.has(e.publicKey));
}
