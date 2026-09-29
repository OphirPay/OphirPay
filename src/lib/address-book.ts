// SPDX-License-Identifier: MIT

/**
 * Client-side address book using localStorage.
 * Stores frequently used Stellar addresses with labels for quick access.
 */

import { isValidStellarAddress } from "@/lib/stellar";
import { parseCsvText } from "@/lib/csv-import";
import { escapeCsvField } from "@/lib/csv";

export interface AddressEntry {
  publicKey: string;
  label: string;
  memo?: string;
  lastUsed?: number;
}

const STORAGE_KEY = "ophirpay-address-book";

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

// ── CSV import/export ────────────────────────────────────────────
//
// Reuses the batch payment CSV tokenizer (`parseCsvText`) and the same
// address validator (`isValidStellarAddress`) so both features stay in sync,
// rather than parsing/validating addresses a second way.

const ADDRESS_BOOK_CSV_COLUMNS = ["label", "address", "memo"] as const;

export interface AddressBookFieldErrors {
  label?: string;
  address?: string;
  memo?: string;
}

export interface AddressBookImportRow {
  /** Stable client-side id (survives row edits). */
  id: number;
  /** 1-based row number in the file (excluding the header). */
  sourceRow: number;
  values: { label: string; address: string; memo: string };
  errors: AddressBookFieldErrors;
}

/**
 * Validate a single address book row. Returns an object keyed by field name
 * with a user-facing message; fields without errors are omitted.
 */
export function validateAddressBookFields(
  label: string,
  address: string,
  memo: string
): AddressBookFieldErrors {
  const errors: AddressBookFieldErrors = {};

  const lbl = label.trim();
  if (!lbl) {
    errors.label = "Label is required.";
  } else if (lbl.length > 100) {
    errors.label = "Label must be 100 characters or fewer.";
  }

  const addr = address.trim();
  if (!addr) {
    errors.address = "Address is required.";
  } else if (!isValidStellarAddress(addr)) {
    errors.address = "Invalid Stellar address.";
  }

  const mem = memo.trim();
  if (mem.length > 28) {
    errors.memo = "Memo must be 28 characters or fewer.";
  }

  return errors;
}

/**
 * Flag duplicate addresses across rows. Every occurrence of a duplicated
 * (valid) address after the first is marked with an address error. Rows that
 * already have an invalid-address error are left untouched.
 */
export function applyDuplicateAddressErrors(rows: AddressBookImportRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const addr = row.values.address.trim();
    if (!addr || !isValidStellarAddress(addr)) continue;
    if (seen.has(addr)) {
      row.errors = { ...row.errors, address: "Duplicate address." };
    } else {
      seen.add(addr);
    }
  }
}

/**
 * Parse a CSV file into editable, per-field-validated address book rows.
 * Columns are read by header name (`label`, `address`, `memo`) when present,
 * falling back to positional columns 1-3. Extra columns (e.g. an `asset`
 * column carried over from a batch payments export) are ignored.
 */
export async function parseAddressBookCsvToRows(
  file: File
): Promise<{ rows: AddressBookImportRow[]; fileErrors: string[] }> {
  const parsed = parseCsvText(await file.text());
  const fileErrors: string[] = [];

  if (parsed.length === 0) {
    fileErrors.push("CSV file is empty.");
    return { rows: [], fileErrors };
  }

  if (parsed.length < 2) {
    fileErrors.push("CSV must have a header row and at least one data row.");
    return { rows: [], fileErrors };
  }

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const labelIdx = header.indexOf("label");
  const addressIdx = header.indexOf("address");
  const memoIdx = header.indexOf("memo");
  const labelI = labelIdx >= 0 ? labelIdx : 0;
  const addrI = addressIdx >= 0 ? addressIdx : 1;
  const memoI = memoIdx >= 0 ? memoIdx : 2;

  const rows: AddressBookImportRow[] = parsed.slice(1).map((cells, idx) => {
    const get = (i: number) => (cells[i] ?? "").trim();
    const values = {
      label: get(labelI),
      address: get(addrI),
      memo: get(memoI),
    };
    return {
      id: idx + 1,
      sourceRow: idx + 1,
      values,
      errors: validateAddressBookFields(values.label, values.address, values.memo),
    };
  });

  applyDuplicateAddressErrors(rows);
  return { rows, fileErrors };
}

/**
 * Save every error-free row to the address book (existing entries with the
 * same address are updated, matching `saveAddress`'s upsert behavior).
 * Returns the number of rows imported.
 */
export function importAddressBookRows(rows: AddressBookImportRow[]): number {
  const validRows = rows.filter((r) => Object.keys(r.errors).length === 0);
  for (const row of validRows) {
    saveAddress({
      publicKey: row.values.address.trim(),
      label: row.values.label.trim(),
      memo: row.values.memo.trim() || undefined,
    });
  }
  return validRows.length;
}

/** Render address book entries as CSV text (`label,address,memo`). */
export function addressBookToCsv(entries: AddressEntry[] = getAddressBook()): string {
  const header = ADDRESS_BOOK_CSV_COLUMNS.join(",");
  const rows = entries.map((e) =>
    [e.label, e.publicKey, e.memo ?? ""]
      .map((v) => escapeCsvField(v, ","))
      .join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

/** Download the address book as a CSV file. */
export function downloadAddressBookCsv(entries: AddressEntry[] = getAddressBook()): void {
  const csv = addressBookToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ophirpay-address-book.csv";
  a.click();
  URL.revokeObjectURL(url);
}
