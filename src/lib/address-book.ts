// SPDX-License-Identifier: MIT

import { isValidStellarAddress } from "@/lib/stellar";
import { parseCsvText } from "@/lib/csv-import";
import { escapeCsvField } from "@/lib/csv";

/**
 * Client-side address book using localStorage.
 * Stores frequently used Stellar addresses with labels for quick access.
 */

export interface AddressEntry {
  publicKey: string;
  label: string;
  memo?: string;
  asset?: string;
  lastUsed?: number;
}

export interface AddressBookImportError {
  /** 1-based row number in the CSV file (including the header). */
  row: number;
  reason: string;
  field?: "label" | "address" | "memo" | "asset";
  raw?: {
    label?: string;
    address?: string;
    memo?: string;
    asset?: string;
  };
}

export interface AddressBookImportResult {
  validEntries: AddressEntry[];
  errors: AddressBookImportError[];
  totalRows: number;
  isEmpty: boolean;
  message?: string;
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
    book[idx] = {
      ...book[idx],
      ...entry,
      lastUsed: entry.lastUsed ?? book[idx].lastUsed ?? Date.now(),
    };
  } else {
    book.push({
      ...entry,
      lastUsed: entry.lastUsed ?? Date.now(),
    });
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch {
    // Gracefully handle storage quota or privacy mode errors
  }
}

/**
 * Add or update multiple addresses in the address book in one batch.
 * Returns the count of newly added and updated entries.
 */
export function saveAddressBatch(entries: AddressEntry[]): {
  added: number;
  updated: number;
} {
  const book = getAddressBook();
  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    const idx = book.findIndex((a) => a.publicKey === entry.publicKey);
    if (idx >= 0) {
      book[idx] = {
        ...book[idx],
        ...entry,
        lastUsed: entry.lastUsed ?? book[idx].lastUsed ?? Date.now(),
      };
      updated++;
    } else {
      book.push({
        ...entry,
        lastUsed: entry.lastUsed ?? Date.now(),
      });
      added++;
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch {
    // Gracefully handle storage quota or privacy mode errors
  }
  return { added, updated };
}

/** Remove an address from the address book. */
export function removeAddress(publicKey: string): void {
  const book = getAddressBook().filter((a) => a.publicKey !== publicKey);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch {
    // Gracefully handle storage quota or privacy mode errors
  }
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

// ── CSV Export & Import ────────────────────────────────────────

/**
 * Format an array of AddressEntry objects into an RFC 4180 CSV string.
 * Uses standard headers: `label,address,memo,asset`.
 */
export function formatAddressBookCsv(entries?: AddressEntry[]): string {
  const list = entries ?? getAddressBook();
  const headers = ["label", "address", "memo", "asset"];
  const rows = list.map((e) =>
    [
      escapeCsvField(e.label),
      escapeCsvField(e.publicKey),
      escapeCsvField(e.memo ?? ""),
      escapeCsvField(e.asset ?? ""),
    ].join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

/**
 * Parse a CSV text payload into address book entries.
 *
 * Requirements:
 * - Empty or header-only file returns `isEmpty: true` with a clear message rather than an error.
 * - Named headers (`label`, `address`, `memo`, `asset`) or positional columns.
 * - Validates Stellar addresses via `isValidStellarAddress`.
 * - Validates label presence and 100 character length.
 * - Validates optional memo (max 28 UTF-8 bytes).
 * - Validates optional asset code (1-12 alphanumeric characters).
 * - Keeps valid rows while reporting per-row errors with line numbers.
 * - Guarantees full round-trip fidelity when re-importing exported CSVs.
 */
export function parseAddressBookCsvText(raw: string): AddressBookImportResult {
  if (!raw || !raw.trim()) {
    return {
      validEntries: [],
      errors: [],
      totalRows: 0,
      isEmpty: true,
      message: "The CSV file is empty. Please select a file with address book records.",
    };
  }

  const parsed = parseCsvText(raw);

  if (parsed.length === 0) {
    return {
      validEntries: [],
      errors: [],
      totalRows: 0,
      isEmpty: true,
      message: "The CSV file is empty. Please select a file with address book records.",
    };
  }

  if (parsed.length === 1) {
    return {
      validEntries: [],
      errors: [],
      totalRows: 0,
      isEmpty: true,
      message: "The CSV file contains only headers with no address book entries.",
    };
  }

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const labelIdx = header.findIndex((h) =>
    ["label", "nickname", "name", "contact"].includes(h)
  );
  const addrIdx = header.findIndex((h) =>
    ["address", "publickey", "public_key", "account", "destination", "recipient"].includes(h)
  );
  const memoIdx = header.findIndex((h) =>
    ["memo", "note", "message", "tag"].includes(h)
  );
  const assetIdx = header.findIndex((h) =>
    ["asset", "assetcode", "asset_code", "currency", "token"].includes(h)
  );

  const hasNamedHeaders = labelIdx !== -1 || addrIdx !== -1;
  const lI = labelIdx !== -1 ? labelIdx : 0;
  const aI = addrIdx !== -1 ? addrIdx : 1;
  const mI = memoIdx !== -1 ? memoIdx : 2;
  const asI = assetIdx !== -1 ? assetIdx : 3;

  const validEntries: AddressEntry[] = [];
  const errors: AddressBookImportError[] = [];
  const totalRows = parsed.length - 1;

  for (let i = 1; i < parsed.length; i++) {
    const rowNum = i + 1; // 1-based line number in source file
    const cells = parsed[i];

    let label = (cells[lI] ?? "").trim();
    let address = (cells[aI] ?? "").trim();
    const memo = (cells[mI] ?? "").trim();
    const asset = (cells[asI] ?? "").trim();

    // If positional and first column looks like a Stellar address while second is label:
    if (!hasNamedHeaders && isValidStellarAddress(label) && !isValidStellarAddress(address)) {
      const tmp = label;
      label = address;
      address = tmp;
    }

    const rowErrors: string[] = [];

    if (!address) {
      rowErrors.push("Address is required.");
    } else if (!isValidStellarAddress(address)) {
      rowErrors.push("Invalid Stellar address — must be 56 characters starting with G.");
    }

    if (!label) {
      rowErrors.push("Nickname or label is required.");
    } else if (label.length > 100) {
      rowErrors.push("Nickname must be 100 characters or fewer.");
    }

    if (memo) {
      const memoBytes = new TextEncoder().encode(memo).length;
      if (memoBytes > 28) {
        rowErrors.push("Memo must be 28 characters or fewer (28 UTF-8 bytes).");
      }
    }

    if (asset) {
      if (!/^[a-zA-Z0-9]{1,12}$/.test(asset)) {
        rowErrors.push("Asset code must be 1 to 12 alphanumeric characters.");
      }
    }

    if (rowErrors.length > 0) {
      errors.push({
        row: rowNum,
        reason: rowErrors.join(" "),
        raw: {
          label: label || undefined,
          address: address || undefined,
          memo: memo || undefined,
          asset: asset || undefined,
        },
      });
    } else {
      const entry: AddressEntry = {
        publicKey: address,
        label,
      };
      if (memo) entry.memo = memo;
      if (asset) entry.asset = asset;
      validEntries.push(entry);
    }
  }

  return {
    validEntries,
    errors,
    totalRows,
    isEmpty: false,
  };
}

/**
 * Trigger client-side browser download of address book entries in CSV format.
 */
export function exportAddressBookCsv(
  entries?: AddressEntry[],
  filename = "ophirpay-address-book.csv"
): void {
  const list = entries ?? getAddressBook();
  const csvContent = formatAddressBookCsv(list);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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
 * Trigger client-side download of a sample CSV template for address book imports.
 */
export function downloadAddressBookTemplate(
  filename = "address-book-template.csv"
): void {
  const sampleEntries: AddressEntry[] = [
    {
      label: "Nonprofit Treasury",
      publicKey: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2CTRBIAP2W2QASXYZW1",
      memo: "Monthly donation",
      asset: "USDC",
    },
    {
      label: "Dev Core Contributor",
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      memo: "Grant payout",
      asset: "XLM",
    },
  ];
  const csvContent = formatAddressBookCsv(sampleEntries);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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
