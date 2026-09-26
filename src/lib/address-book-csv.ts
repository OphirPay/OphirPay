// SPDX-License-Identifier: MIT

/**
 * Address Book CSV utilities — provides parsing, validation, and export
 * for address book contacts with per-row error reporting and round-trip support.
 */

import { isValidStellarAddress } from "@/lib/stellar";
import { parseCsvText } from "@/lib/csv-import";
import {
  getAddressBook,
  saveAddress,
  type AddressEntry,
} from "@/lib/address-book";

export interface AddressBookCsvRowError {
  row: number;
  message: string;
}

export interface AddressBookCsvParseResult {
  entries: AddressEntry[];
  errors: AddressBookCsvRowError[];
  message?: string;
  totalRows: number;
  importedCount: number;
}

/** Header aliases for flexible CSV mapping */
const LABEL_HEADERS = new Set(["label", "name", "nickname", "contact", "recipient name"]);
const ADDRESS_HEADERS = new Set([
  "address",
  "publickey",
  "public_key",
  "public key",
  "recipient",
  "account",
  "key",
]);
const MEMO_HEADERS = new Set(["memo", "note", "message", "description"]);

/**
 * Escape a CSV field value, handling quotes, commas, newlines,
 * and formula injection characters (=, +, -, @).
 */
export function escapeAddressBookCsvField(value: string | undefined): string {
  if (value === undefined || value === null) return "";
  let str = String(value);

  // Prevent formula injection in spreadsheet software
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of AddressEntry contacts to canonical CSV text.
 * Canonical columns: label,address,memo
 */
export function exportAddressBookToCsv(entries?: AddressEntry[]): string {
  const contacts = entries ?? getAddressBook();
  const header = "label,address,memo";
  const rows = contacts.map((c) =>
    [
      escapeAddressBookCsvField(c.label),
      escapeAddressBookCsvField(c.publicKey),
      escapeAddressBookCsvField(c.memo ?? ""),
    ].join(",")
  );

  return [header, ...rows].join("\n");
}

/**
 * Download the current or given address book as a CSV file in the browser.
 */
export function downloadAddressBookCsv(
  entries?: AddressEntry[],
  filename = "ophirpay-address-book.csv"
): void {
  const csv = exportAddressBookToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate CSV text into address book entries.
 *
 * Rules:
 * - Empty or whitespace-only file returns a clear message rather than throwing an error.
 * - Header-only file returns a clear message stating no address entries exist.
 * - Valid rows are imported and returned in `entries`.
 * - Invalid rows are reported with 1-based row numbers and reasons in `errors` without discarding valid rows.
 */
export function parseAddressBookCsv(csvText: string): AddressBookCsvParseResult {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return {
      entries: [],
      errors: [],
      message: "CSV file is empty.",
      totalRows: 0,
      importedCount: 0,
    };
  }

  const rawRows = parseCsvText(csvText);
  // Filter out completely blank lines
  const nonEmptyRows = rawRows.filter((row) =>
    row.some((cell) => cell.trim().length > 0)
  );

  if (nonEmptyRows.length === 0) {
    return {
      entries: [],
      errors: [],
      message: "CSV file is empty.",
      totalRows: 0,
      importedCount: 0,
    };
  }

  // Identify column indices from header
  const headerCells = nonEmptyRows[0].map((h) => h.trim().toLowerCase());
  let labelIdx = headerCells.findIndex((h) => LABEL_HEADERS.has(h));
  let addressIdx = headerCells.findIndex((h) => ADDRESS_HEADERS.has(h));
  let memoIdx = headerCells.findIndex((h) => MEMO_HEADERS.has(h));

  // If header wasn't recognized, check if row 1 is actually data or standard positional columns
  const firstRowLooksLikeHeader =
    labelIdx !== -1 || addressIdx !== -1 || memoIdx !== -1;

  let dataRows: string[][];
  let startLineNumber = 2;

  if (firstRowLooksLikeHeader) {
    if (labelIdx === -1) labelIdx = 0;
    if (addressIdx === -1) addressIdx = 1;
    if (memoIdx === -1) memoIdx = 2;
    dataRows = nonEmptyRows.slice(1);
  } else {
    // If first row has valid address, treat entire file as headerless (start at line 1)
    const isFirstRowData = nonEmptyRows[0].some((cell) =>
      isValidStellarAddress(cell.trim())
    );
    if (isFirstRowData) {
      labelIdx = 0;
      addressIdx = 1;
      memoIdx = 2;
      dataRows = nonEmptyRows;
      startLineNumber = 1;
    } else {
      // Unrecognized header
      labelIdx = 0;
      addressIdx = 1;
      memoIdx = 2;
      dataRows = nonEmptyRows.slice(1);
    }
  }

  if (dataRows.length === 0) {
    return {
      entries: [],
      errors: [],
      message: "CSV file contains only a header row with no address entries.",
      totalRows: 0,
      importedCount: 0,
    };
  }

  const entries: AddressEntry[] = [];
  const errors: AddressBookCsvRowError[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = startLineNumber + index;
    const labelRaw = row[labelIdx]?.trim() ?? "";
    const addressRaw = row[addressIdx]?.trim() ?? "";
    const memoRaw = row[memoIdx]?.trim() ?? "";

    // Unescape formula guard leading apostrophe if present
    const label = labelRaw.startsWith("'") && /^[=+\-@]/.test(labelRaw.slice(1))
      ? labelRaw.slice(1)
      : labelRaw;
    const memoClean = memoRaw.startsWith("'") && /^[=+\-@]/.test(memoRaw.slice(1))
      ? memoRaw.slice(1)
      : memoRaw;

    const rowErrors: string[] = [];

    if (!label) {
      rowErrors.push("Nickname / label is required.");
    } else if (label.length > 100) {
      rowErrors.push("Nickname must be 100 characters or fewer.");
    }

    if (!addressRaw) {
      rowErrors.push("Stellar address is required.");
    } else if (!isValidStellarAddress(addressRaw)) {
      rowErrors.push("Invalid Stellar address — must be 56 characters starting with G.");
    }

    if (memoClean && memoClean.length > 28) {
      rowErrors.push("Memo must be 28 characters or fewer.");
    }

    if (rowErrors.length > 0) {
      errors.push({
        row: rowNumber,
        message: rowErrors.join(" "),
      });
    } else {
      entries.push({
        publicKey: addressRaw,
        label,
        memo: memoClean || undefined,
      });
    }
  });

  return {
    entries,
    errors,
    totalRows: dataRows.length,
    importedCount: entries.length,
  };
}

/**
 * Import entries into the browser's localStorage address book.
 * Valid rows are persisted via `saveAddress`.
 */
export function importAddressBookEntries(entries: AddressEntry[]): number {
  for (const entry of entries) {
    saveAddress(entry);
  }
  return entries.length;
}
