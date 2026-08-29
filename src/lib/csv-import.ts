// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";
import { isValidStellarAddress } from "@/lib/stellar";

/**
 * Maximum recipients allowed in a single batch transaction (matches the
 * on-chain 100-operation limit used by `buildBatchPaymentTx`).
 */
export const MAX_BATCH_RECIPIENTS = 100;

// ── CSV parsing ───────────────────────────────────────────────

/**
 * Parse CSV text into a matrix of cells. Handles quoted fields, escaped
 * quotes (`""` inside a quoted field), commas and newlines inside quotes,
 * and CRLF/CR line endings. A leading UTF-8 BOM is stripped, and rows that
 * are entirely blank are dropped. Never throws on malformed or non-string input.
 */
export function parseCsvText(text: string): string[][] {
  if (typeof text !== "string") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, "");
  let i = 0;

  while (i < clean.length) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // CRLF or lone CR both end the row; swallow the LF if present.
      if (clean[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Push the final row (input may not end with a newline).
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely blank or whitespace-only.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ── Field-level validation ────────────────────────────────────

/** Control characters (C0/C1) — never legitimate memo content. */
const MEMO_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

export interface RecipientFieldErrors {
  address?: string;
  amount?: string;
  memo?: string;
}

/**
 * Validate a single recipient's fields. Returns an object keyed by field
 * name with a user-facing message; fields without errors are omitted.
 */
export function validateRecipientFields(
  address: string,
  amount: string,
  memo: string,
  opts: { selfAddress?: string | null } = {}
): RecipientFieldErrors {
  const errors: RecipientFieldErrors = {};

  const addr = (address ?? "").trim();
  if (!addr) {
    errors.address = "Address is required.";
  } else if (!isValidStellarAddress(addr)) {
    errors.address = "Invalid Stellar address.";
  } else if (opts.selfAddress && addr === opts.selfAddress) {
    errors.address = "Cannot send to your own address.";
  }

  const amt = (amount ?? "").trim();
  if (!amt) {
    errors.amount = "Amount is required.";
  } else {
    const n = parseFloat(amt);
    if (isNaN(n) || n <= 0 || !Number.isFinite(n)) {
      errors.amount = "Amount must be a number greater than 0.";
    }
  }

  const mem = (memo ?? "").trim();
  if (mem) {
    if (MEMO_CONTROL_CHARS.test(mem)) {
      errors.memo = "Memo must not contain control or invisible characters.";
    } else if (mem.length > 28) {
      errors.memo = "Memo must be 28 characters or fewer.";
    } else if (new TextEncoder().encode(mem).length > 28) {
      errors.memo = "Memo must be 28 bytes or fewer.";
    }
  }

  return errors;
}

/**
 * Flag duplicate addresses across rows. Every occurrence of a duplicated
 * (valid) address after the first is marked with an address error. Rows that
 * already have an invalid-address error are left untouched.
 */
export function applyDuplicateErrors(rows: CsvImportRow[]): void {
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

// ── Import rows for the preview UI ────────────────────────────

export interface CsvImportRow {
  /** Stable client-side id (survives row edits). */
  id: number;
  /** 1-based row number in the file (excluding the header). */
  sourceRow: number;
  values: { address: string; amount: string; memo: string };
  errors: RecipientFieldErrors;
}

/**
 * Parse a CSV file into editable, per-field-validated rows for the batch
 * preview UI. Columns are read by header name (`address`, `amount`, `memo`)
 * when present, falling back to positional columns 1–3. A legacy 4-column
 * template (`address,amount,assetCode,memo`) is supported — the assetCode
 * column is ignored because batch payments are native XLM.
 */
export async function parseRecipientsCsvToRows(
  file: File,
  opts: { selfAddress?: string | null } = {}
): Promise<{ rows: CsvImportRow[]; fileErrors: string[] }> {
  if (!file || typeof file.text !== "function") {
    return {
      rows: [],
      fileErrors: ["CSV must have a header row and at least one data row."],
    };
  }

  let text = "";
  try {
    text = await file.text();
  } catch {
    return {
      rows: [],
      fileErrors: ["CSV must have a header row and at least one data row."],
    };
  }

  if (typeof text !== "string") {
    return {
      rows: [],
      fileErrors: ["CSV must have a header row and at least one data row."],
    };
  }

  const parsed = parseCsvText(text);
  const fileErrors: string[] = [];

  if (parsed.length < 2) {
    fileErrors.push("CSV must have a header row and at least one data row.");
    return { rows: [], fileErrors };
  }

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const addressIdx = header.indexOf("address");
  const amountIdx = header.indexOf("amount");
  const memoIdx = header.indexOf("memo");
  const hasNamedHeader = addressIdx >= 0 || amountIdx >= 0;

  const addrI = addressIdx >= 0 ? addressIdx : 0;
  const amtI = amountIdx >= 0 ? amountIdx : 1;
  const memoI =
    memoIdx >= 0
      ? memoIdx
      : header.length >= 4 && !hasNamedHeader
      ? 3
      : header.length === 3 && !hasNamedHeader
      ? 2
      : 2;

  const dataRows = parsed.slice(1);
  if (dataRows.length > MAX_BATCH_RECIPIENTS) {
    fileErrors.push(
      `Maximum ${MAX_BATCH_RECIPIENTS} recipients per batch. Remove rows or split the file into multiple batches.`
    );
  }

  const rows: CsvImportRow[] = dataRows.map((cells, idx) => {
    const get = (i: number) => (cells[i] ?? "").trim();
    const values = {
      address: get(addrI),
      amount: get(amtI),
      memo: memoI >= 0 ? get(memoI) : "",
    };
    return {
      id: idx + 1,
      sourceRow: idx + 1,
      values,
      errors: validateRecipientFields(
        values.address,
        values.amount,
        values.memo,
        opts
      ),
    };
  });

  applyDuplicateErrors(rows);
  return { rows, fileErrors };
}

// ── Legacy parse (kept for API compatibility) ─────────────────

/**
 * Parse a CSV file into batch payment recipients.
 * Expected CSV format: address,amount,assetCode,memo or address,amount,memo
 * First row is treated as a header and skipped.
 */
export async function parseRecipientsCsv(file: File): Promise<{
  recipients: BatchRecipient[];
  errors: { row: number; message: string }[];
}> {
  const errors: { row: number; message: string }[] = [];
  const recipients: BatchRecipient[] = [];

  if (!file || typeof file.text !== "function") {
    errors.push({ row: 0, message: "CSV must have a header row and at least one data row." });
    return { recipients, errors };
  }

  let text = "";
  try {
    text = await file.text();
  } catch {
    errors.push({ row: 0, message: "CSV must have a header row and at least one data row." });
    return { recipients, errors };
  }

  if (typeof text !== "string") {
    errors.push({ row: 0, message: "CSV must have a header row and at least one data row." });
    return { recipients, errors };
  }

  const parsed = parseCsvText(text);

  if (parsed.length < 2) {
    errors.push({ row: 0, message: "CSV must have a header row and at least one data row." });
    return { recipients, errors };
  }

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const addressIdx = header.indexOf("address");
  const amountIdx = header.indexOf("amount");
  const memoIdx = header.indexOf("memo");
  const assetIdx =
    header.indexOf("assetcode") >= 0
      ? header.indexOf("assetcode")
      : header.indexOf("asset");

  const hasNamedHeader = addressIdx >= 0 || amountIdx >= 0;
  const addrI = addressIdx >= 0 ? addressIdx : 0;
  const amtI = amountIdx >= 0 ? amountIdx : 1;
  const memoI =
    memoIdx >= 0
      ? memoIdx
      : header.length >= 4 && !hasNamedHeader
      ? 3
      : header.length === 3 && !hasNamedHeader
      ? 2
      : -1;
  const assetI =
    assetIdx >= 0
      ? assetIdx
      : header.length >= 4 && !hasNamedHeader
      ? 2
      : -1;

  for (let i = 1; i < parsed.length; i++) {
    const row = i + 1;
    const cols = parsed[i].map((c) => (c ?? "").trim());

    if (cols.length < 2) {
      errors.push({ row, message: "Each row must have at least address and amount." });
      continue;
    }

    const address = addrI >= 0 && addrI < cols.length ? cols[addrI] : "";
    const amountStr = amtI >= 0 && amtI < cols.length ? cols[amtI] : "";
    const assetCode = assetI >= 0 && assetI < cols.length ? cols[assetI] : "XLM";
    const memo = memoI >= 0 && memoI < cols.length && cols[memoI] ? cols[memoI] : undefined;

    if (!address || !amountStr) {
      errors.push({ row, message: "Each row must have at least address and amount." });
      continue;
    }

    if (!isValidStellarAddress(address)) {
      errors.push({ row, message: `Invalid Stellar address at row ${row}.` });
      continue;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0 || !Number.isFinite(amount)) {
      errors.push({ row, message: `Invalid amount at row ${row}.` });
      continue;
    }

    // Memo validation mirrors the server-side memoField rules (max 28 UTF-8
    // bytes, printable text only) so invalid memos are caught at import time
    // instead of being rejected later by the batch API.
    if (memo) {
      if (MEMO_CONTROL_CHARS.test(memo)) {
        errors.push({
          row,
          message: `Memo at row ${row} must not contain control or invisible characters.`,
        });
        continue;
      }
      if (new TextEncoder().encode(memo).length > 28) {
        errors.push({
          row,
          message: `Memo at row ${row} must be 28 bytes or fewer.`,
        });
        continue;
      }
    }

    recipients.push({
      address,
      amount,
      assetCode: assetCode || "XLM",
      memo: memo || undefined,
    });
  }

  return { recipients, errors };
}

// ── Template ──────────────────────────────────────────────────

/**
 * Generate a CSV template for batch payment imports.
 */
export function generateRecipientsCsvTemplate(): string {
  return "address,amount,memo\nGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,100,optional memo\n";
}

/**
 * Download the CSV template file.
 */
export function downloadCsvTemplate(): void {
  const csv = generateRecipientsCsvTemplate();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ophirpay-batch-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
