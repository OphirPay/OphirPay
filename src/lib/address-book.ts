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
  federationAddress?: string;
  untrusted?: boolean;
  blacklisted?: boolean;
  warningReason?: string;
  lastUsed?: number;
}

export interface ContactConflict {
  type: "duplicate_address" | "duplicate_alias";
  existing: AddressEntry;
  message: string;
}

export interface AddContactResult {
  ok: boolean;
  entry?: AddressEntry;
  conflict?: ContactConflict;
  error?: string;
}

export interface AddressStatusWarning {
  flagged: boolean;
  status: "blacklisted" | "untrusted" | null;
  reason: string | null;
  contact: AddressEntry | null;
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
const BLACKLIST_STORAGE_KEY = "ophirpay-blacklisted-addresses";
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

/**
 * Detect whether a candidate contact conflicts with an existing saved contact
 * by public key or by alias/label (case-insensitive).
 */
export function detectContactConflict(
  entry: Pick<AddressEntry, "publicKey" | "label">,
  ignorePublicKey?: string
): ContactConflict | null {
  const targetKey = entry.publicKey.trim();
  const targetLabel = entry.label.trim().toLowerCase();
  const book = getAddressBook();

  for (const existing of book) {
    if (ignorePublicKey && existing.publicKey === ignorePublicKey.trim()) {
      continue;
    }
    if (existing.publicKey === targetKey) {
      return {
        type: "duplicate_address",
        existing,
        message: `Address is already saved under "${existing.label}".`,
      };
    }
    if (targetLabel && existing.label.trim().toLowerCase() === targetLabel) {
      return {
        type: "duplicate_alias",
        existing,
        message: `Alias "${entry.label.trim()}" is already used for ${existing.publicKey.slice(0, 6)}...${existing.publicKey.slice(-4)}.`,
      };
    }
  }

  return null;
}

/**
 * Add a new contact while enforcing uniqueness on both public key and alias.
 * Returns a structured conflict result instead of silently overwriting.
 */
export function addContactWithConflictCheck(
  entry: AddressEntry
): AddContactResult {
  const publicKey = entry.publicKey.trim();
  const label = entry.label.trim();

  if (!label) {
    return { ok: false, error: "Contact label is required." };
  }
  if (label.length > LABEL_MAX_LENGTH) {
    return {
      ok: false,
      error: `Label must be ${LABEL_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (!publicKey || !isValidStellarAddress(publicKey)) {
    return { ok: false, error: "Invalid Stellar address." };
  }
  if (entry.memo && entry.memo.trim().length > CONTACT_MEMO_MAX_LENGTH) {
    return {
      ok: false,
      error: `Memo must be ${CONTACT_MEMO_MAX_LENGTH} characters or fewer.`,
    };
  }

  const conflict = detectContactConflict({ publicKey, label });
  if (conflict) {
    return {
      ok: false,
      conflict,
      error: conflict.message,
    };
  }

  const saved: AddressEntry = {
    ...entry,
    publicKey,
    label,
    memo: entry.memo?.trim() || undefined,
    federationAddress: entry.federationAddress?.trim() || undefined,
    lastUsed: Date.now(),
  };

  const book = getAddressBook();
  book.push(saved);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(book));

  return { ok: true, entry: saved };
}

/** Look up a saved contact by exact Stellar public key. */
export function findContactByAddress(publicKey: string): AddressEntry | null {
  const key = publicKey.trim();
  if (!key) return null;
  return getAddressBook().find((entry) => entry.publicKey === key) ?? null;
}

/** Look up a saved contact by alias/label or federation address (case-insensitive). */
export function findContactByAlias(alias: string): AddressEntry | null {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;
  return (
    getAddressBook().find(
      (entry) =>
        entry.label.trim().toLowerCase() === normalized ||
        (entry.federationAddress &&
          entry.federationAddress.trim().toLowerCase() === normalized)
    ) ?? null
  );
}

/** Add or update a standalone blacklisted address entry in localStorage. */
export function markAddressBlacklisted(
  publicKey: string,
  reason = "Blacklisted account"
): void {
  try {
    const raw = localStorage.getItem(BLACKLIST_STORAGE_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[publicKey.trim()] = reason;
    localStorage.setItem(BLACKLIST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

/**
 * Check whether an address is marked as untrusted or blacklisted in the
 * address book or standalone blacklist registry.
 */
export function checkAddressTrustStatus(
  publicKey: string
): AddressStatusWarning {
  const key = publicKey.trim();
  if (!key) {
    return { flagged: false, status: null, reason: null, contact: null };
  }

  const contact = findContactByAddress(key);
  if (contact?.blacklisted) {
    return {
      flagged: true,
      status: "blacklisted",
      reason:
        contact.warningReason ||
        `Warning: "${contact.label}" is marked as a blacklisted account.`,
      contact,
    };
  }
  if (contact?.untrusted) {
    return {
      flagged: true,
      status: "untrusted",
      reason:
        contact.warningReason ||
        `Caution: "${contact.label}" is marked as an untrusted account.`,
      contact,
    };
  }

  try {
    const raw = localStorage.getItem(BLACKLIST_STORAGE_KEY);
    if (raw) {
      const map = JSON.parse(raw) as Record<string, string>;
      if (map[key]) {
        return {
          flagged: true,
          status: "blacklisted",
          reason: map[key],
          contact,
        };
      }
    }
  } catch {
    // ignore corrupted blacklist storage
  }

  return { flagged: false, status: null, reason: null, contact };
}

/** Remove an address from the address book. */
export function removeAddress(publicKey: string): void {
  const book = getAddressBook().filter((a) => a.publicKey !== publicKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
}

/** Search address book by label, federation address, or public key prefix/substring. */
export function searchAddressBook(query: string): AddressEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getAddressBook().filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      a.publicKey.toLowerCase().includes(q) ||
      Boolean(a.federationAddress && a.federationAddress.toLowerCase().includes(q))
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
